import type { UpiErrorCode, UpiProblem } from './types';

/** Every rejection from this library is a `UpiError` with a stable `code`. */
export class UpiError extends Error {
  readonly code: UpiErrorCode;
  /** Validation problems; only set for `INVALID_PARAMS`. */
  readonly problems: UpiProblem[];

  constructor(code: UpiErrorCode, message: string, problems: UpiProblem[] = []) {
    super(message);
    // Keeps `instanceof UpiError` working when Babel transpiles the class.
    Object.setPrototypeOf(this, UpiError.prototype);
    this.name = 'UpiError';
    this.code = code;
    this.problems = problems;
  }
}

const NATIVE_CODES: UpiErrorCode[] = [
  'INVALID_PARAMS',
  'NO_UPI_APP',
  'IN_PROGRESS',
  'ACTIVITY_UNAVAILABLE',
  'NOT_LINKED',
  'UNKNOWN',
];

/** Turn a native rejection (or anything thrown) into a `UpiError`. */
export function toUpiError(error: unknown): UpiError {
  if (error instanceof UpiError) return error;
  const source = (error != null && typeof error === 'object' ? error : {}) as {
    code?: unknown;
    message?: unknown;
  };
  const code =
    typeof source.code === 'string' && NATIVE_CODES.indexOf(source.code as UpiErrorCode) !== -1
      ? (source.code as UpiErrorCode)
      : 'UNKNOWN';
  const message =
    typeof source.message === 'string' && source.message.length > 0
      ? source.message
      : typeof error === 'string' && error.length > 0
        ? error
        : 'The UPI payment failed for an unknown reason.';
  return new UpiError(code, message);
}
