/**
 * Known UPI apps: the one table this library uses for iOS app detection and
 * for per-app payment URLs on iOS. The native iOS code has no copy of it; the
 * JavaScript side passes these entries to `canOpenURL` and `openURL`.
 *
 * BEST EFFORT: the iOS schemes and URL templates below are not published by
 * NPCI and can change with any app update. Each one must be checked on a
 * device (see docs/DEVICE_TESTING.md). To fix or add an app, edit only this
 * table, then update the `LSApplicationQueriesSchemes` list in the README;
 * a test checks that the two match.
 *
 * `iosPayUrl` is a template: `{query}` is replaced with the query string of
 * the `upi://pay?...` URL built by `buildUpiUrl`.
 */
export interface KnownUpiApp {
  /** Stable id, used as `pay(params, { iosApp })`. */
  id: string;
  name: string;
  /** Android package name, for `pay(params, { packageName })`. */
  androidPackage: string;
  /** URL scheme the iOS app registers, without `://`. */
  iosScheme: string;
  /** iOS payment URL template containing `{query}`. */
  iosPayUrl: string;
}

export const KNOWN_UPI_APPS: ReadonlyArray<KnownUpiApp> = [
  {
    id: 'gpay',
    name: 'Google Pay',
    androidPackage: 'com.google.android.apps.nbu.paisa.user',
    iosScheme: 'tez',
    iosPayUrl: 'tez://upi/pay?{query}',
  },
  {
    id: 'phonepe',
    name: 'PhonePe',
    androidPackage: 'com.phonepe.app',
    iosScheme: 'phonepe',
    iosPayUrl: 'phonepe://pay?{query}',
  },
  {
    id: 'paytm',
    name: 'Paytm',
    androidPackage: 'net.one97.paytm',
    iosScheme: 'paytmmp',
    iosPayUrl: 'paytmmp://pay?{query}',
  },
  {
    id: 'bhim',
    name: 'BHIM',
    androidPackage: 'in.org.npci.upiapp',
    iosScheme: 'bhim',
    iosPayUrl: 'bhim://upi/pay?{query}',
  },
  {
    id: 'cred',
    name: 'CRED',
    androidPackage: 'com.dreamplug.androidapp',
    iosScheme: 'credpay',
    iosPayUrl: 'credpay://upi/pay?{query}',
  },
];

/** The generic scheme. iOS opens it with whichever installed app claims it. */
export const GENERIC_UPI_SCHEME = 'upi';

/**
 * Every scheme the host app must list under `LSApplicationQueriesSchemes` in
 * its `Info.plist` so that `canOpenURL` can see the apps. iOS reads at most 50
 * entries from that list.
 */
export const IOS_QUERY_SCHEMES: ReadonlyArray<string> = [GENERIC_UPI_SCHEME].concat(
  KNOWN_UPI_APPS.map((app) => app.iosScheme).filter((scheme, index, all) => all.indexOf(scheme) === index),
);

export function findKnownUpiApp(id: string): KnownUpiApp | undefined {
  for (const app of KNOWN_UPI_APPS) {
    if (app.id === id) return app;
  }
  return undefined;
}

/** Turn `upi://pay?pa=...` into the app's own URL, for example `phonepe://pay?pa=...`. */
export function toIosAppUrl(app: KnownUpiApp, upiUrl: string): string {
  const index = upiUrl.indexOf('?');
  const query = index === -1 ? '' : upiUrl.slice(index + 1);
  // A function replacer, so `$` sequences in the query are never special.
  return app.iosPayUrl.replace('{query}', () => query);
}
