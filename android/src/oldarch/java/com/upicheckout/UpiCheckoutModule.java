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

  @Override
  public void invalidate() {
    impl.invalidate();
  }
}
