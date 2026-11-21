import { parseUpiResponse } from '../index';
import type { UpiResponse } from '../index';

type Expected = Omit<UpiResponse, 'raw'>;

const cases: Array<[string, string, Expected]> = [
  [
    'typical success with mixed-case keys',
    'txnId=AXI0a1b2c3&responseCode=00&Status=SUCCESS&txnRef=ORDER42',
    { status: 'success', transactionId: 'AXI0a1b2c3', responseCode: '00', transactionRef: 'ORDER42' },
  ],
  [
    'all lower-case keys and value',
    'status=success&txnid=T1&txnref=R1&responsecode=0&approvalrefno=123456',
    { status: 'success', transactionId: 'T1', transactionRef: 'R1', responseCode: '0', approvalRef: '123456' },
  ],
  [
    'ApprovalRefNo spelling',
    'Status=SUCCESS&ApprovalRefNo=812345678901&txnId=ICI1&txnRef=R2&responseCode=00',
    { status: 'success', approvalRef: '812345678901', transactionId: 'ICI1', transactionRef: 'R2', responseCode: '00' },
  ],
  [
    'title-case Success',
    'Status=Success&txnId=1',
    { status: 'success', transactionId: '1' },
  ],
  [
    'FAILURE with a bank response code',
    'txnId=YBL123&responseCode=ZM&Status=FAILURE&txnRef=ORDER43',
    { status: 'failure', transactionId: 'YBL123', responseCode: 'ZM', transactionRef: 'ORDER43' },
  ],
  ['Failed', 'Status=Failed&txnRef=R', { status: 'failure', transactionRef: 'R' }],
  ['FAIL', 'status=FAIL', { status: 'failure' }],
  ['SUBMITTED', 'Status=SUBMITTED&txnId=P1&txnRef=R', { status: 'submitted', transactionId: 'P1', transactionRef: 'R' }],
  ['PENDING maps to submitted', 'status=PENDING&txnId=P2', { status: 'submitted', transactionId: 'P2' }],
  [
    'keys in a different order with approval ref first',
    'ApprovalRefNo=null&Status=SUCCESS&responseCode=00&txnRef=R3&txnId=T3',
    { status: 'success', responseCode: '00', transactionRef: 'R3', transactionId: 'T3' },
  ],
  [
    'trtxnRef key used by some apps',
    'txnId=T4&trtxnRef=R4&Status=SUCCESS',
    { status: 'success', transactionId: 'T4', transactionRef: 'R4' },
  ],
  ['leading question mark', '?Status=SUCCESS&txnId=T5', { status: 'success', transactionId: 'T5' }],
  [
    'surrounding whitespace and spaces in values',
    '  Status= SUCCESS &txnId= T6  \n',
    { status: 'success', transactionId: 'T6' },
  ],
  [
    'percent-encoded values',
    'Status=SUCCESS&txnRef=ORDER%2042&txnId=A%2FB',
    { status: 'success', transactionRef: 'ORDER 42', transactionId: 'A/B' },
  ],
  [
    'malformed percent escapes stay as sent',
    'Status=SUCCESS&txnId=50%ZZ',
    { status: 'success', transactionId: '50%ZZ' },
  ],
  [
    'first non-empty value wins for repeated keys',
    'Status=&status=FAILURE&Status=SUCCESS',
    { status: 'failure' },
  ],
  [
    'literal null and undefined values are dropped',
    'Status=SUCCESS&txnId=null&txnRef=undefined&responseCode=NULL',
    { status: 'success' },
  ],
  ['unknown status value', 'Status=DONE&txnId=T7', { status: 'unknown', transactionId: 'T7' }],
  ['no status key', 'txnId=T8&responseCode=00', { status: 'unknown', transactionId: 'T8', responseCode: '00' }],
  ['empty string', '', { status: 'unknown' }],
  ['only separators', '&&&==&', { status: 'unknown' }],
  ['plain text', 'Payment cancelled by user', { status: 'unknown' }],
  ['JSON instead of a query string', '{"Status":"SUCCESS"}', { status: 'unknown' }],
  ['key without value', 'Status', { status: 'unknown' }],
  ['value with an equals sign', 'Status=SUCCESS&txnId=a=b', { status: 'success', transactionId: 'a=b' }],
  ['prototype keys are ignored', 'constructor=x&__proto__=y&Status=constructor', { status: 'unknown' }],
  ['unrelated keys are ignored', 'bleTxId=1&Status=SUCCESS&foo=bar', { status: 'success' }],
];

describe('parseUpiResponse', () => {
  it.each(cases)('%s', (_name, raw, expected) => {
    expect(parseUpiResponse(raw)).toEqual({ ...expected, raw });
  });

  it('never throws on non-string input', () => {
    for (const input of [undefined, null, 42, {}, []]) {
      expect(parseUpiResponse(input as unknown as string)).toEqual({ status: 'unknown', raw: '' });
    }
  });
});
