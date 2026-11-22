package com.upicheckout;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;

/** Legacy bridge module with the same surface as the TurboModule spec. */
public class UpiCheckoutModule extends ReactContextBaseJavaModule {
  public static final String NAME = UpiCheckoutModuleImpl.NAME;

  private final UpiCheckoutModuleImpl impl;

  public UpiCheckoutModule(ReactApplicationContext context) {
    super(context);
    impl = new UpiCheckoutModuleImpl(context);
  }

  @Override
  @NonNull
  public String getName() {
    return NAME;
  }

  @ReactMethod
  public void getInstalledApps(ReadableArray candidates, Promise promise) {
    // Android asks the package manager; the candidates are for iOS.
    impl.getInstalledApps(promise);
  }

  @ReactMethod
  public void pay(String url, @Nullable String packageName, @Nullable String chooserTitle, Promise promise) {
    impl.pay(url, packageName, chooserTitle, promise);
  }

  @ReactMethod
  public void getLastResult(Promise promise) {
    impl.getLastResult(promise);
  }

  /*
   * Teardown. React Native 0.65 and later call invalidate(); 0.60 to 0.64
   * call onCatalystInstanceDestroy(), and 0.60 to 0.63 have no invalidate()
   * to override. Neither method is marked @Override so that this file
   * compiles on the whole supported range. impl.invalidate() runs once even
   * when a release calls both.
   */

  public void invalidate() {
    impl.invalidate();
  }

  @SuppressWarnings({"deprecation", "removal"}) // Deprecated in newer releases; the only teardown hook on 0.60-0.64.
  public void onCatalystInstanceDestroy() {
    impl.invalidate();
  }
}
