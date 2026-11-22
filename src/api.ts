import { Platform } from 'react-native';
import { GENERIC_UPI_SCHEME, KNOWN_UPI_APPS, findKnownUpiApp, toIosAppUrl } from './apps';
import { UpiError, toUpiError } from './errors';
import { getNativeModule } from './native';
import { parseUpiResponse } from './response';
import { buildUpiUrl } from './url';
import type { UpiApp, UpiLastResult, UpiPayOptions, UpiPayResult, UpiPaymentParams } from './types';

type Candidate = { id: string; name: string; url: string };

function knownCandidates(): Candidate[] {
  return KNOWN_UPI_APPS.map((app) => ({ id: app.id, name: app.name, url: `${app.iosScheme}://` }));
}

const GENERIC_CANDIDATE: Candidate = { id: GENERIC_UPI_SCHEME, name: 'UPI', url: `${GENERIC_UPI_SCHEME}://pay` };

function notLinked(): UpiError {
  return new UpiError(
    'NOT_LINKED',
    'react-native-upi-checkout: the native module is not linked. Rebuild the app ' +
      '(Expo Go and web are not supported).',
  );
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return value != null && typeof value === 'object';
}

async function queryApps(candidates: Candidate[]): Promise<UpiApp[]> {
  const nativeModule = getNativeModule();
  if (!nativeModule || (Platform.OS !== 'android' && Platform.OS !== 'ios')) return [];
  const raw: unknown = await nativeModule.getInstalledApps(candidates);
  if (!Array.isArray(raw)) return [];
  const apps: UpiApp[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (Platform.OS === 'android') {
      if (typeof item.packageName !== 'string' || item.packageName.length === 0) continue;
      const name = typeof item.name === 'string' && item.name.length > 0 ? item.name : item.packageName;
      apps.push({ name, packageName: item.packageName });
    } else {
      if (typeof item.id !== 'string') continue;
      const known = findKnownUpiApp(item.id);
      if (known) apps.push({ name: known.name, iosApp: known.id });
      else if (item.id === GENERIC_UPI_SCHEME) apps.push({ name: GENERIC_CANDIDATE.name });
    }
  }
  return apps;
}

/**
 * Apps that can handle a UPI payment.
 *
 * Android: every app with an activity for `upi://pay`, with its label and
 * package name (needs the `<queries>` entry this library's manifest adds).
 * iOS: the apps in `KNOWN_UPI_APPS` whose scheme `canOpenURL` accepts. The
 * host app must list the schemes under `LSApplicationQueriesSchemes`.
 *
 * Resolves to `[]` when the native module is not linked.
 */
export function getInstalledUpiApps(): Promise<UpiApp[]> {
  return queryApps(Platform.OS === 'ios' ? knownCandidates() : []);
}

/**
 * Whether any app can handle a UPI payment. On iOS this also checks the
 * generic `upi://` scheme. Resolves to `false` when the native module is not
 * linked.
 */
export async function isUpiAvailable(): Promise<boolean> {
  const candidates = Platform.OS === 'ios' ? knownCandidates().concat(GENERIC_CANDIDATE) : [];
  return (await queryApps(candidates)).length > 0;
}

/** Android's `Activity.RESULT_CANCELED`. */
const RESULT_CANCELED = 0;

// Some apps send the text "null" or "undefined" instead of leaving the
// response out. Neither is a response.
function hasResponseText(response: string): boolean {
  const trimmed = response.trim().toLowerCase();
  return trimmed.length > 0 && trimmed !== 'null' && trimmed !== 'undefined';
}

/**
 * Map the native result. A missing response only means "cancelled" when
 * Android also reported `RESULT_CANCELED`. Some apps finish with `RESULT_OK`
 * and no data after a successful payment, and the native side reports a
 * request that never got any result with `resultCode: null`. Both become
 * `completed` with `status: 'unknown'`, so the app checks its server instead
 * of telling a user who may have paid that they cancelled.
 */
function readResult(raw: unknown): UpiPayResult {
  if (isRecord(raw)) {
    if (raw.outcome === 'result') {
      const resultCode = typeof raw.resultCode === 'number' ? raw.resultCode : null;
      const response = typeof raw.response === 'string' && hasResponseText(raw.response) ? raw.response : '';
      if (response.length > 0) return { kind: 'completed', response: parseUpiResponse(response), resultCode };
      if (resultCode === RESULT_CANCELED) return { kind: 'cancelled', resultCode };
      return { kind: 'completed', response: { status: 'unknown', raw: '' }, resultCode };
    }
    if (raw.outcome === 'launched') return { kind: 'launched' };
    if (raw.outcome === 'unavailable') return { kind: 'unavailable' };
  }
  throw new UpiError('UNKNOWN', 'The native module returned an unexpected result.');
}

let lastResult: UpiLastResult | null = null;

function remember(result: UpiPayResult, transactionRef: string | null): void {
  lastResult = { result, transactionRef, time: Date.now() };
}

function readNativeLastResult(raw: unknown): UpiLastResult | null {
  if (!isRecord(raw) || typeof raw.time !== 'number' || !isFinite(raw.time)) return null;
  try {
    return {
      result: readResult(raw),
      transactionRef: typeof raw.transactionRef === 'string' ? raw.transactionRef : null,
      time: raw.time,
    };
  } catch {
    return null;
  }
}

/**
 * The most recent payment result, or `null` when none has settled since the
 * app started.
 *
 * Use it when the screen that called `pay()` may have been unmounted while
 * the UPI app was open, for example when Android destroyed the activity
 * ("Don't keep activities", low memory). The promise still settles, but the
 * unmounted component never sees it. A screen that mounts again can call
 * `getLastResult()`, compare `transactionRef` with the order it shows, and
 * then ask the server.
 *
 * JavaScript keeps every result `pay()` resolved with. On Android the native
 * module also keeps the last result the UPI app sent, even when no
 * JavaScript promise was waiting for it any more (for example after a
 * JavaScript reload). The newer of the two is returned. Rejections are not
 * recorded. Nothing survives the app process being killed. `time` is
 * milliseconds since the epoch, taken when the result was recorded.
 *
 * Like every result, this is a CLIENT-SIDE CLAIM. Confirm on your server.
 */
export async function getLastResult(): Promise<UpiLastResult | null> {
  const fromJs = lastResult;
  const nativeModule = getNativeModule();
  let fromNative: UpiLastResult | null = null;
  if (nativeModule && typeof nativeModule.getLastResult === 'function') {
    try {
      fromNative = readNativeLastResult(await nativeModule.getLastResult());
    } catch {
      fromNative = null;
    }
  }
  if (fromNative && (!fromJs || fromNative.time > fromJs.time)) return fromNative;
  return fromJs;
}

/** Test hook: forget the last result kept in JavaScript. */
export function resetLastResult(): void {
  lastResult = null;
}

let inFlight = false;

/** Whether a `pay()` call is waiting to settle. Used by the hook. */
export function isPaymentInFlight(): boolean {
  return inFlight;
}

/**
 * Start a UPI payment.
 *
 * Android opens the system chooser (titled `chooserTitle`), or the app named
 * by `packageName`, and resolves when the user returns: `completed` with the
 * parsed response, or `cancelled` when Android reported `RESULT_CANCELED`
 * and no response came back. A result without a response but with any other
 * result code (some apps send `RESULT_OK` and no data after a successful
 * payment) is `completed` with `response.status: 'unknown'`: ask your server.
 * Android only starts the UPI app while your activity is in the foreground;
 * otherwise `pay()` rejects with `ACTIVITY_UNAVAILABLE`.
 *
 * iOS opens the app named by `iosApp`, or the generic `upi://pay` URL, and
 * resolves with `launched` at once: iOS apps cannot return a result.
 *
 * Both resolve with `unavailable` when no app can handle the payment.
 *
 * The response is a CLIENT-SIDE CLAIM and never proof of payment. Confirm
 * the payment on your server (your PSP's status API or a webhook) before you
 * fulfil an order. This library never sees credentials, PINs or card data and
 * makes no network calls.
 *
 * Rejects with a `UpiError`. Only one payment can be in flight; a second call
 * made before the first settles rejects with `IN_PROGRESS`. The last result
 * is kept for `getLastResult()`.
 */
export async function pay(params: UpiPaymentParams, options: UpiPayOptions = {}): Promise<UpiPayResult> {
  if (inFlight) {
    throw new UpiError('IN_PROGRESS', 'Another UPI payment is still waiting for its result.');
  }
  const url = buildUpiUrl(params, options);
  const isIos = Platform.OS === 'ios';

  let launchUrl = url;
  if (isIos && options.iosApp !== undefined) {
    const app = typeof options.iosApp === 'string' ? findKnownUpiApp(options.iosApp) : undefined;
    if (!app) {
      throw new UpiError(
        'INVALID_PARAMS',
        `Unknown iosApp "${String(options.iosApp)}". Use an id from KNOWN_UPI_APPS.`,
      );
    }
    launchUrl = toIosAppUrl(app, url);
  }
  const packageName = !isIos && options.packageName !== undefined ? options.packageName : null;
  if (packageName !== null && (typeof packageName !== 'string' || packageName.trim().length === 0)) {
    throw new UpiError('INVALID_PARAMS', 'packageName must be a non-empty string.');
  }
  const chooserTitle =
    typeof options.chooserTitle === 'string' && options.chooserTitle.length > 0 ? options.chooserTitle : null;

  const nativeModule = getNativeModule();
  if (!nativeModule) throw notLinked();

  inFlight = true;
  try {
    let raw: unknown;
    try {
      raw = await nativeModule.pay(launchUrl, packageName, chooserTitle);
    } catch (error) {
      throw toUpiError(error);
    }
    const result = readResult(raw);
    remember(result, typeof params.transactionRef === 'string' ? params.transactionRef : null);
    return result;
  } finally {
    inFlight = false;
  }
}
