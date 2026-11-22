/**
 * Checks on the Android Java sources that a JVM test cannot make: which
 * PackageManager flags are used and which teardown hooks exist. The request
 * state and the extras parsing have behavioral tests in android/jvm-test
 * (scripts/android-jvm-test.sh), and compiling is checked by
 * scripts/android-compile-check.sh.
 */
import { KEY_ALIASES } from '../response';

// Node's fs and path, typed locally: the package has no @types/node.
const fs = require('fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const path = require('path') as { resolve(...parts: string[]): string };
const read = (file: string) => fs.readFileSync(path.resolve('android/src', file), 'utf8');
const impl = read('main/java/com/upicheckout/UpiCheckoutModuleImpl.java');
const oldArchModule = read('oldarch/java/com/upicheckout/UpiCheckoutModule.java');
const extras = read('main/java/com/upicheckout/UpiResponseExtras.java');

// Finding 8 (0.1.1).
it('queries UPI handlers with MATCH_DEFAULT_ONLY everywhere', () => {
  const calls = impl.match(/queryIntentActivities\([^;]*;/g) || [];
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) expect(call).toContain('MATCH_DEFAULT_ONLY');
  expect(impl).not.toMatch(/queryIntentActivities\(\s*intent\s*,\s*0\s*\)/);
});

// Finding 12 (0.1.1): React Native 0.60 to 0.64 call onCatalystInstanceDestroy
// and 0.60 to 0.63 have no invalidate() to override.
it('implements both teardown hooks in the old-architecture module without @Override', () => {
  for (const method of ['invalidate', 'onCatalystInstanceDestroy']) {
    const at = oldArchModule.indexOf(`public void ${method}() {`);
    expect(at).toBeGreaterThan(-1);
    // Everything between the previous member and this method: its annotations.
    const before = oldArchModule.slice(0, at);
    const annotations = before.slice(Math.max(before.lastIndexOf('}'), before.lastIndexOf('*/')) + 1);
    expect(annotations).not.toContain('@Override');
    expect(oldArchModule.slice(at, oldArchModule.indexOf('}', at))).toContain('impl.invalidate();');
  }
});

// Finding 7 (0.1.1): the native fallback must recognize the same keys as the parser.
it('lists the same known keys in Java as the JavaScript parser accepts', () => {
  const block = /KNOWN_KEYS = new HashSet<>\(Arrays\.asList\(([^)]*)\)\)/.exec(extras);
  expect(block).not.toBeNull();
  const javaKeys = (block![1].match(/"([a-z0-9]+)"/g) || []).map((key) => key.slice(1, -1)).sort();
  expect(javaKeys).toEqual(Object.keys(KEY_ALIASES).sort());
});
