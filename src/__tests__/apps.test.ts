import { IOS_QUERY_SCHEMES, KNOWN_UPI_APPS } from '../index';
import { findKnownUpiApp, toIosAppUrl } from '../apps';

describe('KNOWN_UPI_APPS', () => {
  it('has unique ids, packages and schemes, and a {query} in every template', () => {
    const unique = (values: string[]) => new Set(values).size === values.length;
    expect(unique(KNOWN_UPI_APPS.map((app) => app.id))).toBe(true);
    expect(unique(KNOWN_UPI_APPS.map((app) => app.androidPackage))).toBe(true);
    for (const app of KNOWN_UPI_APPS) {
      expect(app.iosPayUrl.startsWith(`${app.iosScheme}://`)).toBe(true);
      expect(app.iosPayUrl).toContain('{query}');
      expect(app.iosScheme).toMatch(/^[a-z][a-z0-9+.-]*$/);
    }
  });

  it('lists the generic scheme first and stays far below the iOS limit of 50', () => {
    expect(IOS_QUERY_SCHEMES[0]).toBe('upi');
    expect(IOS_QUERY_SCHEMES.length).toBeLessThan(50);
  });

  it('matches the LSApplicationQueriesSchemes list in the README', () => {
    // Jest runs from the package root; `require` avoids a dependency on Node's types.
    const readme: string = require('fs').readFileSync(require('path').resolve('README.md'), 'utf8');
    const block = /<key>LSApplicationQueriesSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(readme);
    expect(block).not.toBeNull();
    const listed: string[] = [];
    const entry = /<string>([^<]+)<\/string>/g;
    for (let match = entry.exec(block![1]); match; match = entry.exec(block![1])) listed.push(match[1]);
    expect(listed).toEqual(IOS_QUERY_SCHEMES);
  });

  it('turns the upi URL into the per-app URL without touching the query', () => {
    const app = findKnownUpiApp('gpay')!;
    expect(toIosAppUrl(app, 'upi://pay?pa=a@b&pn=%24%26%241&tn=$1$&')).toBe('tez://upi/pay?pa=a@b&pn=%24%26%241&tn=$1$&');
    expect(findKnownUpiApp('missing')).toBeUndefined();
  });
});
