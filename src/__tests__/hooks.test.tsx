import * as React from 'react';
import { NativeModules, Platform, Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { useUpiPayment } from '../hooks';
import { resetNativeModuleCache } from '../native';
import type { UseUpiPaymentResult } from '../hooks';
import type { UpiPaymentParams } from '../types';

const params: UpiPaymentParams = {
  payeeVpa: 'shop@okbank',
  payeeName: 'Corner Shop',
  amount: '10',
  transactionRef: 'ORDER42',
  note: 'Order 42',
};

let settle: ((value: unknown) => void) | null = null;
let fail: ((error: unknown) => void) | null = null;
const originalOS = Platform.OS;

beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  (NativeModules as { UpiCheckout?: unknown }).UpiCheckout = {
    getInstalledApps: jest.fn(async () => []),
    pay: jest.fn(
      () =>
        new Promise((resolve, reject) => {
          settle = resolve;
          fail = reject;
        }),
    ),
  };
  resetNativeModuleCache();
});

afterEach(() => {
  delete (NativeModules as { UpiCheckout?: unknown }).UpiCheckout;
  resetNativeModuleCache();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
  settle = null;
  fail = null;
});

let api: UseUpiPaymentResult | undefined;

function Probe() {
  api = useUpiPayment();
  const detail = api.error ? api.error.code : api.result ? api.result.kind : '-';
  return <Text>{`${api.status}:${detail}`}</Text>;
}

// Wrapped in an object: an async function would flatten a returned promise.
async function start(): Promise<{ promise: Promise<unknown> }> {
  let promise: Promise<unknown> = Promise.resolve();
  await act(async () => {
    promise = api!.pay(params);
  });
  return { promise };
}

it('moves from idle to launching to completed', async () => {
  await render(<Probe />);
  expect(screen.getByText('idle:-')).toBeTruthy();

  const { promise } = await start();
  expect(screen.getByText('launching:-')).toBeTruthy();

  await act(async () => {
    settle!({ outcome: 'result', resultCode: -1, response: 'Status=SUCCESS&txnId=T1' });
    await promise;
  });
  expect(screen.getByText('completed:completed')).toBeTruthy();
  await expect(promise).resolves.toMatchObject({ kind: 'completed', response: { status: 'success' } });
  expect(api!.result).toMatchObject({ kind: 'completed' });

  await act(async () => api!.reset());
  expect(screen.getByText('idle:-')).toBeTruthy();
});

it('reports cancelled', async () => {
  await render(<Probe />);
  const { promise } = await start();
  await act(async () => {
    settle!({ outcome: 'result', resultCode: 0, response: null });
    await promise;
  });
  expect(screen.getByText('cancelled:cancelled')).toBeTruthy();
});

it('reports unavailable as an error with NO_UPI_APP', async () => {
  await render(<Probe />);
  const { promise } = await start();
  await act(async () => {
    settle!({ outcome: 'unavailable' });
    await promise;
  });
  expect(screen.getByText('error:NO_UPI_APP')).toBeTruthy();
  expect(api!.result).toEqual({ kind: 'unavailable' });
});

it('records errors without rejecting', async () => {
  await render(<Probe />);
  const { promise } = await start();
  await act(async () => {
    fail!(Object.assign(new Error('no activity'), { code: 'ACTIVITY_UNAVAILABLE' }));
    await promise;
  });
  await expect(promise).resolves.toBeNull();
  expect(screen.getByText('error:ACTIVITY_UNAVAILABLE')).toBeTruthy();
});

it('records validation errors', async () => {
  await render(<Probe />);
  let result: unknown;
  await act(async () => {
    result = await api!.pay({ ...params, payeeVpa: 'bad' });
  });
  expect(result).toBeNull();
  expect(screen.getByText('error:INVALID_PARAMS')).toBeTruthy();
  expect(api!.error!.problems[0]).toMatchObject({ field: 'payeeVpa', code: 'INVALID_VPA' });
});
