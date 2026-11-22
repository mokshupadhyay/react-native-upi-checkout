# Device testing

Version 0.1.1 has not been run on a device. The JavaScript is covered by unit tests against a mocked native module, the Android Java has been compiled, and the Android request state and extras parsing have plain-JVM tests (`sh scripts/android-jvm-test.sh`), but nothing below has been checked yet. Work through this list before calling a release tested, and write down the device, OS version, app names and app versions for each run.

Use a merchant or personal VPA you control and small amounts (₹1). Never use someone else's VPA. Confirm every real payment in the payee's bank or PSP dashboard, not in the app under test.

## Test app

1. Create a React Native app (for example `npx @react-native-community/cli init UpiTest`), then `npm pack` this library and install the `.tgz` in that app.
2. Add a screen with buttons for `isUpiAvailable()`, `getInstalledUpiApps()`, `pay(params)`, `pay(params, { packageName })` on Android, `pay(params, { iosApp })` on iOS and `getLastResult()`, and show the JSON of every result or `error.code` / `error.message`. Call `getLastResult()` once when the screen mounts and show that too.
3. Log `result.response.raw` for every `completed` result. The raw strings are the most useful thing to collect.

## Android, both architectures

Run every check below twice:

- **New Architecture:** `newArchEnabled=true` in `android/gradle.properties` (the only option on React Native 0.82+).
- **Old architecture:** React Native 0.81 or earlier with `newArchEnabled=false`.

Build checks:

1. `cd android && ./gradlew assembleDebug` succeeds.
2. The merged manifest (`app/build/intermediates/merged_manifest/debug/.../AndroidManifest.xml`) contains the `<queries>` entry for the `upi` scheme.
3. On the New Architecture, `app/build/generated/source/codegen` (or the library's `android/build/generated/source/codegen`) contains `NativeUpiCheckoutSpec.java`.
4. `NativeModules.UpiCheckout` (old) or `TurboModuleRegistry.get('UpiCheckout')` (new) is not null at runtime.

Device with at least two UPI apps installed (for example Google Pay, PhonePe, Paytm, BHIM), on Android 11 or later:

1. `getInstalledUpiApps()` lists every installed UPI app with a readable name and its package name. Compare with the system's own "Open with" list. Apps whose `upi://pay` activity lacks `CATEGORY_DEFAULT` must not be listed (the query uses `MATCH_DEFAULT_ONLY`); note any app that is missing but does open from the chooser.
2. `isUpiAvailable()` is `true`.
3. `pay(params, { chooserTitle: 'Pay with' })` shows the system chooser with that title.
4. **Success:** pay ₹1 and finish the payment. Expect `completed` with `response.status` `success`, a `transactionId`, and `transactionRef` equal to the one sent. Note `resultCode` (`-1` is `RESULT_OK`). If an app returns no data, expect `completed` with `status: 'unknown'` and `raw: ''` (never `cancelled`); record which app does this.
5. **User cancel inside the UPI app:** open the app, then press back before entering the PIN. Expect `cancelled`, or `completed` with `status: 'failure'`, depending on the app. Record which.
6. **Cancel in the chooser:** dismiss the chooser without picking an app. Expect `cancelled` with `resultCode` `0`.
7. **Wrong PIN / declined:** expect `completed` with `status: 'failure'` and a `responseCode`.
8. **Pending:** a payment that the bank does not settle at once (rare; sometimes seen with a slow bank or by turning off mobile data right after entering the PIN). Expect `completed` with `status: 'submitted'`. Check that the server-side status later reports the final state.
9. **Direct app:** `pay(params, { packageName: 'com.phonepe.app' })` (or another installed package) opens that app without the chooser. A package that is not installed resolves `unavailable`.
10. **In flight:** call `pay()` twice quickly. The second call rejects with `IN_PROGRESS`; the first one still settles. With `useUpiPayment()`, double-tap the button: the status stays `launching` and the button stays disabled until the first payment settles.
11. **Return path:** after a payment, switch back to the app from the recent apps list instead of finishing in the UPI app. Expect the promise to settle (usually `cancelled`). Then launch the app from the home screen icon in the same situation and check that the promise settles or rejects with `ACTIVITY_UNAVAILABLE`, and never hangs. If the same activity comes back and no result arrives, expect `completed` with `resultCode: null` and `status: 'unknown'` about 1.5 seconds after the app is visible again, and a following `pay()` that works.
12. **Don't keep activities** (Developer options → "Don't keep activities"): start a payment from a screen that uses `useUpiPayment()`, finish or cancel it in the UPI app, and return. What should happen: Android destroyed your activity while the UPI app was in front, so React Native unmounted the screen; the recreated activity receives the result and the original `pay()` promise settles, but the unmounted hook never sees it, and the remounted screen's hook shows `idle`. Check that `getLastResult()`, called when the screen mounts, resolves to the result with the `transactionRef` you sent and a recent `time`. That is how an app recovers here: compare `transactionRef` with the order on screen and ask the server. Record whether the promise settled at all; if it rejected with `ACTIVITY_UNAVAILABLE` instead, check that `getLastResult()` still has the result.
13. **JavaScript reload while waiting** (debug build, press `r` in Metro while the UPI app is open): the old promise rejects with `ACTIVITY_UNAVAILABLE`, the app does not crash, and a new `pay()` works. Finish the payment in the UPI app after the reload: `getLastResult()` in the reloaded app returns that result with its `transactionRef`.
14. **Rotation** while the UPI app is open, then return: the result still arrives.
15. **Background start:** call `pay()` from a timer a few seconds after pressing Home. Expect a rejection with `ACTIVITY_UNAVAILABLE`, no UPI app opening, and a working `pay()` after returning to the app.
16. Repeat steps 4 and 5 with every installed app and record `raw` for each. Add any new key spelling to `src/response.ts` and a test case.
17. Check `tn` and `pn` with spaces, `&`, and Hindi text, and `transactionRef` with only letters and digits. Record which apps refuse which characters.

Device without any UPI app (or an emulator without Google Play):

1. `getInstalledUpiApps()` resolves `[]` and `isUpiAvailable()` is `false`.
2. `pay(params)` resolves `unavailable` and does not show an empty chooser.

Android 10 or earlier (no package visibility rules): repeat the detection checks; the result should be the same as on Android 11+.

React Native 0.60 to 0.64 (old architecture only): build the test app on one of these releases, reload JavaScript while the UPI app is open (check 13), and check that the waiting promise rejects. Those releases call `onCatalystInstanceDestroy()` instead of `invalidate()`; the module implements both.

## iOS

The iOS code has not been compiled in a real app. First check:

1. `cd ios && pod install` succeeds, on both the New Architecture (default on React Native 0.76+) and, on React Native 0.81 or earlier, with `RCT_NEW_ARCH_ENABLED=0`.
2. The app builds in Xcode for a device and for a simulator.

Scheme detection (needs a real device with UPI apps; the simulator has none):

1. Without `LSApplicationQueriesSchemes`: `getInstalledUpiApps()` resolves `[]` and Xcode logs `-canOpenURL: failed for URL ... This app is not allowed to query for scheme`.
2. With the schemes from the README: every installed app in `KNOWN_UPI_APPS` is listed, and apps that are not installed are not.
3. Install and uninstall one app (for example PhonePe) and check that the list follows.
4. `isUpiAvailable()` is `true` with at least one UPI app installed, and `false` with none.

Opening apps:

1. `pay(params)` opens an app through the generic `upi://pay` URL and resolves `launched`. Record which app iOS picks when several are installed.
2. For each app in `KNOWN_UPI_APPS`, `pay(params, { iosApp: id })` opens that app on its payment screen with payee, amount and note filled in. **These URL templates are best effort.** When one fails, find the working URL, fix it in `src/apps.ts`, and update the README table if the scheme changed.
3. `pay(params, { iosApp: id })` for an app that is not installed resolves `unavailable`.
4. Complete a ₹1 payment, switch back to the app by hand, and confirm that your server reports the payment. The library cannot report it on iOS.

## Report

For each run, note: device, OS version, React Native version, architecture, the UPI app and its version, the check number, the result JSON, and `raw`. Open an issue with the results, especially when an app returns something the parser reports as `unknown`.
