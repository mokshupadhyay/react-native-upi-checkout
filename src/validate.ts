import type {
  UpiLimits,
  UpiParamField,
  UpiPaymentParams,
  UpiProblem,
  UpiValidationOptions,
} from './types';

/**
 * Conservative defaults, not limits quoted from the NPCI specification. They
 * keep requests short enough for common UPI apps. Check the current NPCI UPI
 * Linking Specifications and your PSP's documentation, and override them with
 * `options.limits` when your values are known to be accepted.
 */
export const DEFAULT_UPI_LIMITS: Readonly<UpiLimits> = Object.freeze({
  payeeVpa: 255,
  payeeName: 50,
  transactionRef: 35,
  note: 50,
  transactionId: 35,
  url: 255,
});

// Integer part capped at 13 digits so the amount in paise stays a safe
// integer. This is an arithmetic limit of this library, not a UPI rule.
const AMOUNT_PATTERN = /^(\d{1,13})(?:\.(\d{1,2}))?$/;

// Shape check only: `handle@provider`. The handle starts with a letter or
// digit and then has letters, digits, `.`, `_` and `-`, with no two dots in a
// row. The provider (the part after `@`, such as `okaxis` or `ybl`) is
// letters and digits only. This accepts every common real shape (phone
// numbers, `name.surname`, `gpay-1234567890`, `paytmqr...`) and rejects
// strings such as `-@-`, `.@b`, `a@b..` and `a..b@okaxis`. It cannot tell
// whether the address exists.
const VPA_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]|\.(?!\.))*@[A-Za-z0-9]+$/;

// C0 controls, DEL and C1 controls. These include tab, CR and LF.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

// An absolute http(s) URL with a non-empty host and no whitespace. Other
// schemes (`javascript:`, `intent:`, `upi:`, `data:`) are rejected.
const URL_PATTERN = /^https?:\/\/[^\s/?#@]+(?:[/?#]\S*)?$/i;

const MERCHANT_CODE_PATTERN = /^\d{4}$/;

export type AmountResult = { ok: true; paise: number; formatted: string } | { ok: false; message: string };

/**
 * Parse an amount in rupees with integer arithmetic only. `'10'`, `10`,
 * `'10.5'` and `'010.50'` all become `{ paise: 1050, formatted: '10.50' }`
 * (for `10`, `{ paise: 1000, formatted: '10.00' }`).
 */
export function parseAmount(value: unknown): AmountResult {
  let text: string;
  if (typeof value === 'number') {
    if (!isFinite(value)) return { ok: false, message: 'amount must be a finite number.' };
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return { ok: false, message: 'amount must be a decimal string or a number.' };
  }
  if (text.length === 0) return { ok: false, message: 'amount is required.' };
  if (text.charAt(0) === '-') return { ok: false, message: 'amount must be greater than zero.' };

  const match = AMOUNT_PATTERN.exec(text);
  if (!match) {
    return {
      ok: false,
      message: `amount "${text}" must be a plain decimal with at most two decimals, for example "149.50".`,
    };
  }
  const rupees = parseInt(match[1], 10);
  const fraction = match[2] === undefined ? 0 : parseInt((match[2] + '0').slice(0, 2), 10);
  const paise = rupees * 100 + fraction;
  if (paise <= 0) return { ok: false, message: 'amount must be greater than zero.' };
  const cents = paise % 100;
  const formatted = `${Math.floor(paise / 100)}.${cents < 10 ? '0' : ''}${cents}`;
  return { ok: true, paise, formatted };
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isEncodable(value: string): boolean {
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check payment parameters and return every problem found. Never throws; an
 * empty list means `buildUpiUrl` will accept the parameters.
 *
 * Checks: required fields, value types, `payeeVpa` shape (`handle@provider`),
 * `amount` (positive, at most two decimals), `currency` (`'INR'` only),
 * `merchantCode` (four digits), `url` (`https:` or `http:` only), no control
 * characters and no leading or trailing whitespace in any text field, and
 * the length limits in `DEFAULT_UPI_LIMITS`, which are conservative defaults
 * you can override. `undefined`, `null` and `''` all mean "absent"; a blank
 * optional value is left out of the URL.
 */
export function validateUpiParams(params: UpiPaymentParams, options: UpiValidationOptions = {}): UpiProblem[] {
  const problems: UpiProblem[] = [];
  const input = (params != null && typeof params === 'object' ? params : {}) as {
    [key: string]: unknown;
  };
  const limits: UpiLimits = { ...DEFAULT_UPI_LIMITS, ...(options.limits || {}) };

  const add = (code: UpiProblem['code'], field: UpiParamField, message: string) => {
    problems.push({ code, field, message });
  };

  // Returns the string value when the field passes its basic checks.
  const text = (field: UpiParamField, required: boolean, limit?: number): string | null => {
    const value = input[field];
    if (value === undefined || value === null || value === '') {
      if (required) add('REQUIRED', field, `${field} is required.`);
      return null;
    }
    if (typeof value !== 'string') {
      add('INVALID_TYPE', field, `${field} must be a string.`);
      return null;
    }
    if (value.trim().length === 0) {
      // Blank optional values are left out of the URL, like empty ones.
      if (required) add('REQUIRED', field, `${field} must not be blank.`);
      return null;
    }
    if (CONTROL_CHARACTERS.test(value)) {
      add('INVALID_CHARACTERS', field, `${field} must not contain control characters such as tabs or line breaks.`);
      return null;
    }
    if (value.trim() !== value) {
      add('SURROUNDING_WHITESPACE', field, `${field} must not start or end with whitespace.`);
      return null;
    }
    if (!isEncodable(value)) {
      add('INVALID_CHARACTERS', field, `${field} contains characters that cannot be URL-encoded.`);
      return null;
    }
    if (limit !== undefined && codePointLength(value) > limit) {
      add('TOO_LONG', field, `${field} is longer than ${limit} characters.`);
      return null;
    }
    return value;
  };

  const vpa = text('payeeVpa', true, limits.payeeVpa);
  if (vpa !== null && !VPA_PATTERN.test(vpa)) {
    add('INVALID_VPA', 'payeeVpa', `payeeVpa "${vpa}" does not look like a UPI address such as "name@bank".`);
  }
  text('payeeName', true, limits.payeeName);

  const amount = input.amount;
  if (amount === undefined || amount === null || amount === '') {
    add('REQUIRED', 'amount', 'amount is required.');
  } else if (typeof amount !== 'string' && typeof amount !== 'number') {
    add('INVALID_TYPE', 'amount', 'amount must be a decimal string or a number.');
  } else {
    const parsed = parseAmount(amount);
    if (!parsed.ok) add('INVALID_AMOUNT', 'amount', parsed.message);
  }

  const currency = input.currency;
  if (currency !== undefined && currency !== null && currency !== 'INR') {
    add('INVALID_CURRENCY', 'currency', 'currency must be "INR".');
  }

  text('transactionRef', true, limits.transactionRef);
  text('note', true, limits.note);

  const merchantCode = text('merchantCode', false);
  if (merchantCode !== null && !MERCHANT_CODE_PATTERN.test(merchantCode)) {
    add('INVALID_MERCHANT_CODE', 'merchantCode', 'merchantCode must be a four-digit merchant category code.');
  }
  text('transactionId', false, limits.transactionId);
  const url = text('url', false, limits.url);
  if (url !== null && !URL_PATTERN.test(url)) {
    add('INVALID_URL', 'url', 'url must be an absolute https: or http: URL.');
  }

  return problems;
}
