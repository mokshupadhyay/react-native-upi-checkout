import { useCallback, useEffect, useRef, useState } from 'react';
import { pay as startPayment } from './api';
import { UpiError, toUpiError } from './errors';
import type { UpiPayOptions, UpiPayResult, UpiPaymentParams } from './types';

/**
 * - `idle`: nothing started yet, or after `reset()`.
 * - `launching`: the UPI app is open or opening; waiting for `pay()` to settle.
 * - `completed`: `pay()` resolved with `completed` (Android) or `launched` (iOS).
 *   Check `result.kind`, and confirm the payment on your server either way.
 * - `cancelled`: the user backed out without a response.
 * - `error`: `pay()` rejected, or no UPI app was available (`error.code` is
 *   `NO_UPI_APP` and `result.kind` is `unavailable`).
 */
export type UpiPaymentStatus = 'idle' | 'launching' | 'completed' | 'cancelled' | 'error';

export interface UseUpiPaymentResult {
  /**
   * Start a payment. Never rejects: resolves to the result, or to `null` when
   * the payment failed with an error (read it from `error`).
   */
  pay(params: UpiPaymentParams, options?: UpiPayOptions): Promise<UpiPayResult | null>;
  status: UpiPaymentStatus;
  /** The last result, or `null`. */
  result: UpiPayResult | null;
  /** The last error, or `null`. */
  error: UpiError | null;
  /** Back to `idle`, clearing `result` and `error`. */
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

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const pay = useCallback(async (params: UpiPaymentParams, options?: UpiPayOptions) => {
    setState({ status: 'launching', result: null, error: null });
    try {
      const result = await startPayment(params, options);
      if (mounted.current) setState(stateFor(result));
      return result;
    } catch (error) {
      if (mounted.current) setState({ status: 'error', result: null, error: toUpiError(error) });
      return null;
    }
  }, []);

  const reset = useCallback(() => setState(IDLE), []);

  return { pay, status: state.status, result: state.result, error: state.error, reset };
}
