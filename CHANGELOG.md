# Changelog

## 0.1.1

Fixes from a code review. Still not run on a device; see [docs/DEVICE_TESTING.md](docs/DEVICE_TESTING.md).

Behavior changes that can affect your code are marked **(changed)**.

- **(changed)** Android: a result with no response data is only `cancelled` when the result code is `RESULT_CANCELED`. `RESULT_OK` without data, which some apps send after a successful payment, was reported as `cancelled` and could lead a user who paid to pay again. It is now `completed` with `response.status: 'unknown'` and `response.raw: ''`. Confirm on your server.
- **(changed)** Android: `pay()` rejects with `ACTIVITY_UNAVAILABLE` unless the activity is resumed. Started from the background, the request could stay pending forever, so every later `pay()` rejected with `IN_PROGRESS`.
- **(changed)** Android: when the activity that started a payment resumes and no result arrives within 1.5 seconds, the request settles as `completed` with `resultCode: null` and `status: 'unknown'` instead of waiting forever. `resultCode` on `completed` is now `number | null`.
- New `getLastResult()`: the most recent result with its `transactionRef` and time, kept in JavaScript and, on Android, in the native module (also for a result that arrives after a JavaScript reload). A screen that was unmounted because Android destroyed the activity can recover the result.
- `useUpiPayment()`: a `pay` call while a payment is in flight resolves to `null` and leaves the state alone. A double tap set `error: IN_PROGRESS` and re-enabled the button.
- `useUpiPayment()`: after `reset()`, a late result of the earlier call no longer overwrites the state. It is still kept for `getLastResult()`.
- Android: the `response` extra (`response`, `Response`, `RESPONSE`) is read first and on its own, and every other extra is read in its own `try`, so one extra that fails to unparcel no longer discards a valid response.
- Android: the separate-extras fallback runs when any key the JavaScript parser knows is present (`txnStatus`, `txnId`, `txnRef`, `responseCode`, `ApprovalRefNo`, ...), not only a key named `status`, and joins the extras in sorted key order.
- Android: `getInstalledUpiApps()` and the check before a payment use `MATCH_DEFAULT_ONLY`, so apps an implicit intent cannot open are no longer listed. The `int` flags overload is kept on API 33+ so the library still compiles with a `compileSdkVersion` below 33.
- Android (old architecture): teardown also runs on React Native 0.60 to 0.64, which call `onCatalystInstanceDestroy()`; on 0.60 to 0.63 the 0.1.0 module did not compile, because it overrode `invalidate()`, which those releases do not have. Compiled against 0.60.6, 0.64.4, 0.65.3 and 0.88.0.
- `parseUpiResponse()`: `+` decodes as a space (form encoding), `%2B` stays a plus sign.
- `pay()`: a response of `"null"`, `"undefined"` or only whitespace counts as no response.
- **(changed)** `validateUpiParams()`: `payeeVpa` must be `handle@provider` with a handle that starts with a letter or digit and has no two dots in a row, and a provider of letters and digits. `-@-`, `.@b`, `a@b..` and `a..b@okaxis` were accepted. A dotted or hyphenated provider (`ok.bank`) is now rejected too.
- **(changed)** `validateUpiParams()`: control characters (including tabs and line breaks) are rejected with `INVALID_CHARACTERS`, and leading or trailing whitespace with the new code `SURROUNDING_WHITESPACE`. Values are not trimmed. `' R1 '` used to become `tr=%20R1%20`.
- **(changed)** `validateUpiParams()`: `transactionId` (35) and `url` (255) have default length limits, and `url` must be an absolute `https:` or `http:` URL (new code `INVALID_URL`); `javascript:` was accepted.
- `validateUpiParams()`: `currency: null` counts as absent, like `null` in every other optional field.
- Plain-JVM tests for the Android request state and extras parsing (`scripts/android-jvm-test.sh`). `scripts/android-compile-check.sh` accepts `REACT_NATIVE_AAR` for releases before 0.71.

## 0.1.0

First release. Not yet run on a device; see [docs/DEVICE_TESTING.md](docs/DEVICE_TESTING.md).

- `buildUpiUrl()`: exact `upi://pay` URLs with a fixed parameter order, percent-encoded values and two-decimal amounts checked with integer arithmetic.
- `validateUpiParams()`: typed problems for required fields, VPA shape, amount, currency, merchant code, and overridable conservative length limits.
- `parseUpiResponse()`: case- and order-insensitive parsing of Android UPI app responses into `success`, `failure`, `submitted` or `unknown`.
- `getInstalledUpiApps()` and `isUpiAvailable()`: `upi://pay` handlers on Android, `canOpenURL` against the `KNOWN_UPI_APPS` table on iOS.
- `pay()`: system chooser or a specific app on Android with the result read from `onActivityResult`; opening the app on iOS, which resolves `launched`. One payment in flight at a time, typed `UpiError` codes.
- `useUpiPayment()` hook.
- Android bridge module and TurboModule around one shared implementation; iOS module for both architectures.
