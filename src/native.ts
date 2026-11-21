import * as ReactNative from 'react-native';
import type { Spec } from './specs/NativeUpiCheckout';

function isTurboModuleRuntime(): boolean {
  const root = globalThis as { __turboModuleProxy?: unknown; RN$Bridgeless?: unknown };
  return root.__turboModuleProxy != null || root.RN$Bridgeless === true;
}

/**
 * Load the TurboModule on the New Architecture and the bridge module on the
 * old one. The spec is required lazily so that a missing module never throws
 * at import time.
 */
function loadNativeModule(): Spec | null {
  if (isTurboModuleRuntime()) {
    try {
      const turboModule = require('./specs/NativeUpiCheckout').default as Spec | null;
      if (turboModule) return turboModule;
    } catch {
      // Fall through to the bridge lookup.
    }
  }
  const legacy = ReactNative.NativeModules.UpiCheckout as Spec | undefined;
  return legacy ?? null;
}

let cached: Spec | null | undefined;

export function getNativeModule(): Spec | null {
  if (cached === undefined) cached = loadNativeModule();
  return cached;
}

/** Test hook: forget the resolved module. */
export function resetNativeModuleCache(): void {
  cached = undefined;
}
