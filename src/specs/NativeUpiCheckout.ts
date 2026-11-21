import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Native UPI launcher. Results are plain objects validated by `src/api.ts`.
 *
 * - `getInstalledApps(candidates)`: Android ignores `candidates` and returns
 *   `{ packageName, name }` for every activity that handles `upi://pay`. iOS
 *   returns `{ id, name }` for each candidate `{ id, name, url }` whose `url`
 *   `canOpenURL` accepts.
 * - `pay(url, packageName, chooserTitle)` resolves `{ outcome: 'result',
 *   resultCode, response }` on Android, `{ outcome: 'launched' }` on iOS, or
 *   `{ outcome: 'unavailable' }` when nothing can open the URL.
 */
export interface Spec extends TurboModule {
  getInstalledApps(candidates: Array<Object>): Promise<Array<Object>>;
  pay(url: string, packageName: string | null, chooserTitle: string | null): Promise<Object>;
}

export default TurboModuleRegistry.get<Spec>('UpiCheckout');
