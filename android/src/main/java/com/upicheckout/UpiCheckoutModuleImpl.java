package com.upicheckout;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.common.LifecycleState;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Shared implementation behind the old- and new-architecture modules.
 *
 * A payment is started with {@code startActivityForResult} on the current
 * activity, and the result comes back through the React context's activity
 * event listener. Only one payment can wait for a result at a time; the
 * request state lives in {@link PaymentState}. All state is touched on the UI
 * thread, where Android delivers activity results.
 */
final class UpiCheckoutModuleImpl implements ActivityEventListener, LifecycleEventListener {
  static final String NAME = "UpiCheckout";

  /**
   * Request code for the payment activity. It stays below 0x10000 because
   * {@code FragmentActivity} (the base of {@code ReactActivity}) only accepts
   * request codes in the lower 16 bits.
   */
  static final int REQUEST_CODE = 0x5550;

  private static final String UPI_PAY_URL = "upi://pay";

  private final ReactApplicationContext context;
  private final Handler mainHandler = new Handler(Looper.getMainLooper());

  // Accessed only on the UI thread.
  private final PaymentState<Promise> state = new PaymentState<>(new PaymentState.Scheduler() {
    @Override
    public Runnable schedule(final Runnable task, long delayMillis) {
      mainHandler.postDelayed(task, delayMillis);
      return new Runnable() {
        @Override
        public void run() {
          mainHandler.removeCallbacks(task);
        }
      };
    }
  });
  private boolean invalidated;

  private final PaymentState.NoResultHandler<Promise> noResult = new PaymentState.NoResultHandler<Promise>() {
    @Override
    public void onNoResult(Promise promise) {
      promise.resolve(resultMap(null, null));
    }
  };

  UpiCheckoutModuleImpl(ReactApplicationContext context) {
    this.context = context;
    context.addActivityEventListener(this);
    context.addLifecycleEventListener(this);
  }

  void getInstalledApps(final Promise promise) {
    try {
      PackageManager packageManager = context.getPackageManager();
      Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(UPI_PAY_URL));
      WritableArray apps = Arguments.createArray();
      Set<String> seen = new HashSet<>();
      for (ResolveInfo info : queryHandlers(packageManager, intent)) {
        if (info.activityInfo == null) continue;
        String packageName = info.activityInfo.packageName;
        if (packageName == null || !seen.add(packageName)) continue;
        CharSequence label = info.loadLabel(packageManager);
        WritableMap app = Arguments.createMap();
        app.putString("packageName", packageName);
        app.putString("name", label != null ? label.toString() : packageName);
        apps.pushMap(app);
      }
      promise.resolve(apps);
    } catch (RuntimeException error) {
      promise.reject("UNKNOWN", "Could not list UPI apps: " + error.getMessage(), error);
    }
  }

  void pay(final String url, @Nullable final String packageName, @Nullable final String chooserTitle,
      final Promise promise) {
    UiThreadUtil.runOnUiThread(new Runnable() {
      @Override
      public void run() {
        start(url, packageName, chooserTitle, promise);
      }
    });
  }

  /**
   * The last result an app returned for a payment, kept for the whole
   * process: {@code { outcome: 'result', resultCode, response,
   * transactionRef, time }}, or {@code null}.
   */
  void getLastResult(Promise promise) {
    PaymentState.Record record = PaymentState.lastResult();
    if (record == null) {
      promise.resolve(null);
      return;
    }
    WritableMap result = resultMap(record.resultCode, record.response);
    if (record.transactionRef == null) {
      result.putNull("transactionRef");
    } else {
      result.putString("transactionRef", record.transactionRef);
    }
    result.putDouble("time", (double) record.time);
    promise.resolve(result);
  }

  private void start(String url, @Nullable String packageName, @Nullable String chooserTitle, Promise promise) {
    Uri uri = Uri.parse(url);
    if (!"upi".equalsIgnoreCase(uri.getScheme())) {
      promise.reject("INVALID_PARAMS", "Only upi:// URLs can be opened.");
      return;
    }
    Activity activity = context.getCurrentActivity();
    boolean resumed = context.getLifecycleState() == LifecycleState.RESUMED;
    PaymentState.Refusal refusal =
        state.refusal(invalidated, activity, activity != null && activity.isFinishing(), resumed);
    if (refusal != null || activity == null) {
      PaymentState.Refusal reason = refusal != null ? refusal : PaymentState.Refusal.NO_ACTIVITY;
      promise.reject(reason.code, reason.message);
      return;
    }

    Intent intent = new Intent(Intent.ACTION_VIEW, uri);
    if (packageName != null) intent.setPackage(packageName);
    if (queryHandlers(activity.getPackageManager(), intent).isEmpty()) {
      WritableMap result = Arguments.createMap();
      result.putString("outcome", "unavailable");
      promise.resolve(result);
      return;
    }
    Intent launch = packageName != null ? intent : Intent.createChooser(intent, chooserTitle);

    state.begin(promise, activity, readTransactionRef(uri), System.currentTimeMillis());
    try {
      activity.startActivityForResult(launch, REQUEST_CODE);
    } catch (ActivityNotFoundException error) {
      state.abort();
      promise.reject("NO_UPI_APP", "The UPI app could not be started.", error);
    } catch (RuntimeException error) {
      state.abort();
      promise.reject("UNKNOWN", "Could not start the UPI app: " + error.getMessage(), error);
    }
  }

  @Override
  public void onActivityResult(Activity activity, int requestCode, int resultCode, @Nullable Intent data) {
    if (requestCode != REQUEST_CODE) return;
    String response = readResponse(data);
    // Recorded for getLastResult() even when no promise waits for it, for
    // example when the result arrives after a JavaScript reload.
    Promise promise = state.complete(resultCode, response, System.currentTimeMillis());
    if (promise != null) promise.resolve(resultMap(resultCode, response));
  }

  @Override
  public void onNewIntent(Intent intent) {
    // Not used: UPI apps return through onActivityResult.
  }

  /**
   * Android delivers a pending activity result before {@code onResume}.
   *
   * <p>If a different activity instance resumes and the result has not
   * arrived, the activity that started the payment was destroyed without
   * being recreated with its results (for example the user left the task and
   * launched the app again). The request is rejected with
   * {@code ACTIVITY_UNAVAILABLE}.
   *
   * <p>If the same instance resumes and no result arrives within
   * {@link PaymentState#RESUME_GRACE_MILLIS}, the request resolves with
   * {@code resultCode: null} and no response, which JavaScript reports as
   * {@code completed} with {@code status: 'unknown'}. That is the safe
   * outcome: the app cannot tell whether the user paid, so it must ask its
   * server, and it never tells a user who may have paid that they cancelled.
   */
  @Override
  public void onHostResume() {
    Promise replaced = state.onResume(context.getCurrentActivity(), noResult);
    if (replaced != null) {
      replaced.reject("ACTIVITY_UNAVAILABLE",
          "The activity that started the UPI payment was replaced before a result came back. "
              + "Check the payment status on your server.");
    }
  }

  @Override
  public void onHostPause() {
    // Back in the UPI app (or another window took focus): keep waiting.
    state.onPause();
  }

  @Override
  public void onHostDestroy() {
    // Keep the request: a recreated activity still receives the result.
    state.onPause();
  }

  /** Idempotent: both the old and the new teardown callbacks may call it. */
  void invalidate() {
    UiThreadUtil.runOnUiThread(new Runnable() {
      @Override
      public void run() {
        if (invalidated) return;
        invalidated = true;
        context.removeActivityEventListener(UpiCheckoutModuleImpl.this);
        context.removeLifecycleEventListener(UpiCheckoutModuleImpl.this);
        Promise promise = state.invalidate();
        if (promise != null) {
          promise.reject("ACTIVITY_UNAVAILABLE",
              "The React instance was torn down before the UPI app returned. "
                  + "Check the payment status on your server.");
        }
      }
    });
  }

  /** {@code resultCode} is {@code null} when no result arrived at all. */
  private static WritableMap resultMap(@Nullable Integer resultCode, @Nullable String response) {
    WritableMap result = Arguments.createMap();
    result.putString("outcome", "result");
    if (resultCode == null) {
      result.putNull("resultCode");
    } else {
      result.putInt("resultCode", resultCode);
    }
    if (response == null) {
      result.putNull("response");
    } else {
      result.putString("response", response);
    }
    return result;
  }

  @Nullable
  private static String readTransactionRef(Uri uri) {
    try {
      return uri.getQueryParameter("tr");
    } catch (RuntimeException error) {
      return null;
    }
  }

  /** The response string from the result intent; see {@link UpiResponseExtras}. */
  @Nullable
  static String readResponse(@Nullable final Intent data) {
    if (data == null) return null;
    return UpiResponseExtras.read(new UpiResponseExtras.Source() {
      @Nullable
      @Override
      public Set<String> keys() {
        Bundle extras = data.getExtras();
        return extras == null ? null : extras.keySet();
      }

      @Nullable
      @Override
      @SuppressWarnings("deprecation") // Bundle.get(String): the typed getters would log ClassCastExceptions.
      public Object get(String key) {
        Bundle extras = data.getExtras();
        return extras == null ? null : extras.get(key);
      }

      @Nullable
      @Override
      public String getString(String key) {
        return data.getStringExtra(key);
      }
    });
  }

  /**
   * Activities that can open {@code intent} the way {@code startActivity}
   * will: implicit intents only reach activities whose filter has
   * {@code CATEGORY_DEFAULT}, so {@code MATCH_DEFAULT_ONLY} is applied here,
   * both for the app list and for the check before a payment starts.
   *
   * <p>The {@code int} overload is used on every API level. On API 33+ it is
   * deprecated but still supported, and {@code MATCH_DEFAULT_ONLY} means the
   * same in both overloads. Naming {@code ResolveInfoFlags} here would stop
   * the library from compiling in apps whose {@code compileSdkVersion} is
   * below 33, the default of React Native releases before 0.71.
   */
  @SuppressWarnings("deprecation") // queryIntentActivities(Intent, int): see above.
  private static List<ResolveInfo> queryHandlers(PackageManager packageManager, Intent intent) {
    return packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
  }
}
