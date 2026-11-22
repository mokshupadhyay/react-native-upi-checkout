import { useCallback, useEffect, useRef, useState } from 'react';
import { isPaymentInFlight, pay as startPayment } from './api';
import { UpiError, toUpiError } from './errors';
import type { UpiPayOptions, UpiPayResult, UpiPaymentParams } from './types';

/**
 * - `idle`: nothing started yet, or after `reset()`.
 * - `launching`: the UPI app is open or opening; waiting for `pay()` to settle.
 * - `completed`: `pay()` resolved with `completed` (Android) or `launched` (iOS).
 *   Check `result.kind`, and confirm the payment on your server either way.
 * - `cancelled`: Android reported `RESULT_CANCELED` without a response.
 * - `error`: `pay()` rejected, or no UPI app was available (`error.code` is
 *   `NO_UPI_APP` and `result.kind` is `unavailable`).
 */
export type UpiPaymentStatus = 'idle' | 'launching' | 'completed' | 'cancelled' | 'error';

export interface UseUpiPaymentResult {
  /**
   * Start a payment. Never rejects: resolves to the result, or to `null` when
   * the payment failed with an error (read it from `error`).
   *
   * While a payment is in flight (from this hook or anywhere else in the
   * app), another call resolves to `null` at once and leaves `status`,
   * `result` and `error` as they are. A double tap therefore cannot flip the
   * state to `error` while the UPI app is still open.
   */
  pay(params: UpiPaymentParams, options?: UpiPayOptions): Promise<UpiPayResult | null>;
  status: UpiPaymentStatus;
  /** The last result, or `null`. */
  result: UpiPayResult | null;
  /** The last error, or `null`. */
  error: UpiError | null;
  /**
   * Back to `idle`, clearing `result` and `error`. A payment still in flight
   * keeps running, but its result no longer changes this hook's state. It is
   * still available from `getLastResult()`, and the native request still
   * blocks a new `pay()` until it settles.
   */
  reset(): void;
}

interface State {
  status: UpiPaymentStatus;
  result: UpiPayResult | null;
  error: UpiError | null;
}

const IDLE: State = { status: 'idle', result: null, error: null };

function stateFor(result: UpiPayResult): State {
  switch (result.kind) {
    case 'completed':
    case 'launched':
      return { status: 'completed', result, error: null };
    case 'cancelled':
      return { status: 'cancelled', result, error: null };
    case 'unavailable':
      return {
        status: 'error',
        result,
        error: new UpiError('NO_UPI_APP', 'No installed app can handle this UPI payment.'),
      };
  }
}

/** A UPI payment with its progress as React state. */
export function useUpiPayment(): UseUpiPaymentResult {
  const [state, setState] = useState<State>(IDLE);
  const mounted = useRef(true);
  // Bumped by every pay() and reset(); a settling call only updates the
  // state while it is still the latest one.
  const latestCall = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const pay = useCallback(async (params: UpiPaymentParams, options?: UpiPayOptions) => {
    if (isPaymentInFlight()) return null;
    const call = ++latestCall.current;
    const current = () => mounted.current && latestCall.current === call;
    setState({ status: 'launching', result: null, error: null });
    try {
      const result = await startPayment(params, options);
      if (current()) setState(stateFor(result));
      return result;
    } catch (error) {
      if (current()) setState({ status: 'error', result: null, error: toUpiError(error) });
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    latestCall.current += 1;
    setState(IDLE);
  }, []);

  return { pay, status: state.status, result: state.result, error: state.error, reset };
}
