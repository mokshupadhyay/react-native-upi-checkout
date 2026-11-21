# Changelog

## 0.1.0

First release. Not yet run on a device; see [docs/DEVICE_TESTING.md](docs/DEVICE_TESTING.md).

- `buildUpiUrl()`: exact `upi://pay` URLs with a fixed parameter order, percent-encoded values and two-decimal amounts checked with integer arithmetic.
- `validateUpiParams()`: typed problems for required fields, VPA shape, amount, currency, merchant code, and overridable conservative length limits.
- `parseUpiResponse()`: case- and order-insensitive parsing of Android UPI app responses into `success`, `failure`, `submitted` or `unknown`.
- `getInstalledUpiApps()` and `isUpiAvailable()`: `upi://pay` handlers on Android, `canOpenURL` against the `KNOWN_UPI_APPS` table on iOS.
- `pay()`: system chooser or a specific app on Android with the result read from `onActivityResult`; opening the app on iOS, which resolves `launched`. One payment in flight at a time, typed `UpiError` codes.
- `useUpiPayment()` hook.
- Android bridge module and TurboModule around one shared implementation; iOS module for both architectures.
