import { Platform } from 'react-native';
import { GENERIC_UPI_SCHEME, KNOWN_UPI_APPS, findKnownUpiApp, toIosAppUrl } from './apps';
import { UpiError, toUpiError } from './errors';
import { getNativeModule } from './native';
import { parseUpiResponse } from './response';
import { buildUpiUrl } from './url';
import type { UpiApp, UpiPayOptions, UpiPayResult, UpiPaymentParams } from './types';

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

function readResult(raw: unknown): UpiPayResult {
  if (isRecord(raw)) {
    if (raw.outcome === 'result') {
      const resultCode = typeof raw.resultCode === 'number' ? raw.resultCode : 0;
      const response = typeof raw.response === 'string' ? raw.response : '';
      if (response.trim().length === 0) return { kind: 'cancelled', resultCode };
      return { kind: 'completed', response: parseUpiResponse(response), resultCode };
    }
    if (raw.outcome === 'launched') return { kind: 'launched' };
    if (raw.outcome === 'unavailable') return { kind: 'unavailable' };
  }
  throw new UpiError('UNKNOWN', 'The native module returned an unexpected result.');
}

let inFlight = false;

/**
 * Start a UPI payment.
 *
 * Android opens the system chooser (titled `chooserTitle`), or the app named
 * by `packageName`, and resolves when the user returns: `completed` with the
 * parsed response, or `cancelled` when no response came back.
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
 * made before the first settles rejects with `IN_PROGRESS`.
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
    return readResult(raw);
  } finally {
    inFlight = false;
  }
}
