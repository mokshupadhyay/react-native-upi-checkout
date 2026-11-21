package com.upicheckout;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.lang.ref.WeakReference;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Shared implementation behind the old- and new-architecture modules.
 *
 * A payment is started with {@code startActivityForResult} on the current
 * activity, and the result comes back through the React context's activity
 * event listener. Only one payment can wait for a result at a time. All state
 * is touched on the UI thread, where Android delivers activity results.
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

  // Accessed only on the UI thread.
  @Nullable private Promise pending;
  @Nullable private WeakReference<Activity> launchActivity;
  private boolean invalidated;

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

  private void start(String url, @Nullable String packageName, @Nullable String chooserTitle, Promise promise) {
    if (invalidated) {
      promise.reject("ACTIVITY_UNAVAILABLE", "The React instance is shutting down.");
      return;
    }
    if (pending != null) {
      promise.reject("IN_PROGRESS", "Another UPI payment is still waiting for its result.");
      return;
    }
    Uri uri = Uri.parse(url);
    if (!"upi".equalsIgnoreCase(uri.getScheme())) {
      promise.reject("INVALID_PARAMS", "Only upi:// URLs can be opened.");
      return;
    }
    Activity activity = context.getCurrentActivity();
    if (activity == null || activity.isFinishing()) {
      promise.reject("ACTIVITY_UNAVAILABLE", "There is no foreground activity to start the UPI app from.");
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

    pending = promise;
    launchActivity = new WeakReference<>(activity);
    try {
      activity.startActivityForResult(launch, REQUEST_CODE);
    } catch (ActivityNotFoundException error) {
      clearPending();
      promise.reject("NO_UPI_APP", "The UPI app could not be started.", error);
    } catch (RuntimeException error) {
      clearPending();
      promise.reject("UNKNOWN", "Could not start the UPI app: " + error.getMessage(), error);
    }
  }

  @Override
  public void onActivityResult(Activity activity, int requestCode, int resultCode, @Nullable Intent data) {
    if (requestCode != REQUEST_CODE) return;
    Promise promise = pending;
    clearPending();
    // A result for a request made before a JavaScript reload has no promise.
    if (promise == null) return;
    WritableMap result = Arguments.createMap();
    result.putString("outcome", "result");
    result.putInt("resultCode", resultCode);
    String response = readResponse(data);
    if (response == null) {
      result.putNull("response");
    } else {
      result.putString("response", response);
    }
    promise.resolve(result);
  }

  @Override
  public void onNewIntent(Intent intent) {
    // Not used: UPI apps return through onActivityResult.
  }

  /**
   * Android delivers a pending activity result before {@code onResume}. If a
   * different activity instance resumes and the result has not arrived, the
   * activity that started the payment was destroyed without being recreated
   * with its results (for example the user left the task and launched the
   * app again). The result can no longer arrive, so the request is released.
   * The same instance resuming early (multi-window focus changes) keeps the
   * request open.
   */
  @Override
  public void onHostResume() {
    if (pending == null || launchActivity == null) return;
    Activity started = launchActivity.get();
    Activity current = context.getCurrentActivity();
    if (started != null && started == current) return;
    Promise promise = pending;
    clearPending();
    promise.reject("ACTIVITY_UNAVAILABLE",
        "The activity that started the UPI payment was replaced before a result came back. "
            + "Check the payment status on your server.");
  }

  @Override
  public void onHostPause() {
    // Nothing to do: the UPI app is in front while this activity is paused.
  }

  @Override
  public void onHostDestroy() {
    // Keep the request: a recreated activity still receives the result.
  }

  void invalidate() {
    UiThreadUtil.runOnUiThread(new Runnable() {
      @Override
      public void run() {
        if (invalidated) return;
        invalidated = true;
        context.removeActivityEventListener(UpiCheckoutModuleImpl.this);
        context.removeLifecycleEventListener(UpiCheckoutModuleImpl.this);
        Promise promise = pending;
        clearPending();
        if (promise != null) {
          promise.reject("ACTIVITY_UNAVAILABLE",
              "The React instance was torn down before the UPI app returned. "
                  + "Check the payment status on your server.");
        }
      }
    });
  }

  private void clearPending() {
    pending = null;
    launchActivity = null;
  }

  /**
   * The response string: the {@code response} extra most apps send, or, for
   * apps that send {@code Status}, {@code txnId} and so on as separate
   * extras, those extras joined as {@code key=value&...} with encoded values.
   */
  @Nullable
  static String readResponse(@Nullable Intent data) {
    if (data == null) return null;
    try {
      return readExtras(data.getExtras());
    } catch (RuntimeException error) {
      // A malformed parcel from the other app. On API 33+ extras are read
      // lazily, so this can happen on any access, not only in getExtras().
      return null;
    }
  }

  @Nullable
  @SuppressWarnings("deprecation") // Bundle.get(String): the typed getters would log ClassCastExceptions.
  private static String readExtras(@Nullable Bundle extras) {
    if (extras == null || extras.isEmpty()) return null;

    boolean hasStatus = false;
    for (String key : extras.keySet()) {
      Object value = extras.get(key);
      if ("response".equalsIgnoreCase(key) && value instanceof CharSequence && value.toString().trim().length() > 0) {
        return value.toString();
      }
      if ("status".equalsIgnoreCase(key)) hasStatus = true;
    }
    if (!hasStatus) return null;

    StringBuilder joined = new StringBuilder();
    for (String key : extras.keySet()) {
      Object value = extras.get(key);
      if (!(value instanceof CharSequence || value instanceof Number || value instanceof Boolean)) continue;
      if (joined.length() > 0) joined.append('&');
      joined.append(Uri.encode(key)).append('=').append(Uri.encode(String.valueOf(value)));
    }
    return joined.length() > 0 ? joined.toString() : null;
  }

  @SuppressWarnings("deprecation") // queryIntentActivities(Intent, int) is the only form below API 33.
  private static List<ResolveInfo> queryHandlers(PackageManager packageManager, Intent intent) {
    return packageManager.queryIntentActivities(intent, 0);
  }
}
