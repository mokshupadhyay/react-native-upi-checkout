import { NativeModules, Platform } from 'react-native';
import { getInstalledUpiApps, getLastResult, isUpiAvailable, pay, UpiError } from '../index';
import type { UpiPaymentParams } from '../index';
import { resetLastResult } from '../api';
import { resetNativeModuleCache } from '../native';

interface FakeModule {
  getInstalledApps: jest.Mock;
  pay: jest.Mock;
  getLastResult?: jest.Mock;
}

const params: UpiPaymentParams = {
  payeeVpa: 'shop@okbank',
  payeeName: 'Corner Shop',
  amount: '10',
  transactionRef: 'ORDER42',
  note: 'Order 42',
};

const URL = 'upi://pay?pa=shop@okbank&pn=Corner%20Shop&tr=ORDER42&tn=Order%2042&am=10.00&cu=INR';

function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

function installFake(overrides: Partial<FakeModule> = {}): FakeModule {
  const fake: FakeModule = {
    getInstalledApps: jest.fn(async () => []),
    pay: jest.fn(async () => ({ outcome: 'result', resultCode: -1, response: 'Status=SUCCESS&txnId=T1' })),
    ...overrides,
  };
  (NativeModules as { UpiCheckout?: unknown }).UpiCheckout = fake;
  resetNativeModuleCache();
  return fake;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const originalOS = Platform.OS;

afterEach(() => {
  delete (NativeModules as { UpiCheckout?: unknown }).UpiCheckout;
  resetNativeModuleCache();
  resetLastResult();
  jest.restoreAllMocks();
  setPlatform(originalOS as 'ios' | 'android');
});

describe('without the native module', () => {
  it('reports no apps and rejects pay with NOT_LINKED', async () => {
    await expect(getInstalledUpiApps()).resolves.toEqual([]);
    await expect(isUpiAvailable()).resolves.toBe(false);
    await expect(pay(params)).rejects.toMatchObject({ code: 'NOT_LINKED' });
  });
});

describe('on Android', () => {
  beforeEach(() => setPlatform('android'));

  it('passes the URL, package and chooser title to native', async () => {
    const fake = installFake();
    await pay(params, { chooserTitle: 'Pay with' });
    await pay(params, { packageName: 'com.phonepe.app', iosApp: 'gpay' });
    expect(fake.pay.mock.calls).toEqual([
      [URL, null, 'Pay with'],
      [URL, 'com.phonepe.app', null],
    ]);
  });

  it('resolves completed with the parsed response', async () => {
    installFake();
    await expect(pay(params)).resolves.toEqual({
      kind: 'completed',
      resultCode: -1,
      response: { status: 'success', transactionId: 'T1', raw: 'Status=SUCCESS&txnId=T1' },
    });
  });

  it('treats a response sent with RESULT_CANCELED as completed', async () => {
    installFake({
      pay: jest.fn(async () => ({ outcome: 'result', resultCode: 0, response: 'Status=FAILURE&txnRef=ORDER42' })),
    });
    await expect(pay(params)).resolves.toMatchObject({
      kind: 'completed',
      resultCode: 0,
      response: { status: 'failure', transactionRef: 'ORDER42' },
    });
  });

  it.each([
    { outcome: 'result', resultCode: 0, response: null },
    { outcome: 'result', resultCode: 0, response: '' },
    { outcome: 'result', resultCode: 0 },
  ])('resolves cancelled for RESULT_CANCELED without data (%j)', async (nativeResult) => {
    installFake({ pay: jest.fn(async () => nativeResult) });
    await expect(pay(params)).resolves.toEqual({ kind: 'cancelled', resultCode: 0 });
  });

  // Finding 1 (0.1.1): some apps return RESULT_OK and no data after a
  // successful payment. Reporting that as `cancelled` invites a second payment.
  it.each([
    [{ outcome: 'result', resultCode: -1, response: null }, -1],
    [{ outcome: 'result', resultCode: -1, response: '' }, -1],
    [{ outcome: 'result', resultCode: -1, response: '   ' }, -1],
    [{ outcome: 'result', resultCode: -1 }, -1],
    [{ outcome: 'result', resultCode: 1, response: null }, 1],
  ])('resolves completed with status unknown for any other result code without data (%j)', async (nativeResult, resultCode) => {
    installFake({ pay: jest.fn(async () => nativeResult) });
    await expect(pay(params)).resolves.toEqual({
      kind: 'completed',
      resultCode,
      response: { status: 'unknown', raw: '' },
    });
  });

  // Finding 3 (0.1.1): native settles a request that never got a result
  // with `resultCode: null`. Nothing says the user backed out.
  it.each([
    { outcome: 'result', resultCode: null, response: null },
    { outcome: 'result', response: null },
  ])('resolves completed with status unknown when no result code came back (%j)', async (nativeResult) => {
    installFake({ pay: jest.fn(async () => nativeResult) });
    await expect(pay(params)).resolves.toEqual({
      kind: 'completed',
      resultCode: null,
      response: { status: 'unknown', raw: '' },
    });
  });

  // Finding 10 (0.1.1): the text "null" is not a response.
  it.each(['null', 'NULL', 'undefined', ' null ', ' \n\t '])('treats the response %j as no data', async (response) => {
    installFake({ pay: jest.fn(async () => ({ outcome: 'result', resultCode: 0, response })) });
    await expect(pay(params)).resolves.toEqual({ kind: 'cancelled', resultCode: 0 });
    installFake({ pay: jest.fn(async () => ({ outcome: 'result', resultCode: -1, response })) });
    await expect(pay(params)).resolves.toEqual({
      kind: 'completed',
      resultCode: -1,
      response: { status: 'unknown', raw: '' },
    });
  });

  it('resolves a pending status as completed with status submitted', async () => {
    installFake({
      pay: jest.fn(async () => ({ outcome: 'result', resultCode: -1, response: 'Status=SUBMITTED&txnId=P1' })),
    });
    await expect(pay(params)).resolves.toMatchObject({ kind: 'completed', response: { status: 'submitted' } });
  });

  it('resolves unavailable when no app can handle the payment', async () => {
    installFake({ pay: jest.fn(async () => ({ outcome: 'unavailable' })) });
    await expect(pay(params)).resolves.toEqual({ kind: 'unavailable' });
  });

  it('allows only one payment in flight', async () => {
    const pending = deferred<object>();
    const fake = installFake({ pay: jest.fn(() => pending.promise) });

    const first = pay(params);
    await expect(pay(params)).rejects.toMatchObject({ code: 'IN_PROGRESS' });
    expect(fake.pay).toHaveBeenCalledTimes(1);

    pending.resolve({ outcome: 'result', resultCode: 0, response: null });
    await expect(first).resolves.toEqual({ kind: 'cancelled', resultCode: 0 });

    fake.pay.mockImplementation(async () => ({ outcome: 'unavailable' }));
    await expect(pay(params)).resolves.toEqual({ kind: 'unavailable' });
  });

  it('releases the in-flight guard after a rejection', async () => {
    const fake = installFake({
      pay: jest.fn(async () => {
        throw Object.assign(new Error('No activity'), { code: 'ACTIVITY_UNAVAILABLE' });
      }),
    });
    await expect(pay(params)).rejects.toMatchObject({ code: 'ACTIVITY_UNAVAILABLE', message: 'No activity' });
    fake.pay.mockImplementation(async () => ({ outcome: 'unavailable' }));
    await expect(pay(params)).resolves.toEqual({ kind: 'unavailable' });
  });

  it.each([
    ['NO_UPI_APP', 'NO_UPI_APP'],
    ['IN_PROGRESS', 'IN_PROGRESS'],
    ['ACTIVITY_UNAVAILABLE', 'ACTIVITY_UNAVAILABLE'],
    ['UNKNOWN', 'UNKNOWN'],
    ['E_SOMETHING_ELSE', 'UNKNOWN'],
    [undefined, 'UNKNOWN'],
  ])('maps native code %j to %s', async (nativeCode, code) => {
    installFake({
      pay: jest.fn(async () => {
        throw Object.assign(new Error('native failure'), { code: nativeCode });
      }),
    });
    const error = await pay(params).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UpiError);
    expect(error).toMatchObject({ code, message: 'native failure' });
  });

  it('rejects an unexpected native result with UNKNOWN', async () => {
    installFake({ pay: jest.fn(async () => ({ outcome: 'surprise' })) });
    await expect(pay(params)).rejects.toMatchObject({ code: 'UNKNOWN' });
  });

  it('rejects invalid params before calling native', async () => {
    const fake = installFake();
    const error = await pay({ ...params, amount: '-1' }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'INVALID_PARAMS' });
    expect((error as UpiError).problems).toEqual([expect.objectContaining({ field: 'amount', code: 'INVALID_AMOUNT' })]);
    await expect(pay(params, { packageName: '  ' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(fake.pay).not.toHaveBeenCalled();
  });

  it('lists installed apps and falls back to the package name for the label', async () => {
    const fake = installFake({
      getInstalledApps: jest.fn(async () => [
        { packageName: 'com.phonepe.app', name: 'PhonePe' },
        { packageName: 'in.org.npci.upiapp', name: '' },
        { name: 'no package' },
        null,
      ]),
    });
    await expect(getInstalledUpiApps()).resolves.toEqual([
      { name: 'PhonePe', packageName: 'com.phonepe.app' },
      { name: 'in.org.npci.upiapp', packageName: 'in.org.npci.upiapp' },
    ]);
    await expect(isUpiAvailable()).resolves.toBe(true);
    expect(fake.getInstalledApps).toHaveBeenCalledWith([]);
  });

  it('reports no UPI app', async () => {
    installFake();
    await expect(isUpiAvailable()).resolves.toBe(false);
  });
});

describe('on iOS', () => {
  beforeEach(() => setPlatform('ios'));

  it('opens the generic URL and resolves launched', async () => {
    const fake = installFake({ pay: jest.fn(async () => ({ outcome: 'launched' })) });
    await expect(pay(params, { packageName: 'com.phonepe.app', chooserTitle: 'x' })).resolves.toEqual({
      kind: 'launched',
    });
    expect(fake.pay).toHaveBeenCalledWith(URL, null, 'x');
  });

  it('opens the per-app URL for iosApp', async () => {
    const fake = installFake({ pay: jest.fn(async () => ({ outcome: 'launched' })) });
    await pay(params, { iosApp: 'phonepe' });
    expect(fake.pay.mock.calls[0][0]).toBe(URL.replace('upi://pay?', 'phonepe://pay?'));
  });

  it('rejects an unknown iosApp', async () => {
    const fake = installFake();
    await expect(pay(params, { iosApp: 'nope' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(fake.pay).not.toHaveBeenCalled();
  });

  it('resolves unavailable when the app cannot be opened', async () => {
    installFake({ pay: jest.fn(async () => ({ outcome: 'unavailable' })) });
    await expect(pay(params, { iosApp: 'gpay' })).resolves.toEqual({ kind: 'unavailable' });
  });

  it('checks the known schemes and maps them back to the table', async () => {
    const fake = installFake({
      getInstalledApps: jest.fn(async () => [{ id: 'phonepe', name: 'ignored' }, { id: 'unknown-app' }, { id: 7 }]),
    });
    await expect(getInstalledUpiApps()).resolves.toEqual([{ name: 'PhonePe', iosApp: 'phonepe' }]);
    const candidates = fake.getInstalledApps.mock.calls[0][0] as Array<{ id: string; url: string }>;
    expect(candidates).toContainEqual({ id: 'gpay', name: 'Google Pay', url: 'tez://' });
    expect(candidates.some((candidate) => candidate.id === 'upi')).toBe(false);
  });

  it('includes the generic upi scheme in isUpiAvailable', async () => {
    const fake = installFake({ getInstalledApps: jest.fn(async () => [{ id: 'upi', name: 'UPI' }]) });
    await expect(isUpiAvailable()).resolves.toBe(true);
    const candidates = fake.getInstalledApps.mock.calls[0][0] as Array<{ id: string; url: string }>;
    expect(candidates[candidates.length - 1]).toEqual({ id: 'upi', name: 'UPI', url: 'upi://pay' });
  });
});

// Finding 4 (0.1.1): a screen that was unmounted while the UPI app was open
// (for example after "Don't keep activities") can read the result back.
describe('getLastResult', () => {
  beforeEach(() => setPlatform('android'));

  it('is null before any payment settles', async () => {
    installFake();
    await expect(getLastResult()).resolves.toBeNull();
  });

  it('returns the most recent result with its transactionRef and time', async () => {
    installFake();
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    await pay(params);
    await expect(getLastResult()).resolves.toEqual({
      result: {
        kind: 'completed',
        resultCode: -1,
        response: { status: 'success', transactionId: 'T1', raw: 'Status=SUCCESS&txnId=T1' },
      },
      transactionRef: 'ORDER42',
      time: 1_700_000_000_000,
    });

    installFake({ pay: jest.fn(async () => ({ outcome: 'unavailable' })) });
    await pay({ ...params, transactionRef: 'ORDER43' });
    await expect(getLastResult()).resolves.toMatchObject({ result: { kind: 'unavailable' }, transactionRef: 'ORDER43' });
  });

  it('does not record rejections', async () => {
    installFake({
      pay: jest.fn(async () => {
        throw Object.assign(new Error('No activity'), { code: 'ACTIVITY_UNAVAILABLE' });
      }),
    });
    await expect(pay(params)).rejects.toMatchObject({ code: 'ACTIVITY_UNAVAILABLE' });
    await expect(getLastResult()).resolves.toBeNull();
  });

  it('prefers a newer native record, for example one that arrived after a JavaScript reload', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    installFake({
      getLastResult: jest.fn(async () => ({
        outcome: 'result',
        resultCode: -1,
        response: 'Status=SUCCESS&txnRef=ORDER9',
        transactionRef: 'ORDER9',
        time: 5000,
      })),
    });
    await pay(params);
    await expect(getLastResult()).resolves.toEqual({
      result: {
        kind: 'completed',
        resultCode: -1,
        response: { status: 'success', transactionRef: 'ORDER9', raw: 'Status=SUCCESS&txnRef=ORDER9' },
      },
      transactionRef: 'ORDER9',
      time: 5000,
    });
  });

  it('keeps the JavaScript record when the native one is older, missing or malformed', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(9000);
    const fake = installFake({
      getLastResult: jest.fn(async () => ({ outcome: 'result', resultCode: 0, transactionRef: 'OLD', time: 10 })),
    });
    await pay(params);
    await expect(getLastResult()).resolves.toMatchObject({ transactionRef: 'ORDER42', time: 9000 });

    fake.getLastResult!.mockImplementation(async () => ({ outcome: 'surprise', time: 99999 }));
    await expect(getLastResult()).resolves.toMatchObject({ transactionRef: 'ORDER42' });

    fake.getLastResult!.mockImplementation(async () => {
      throw new Error('boom');
    });
    await expect(getLastResult()).resolves.toMatchObject({ transactionRef: 'ORDER42' });

    delete fake.getLastResult;
    await expect(getLastResult()).resolves.toMatchObject({ transactionRef: 'ORDER42' });
  });

  it('maps a native record without transactionRef to null', async () => {
    installFake({ getLastResult: jest.fn(async () => ({ outcome: 'result', resultCode: 0, response: null, time: 3 })) });
    await expect(getLastResult()).resolves.toEqual({
      result: { kind: 'cancelled', resultCode: 0 },
      transactionRef: null,
      time: 3,
    });
  });

  it('resolves null without the native module', async () => {
    await expect(getLastResult()).resolves.toBeNull();
  });
});
