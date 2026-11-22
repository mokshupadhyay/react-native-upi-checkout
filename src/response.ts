import type { UpiResponse, UpiResponseStatus } from './types';

type ResponseField = 'status' | 'transactionId' | 'transactionRef' | 'responseCode' | 'approvalRef';

// Keys are compared after lower-casing and dropping everything but letters
// and digits, so `ApprovalRefNo`, `approvalRefNo` and `approval_ref_no` match.
export const KEY_ALIASES: { [normalizedKey: string]: ResponseField } = {
  status: 'status',
  txnstatus: 'status',
  txnid: 'transactionId',
  transactionid: 'transactionId',
  txnref: 'transactionRef',
  trtxnref: 'transactionRef',
  transactionref: 'transactionRef',
  tr: 'transactionRef',
  responsecode: 'responseCode',
  approvalrefno: 'approvalRef',
  approvalref: 'approvalRef',
};

const STATUS_VALUES: { [normalizedValue: string]: UpiResponseStatus } = {
  success: 'success',
  successful: 'success',
  failure: 'failure',
  failed: 'failure',
  fail: 'failure',
  submitted: 'submitted',
  pending: 'submitted',
};

function lookup<T>(table: { [key: string]: T }, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Responses are form-encoded (`application/x-www-form-urlencoded`): `+` is a
// space and `%2B` is a plus sign. Android's own encoders produce this, and
// so does the native side of this library when it joins separate extras
// (it writes spaces as `%20`, which decodes the same way).
function decode(value: string): string {
  const spaced = value.replace(/\+/g, ' ');
  if (spaced.indexOf('%') === -1) return spaced;
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

// Some apps send the literal text "null" or "undefined" for a missing value.
function isEmptyValue(value: string): boolean {
  if (value.length === 0) return true;
  const lower = value.toLowerCase();
  return lower === 'null' || lower === 'undefined';
}

/**
 * Parse the response string an Android UPI app returns, for example
 * `txnId=AXI123&responseCode=00&Status=SUCCESS&txnRef=ORDER42`.
 *
 * Keys are matched without regard to case or order. The first non-empty value
 * of a key wins. Keys and values are form-decoded: `+` becomes a space and
 * `%2B` a plus sign. `SUCCESS`, `FAILURE`/`FAILED` and `SUBMITTED`/`PENDING` are
 * recognized in any case; anything else, and any malformed input, gives
 * `status: 'unknown'`. Never throws.
 *
 * The result is a CLIENT-SIDE CLAIM made by an app on the user's device.
 * Never treat it as proof of payment: confirm the payment on your server, for
 * example with your PSP's status API or a webhook.
 */
export function parseUpiResponse(raw: string): UpiResponse {
  const text = typeof raw === 'string' ? raw : '';
  const fields: { [field in ResponseField]?: string } = {};

  let body = text.trim();
  if (body.charAt(0) === '?') body = body.slice(1);

  for (const part of body.split('&')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const field = lookup(KEY_ALIASES, normalizeKey(decode(part.slice(0, separator))));
    if (field === undefined || fields[field] !== undefined) continue;
    const value = decode(part.slice(separator + 1)).trim();
    if (!isEmptyValue(value)) fields[field] = value;
  }

  const status = fields.status !== undefined ? lookup(STATUS_VALUES, fields.status.toLowerCase()) : undefined;
  const response: UpiResponse = { status: status || 'unknown', raw: text };
  if (fields.transactionId !== undefined) response.transactionId = fields.transactionId;
  if (fields.transactionRef !== undefined) response.transactionRef = fields.transactionRef;
  if (fields.responseCode !== undefined) response.responseCode = fields.responseCode;
  if (fields.approvalRef !== undefined) response.approvalRef = fields.approvalRef;
  return response;
}
