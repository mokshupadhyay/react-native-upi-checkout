package com.upicheckout;

import androidx.annotation.NonNull;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.Collections;
import java.util.List;

public class UpiCheckoutPackage implements ReactPackage {
  @NonNull
  @Override
  @SuppressWarnings("deprecation") // Deprecated only on releases that no longer build this source set.
  public List<NativeModule> createNativeModules(@NonNull ReactApplicationContext context) {
    return Collections.<NativeModule>singletonList(new UpiCheckoutModule(context));
  }

  @NonNull
  @Override
  @SuppressWarnings("rawtypes")
  public List<ViewManager> createViewManagers(@NonNull ReactApplicationContext context) {
    return Collections.emptyList();
  }
}
