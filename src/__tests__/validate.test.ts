import { DEFAULT_UPI_LIMITS, validateUpiParams } from '../index';
import type { UpiPaymentParams, UpiProblem } from '../index';

const base: UpiPaymentParams = {
  payeeVpa: 'shop@okbank',
  payeeName: 'Corner Shop',
  amount: '149.50',
  transactionRef: 'ORDER42',
  note: 'Order 42',
};

function codes(problems: UpiProblem[]): string[] {
  return problems.map((problem) => `${problem.field}:${problem.code}`);
}

describe('validateUpiParams', () => {
  it('accepts valid parameters', () => {
    expect(validateUpiParams(base)).toEqual([]);
    expect(
      validateUpiParams({ ...base, currency: 'INR', merchantCode: '5411', transactionId: 'T1', url: 'https://x.example' }),
    ).toEqual([]);
  });

  it('reports every missing required field', () => {
    expect(codes(validateUpiParams({} as UpiPaymentParams))).toEqual([
      'payeeVpa:REQUIRED',
      'payeeName:REQUIRED',
      'amount:REQUIRED',
      'transactionRef:REQUIRED',
      'note:REQUIRED',
    ]);
  });

  it('treats blank required strings as missing', () => {
    expect(codes(validateUpiParams({ ...base, payeeName: '   ', note: '' }))).toEqual([
      'payeeName:REQUIRED',
      'note:REQUIRED',
    ]);
  });

  it('never throws, whatever it is given', () => {
    const inputs: unknown[] = [null, undefined, 42, 'x', [], { amount: {} }, { payeeVpa: 5, note: true }];
    for (const input of inputs) {
      expect(() => validateUpiParams(input as UpiPaymentParams)).not.toThrow();
      expect(validateUpiParams(input as UpiPaymentParams).length).toBeGreaterThan(0);
    }
  });

  it('reports wrong types', () => {
    const params = { ...base, payeeVpa: 5, amount: true, url: 7 } as unknown as UpiPaymentParams;
    expect(codes(validateUpiParams(params))).toEqual([
      'payeeVpa:INVALID_TYPE',
      'amount:INVALID_TYPE',
      'url:INVALID_TYPE',
    ]);
  });

  it.each([
    'shop@okbank',
    '9876543210@ybl',
    'first.last@okbank',
    'a_b-c@upi',
    'A1@X',
    // Common real shapes: phone numbers, merchant QR handles, PSP prefixes.
    '9876543210-2@ybl',
    'paytmqr2810050501011abcdef@paytm',
    'q123456789@ybl',
    'BHARATPE.9000000000@fbpe',
    'gpay-11234567890@okbizaxis',
    'merchant.name_1@hdfcbank',
    'user.@okaxis',
    '1@upi',
  ])(
    'accepts the VPA %j',
    (payeeVpa) => {
      expect(validateUpiParams({ ...base, payeeVpa })).toEqual([]);
    },
  );

  it.each([
    'shop',
    '@bank',
    'shop@',
    'sh op@bank',
    'shop@bank@x',
    'shop@ba nk',
    'shop#1@bank',
    // Finding 13 (0.1.1): shapes the 0.1.0 pattern accepted.
    '-@-',
    'a@.',
    'a@-',
    '.@b',
    'a@b..',
    'a..b@okaxis',
    '_a@okaxis',
    'a@ok.axis',
    'a@ok-axis',
    'a@ok_axis',
  ])(
    'rejects the VPA %j',
    (payeeVpa) => {
      expect(codes(validateUpiParams({ ...base, payeeVpa }))).toEqual(['payeeVpa:INVALID_VPA']);
    },
  );

  it.each<[string | number]>([
    ['0'],
    ['0.00'],
    [0],
    ['-1'],
    [-5],
    ['1.234'],
    ['1.'],
    ['.5'],
    ['1,000'],
    ['1e3'],
    ['+5'],
    ['abc'],
    ['10 00'],
    ['₹10'],
    [NaN],
    [Infinity],
    [1e21],
    [0.1 + 0.2],
    ['12345678901234'],
  ])('rejects the amount %j', (amount) => {
    expect(codes(validateUpiParams({ ...base, amount }))).toEqual(['amount:INVALID_AMOUNT']);
  });

  // Finding 11 (0.1.1): null means absent, as for every other optional field.
  it('treats a null currency as absent', () => {
    const params = { ...base, currency: null } as unknown as UpiPaymentParams;
    expect(validateUpiParams(params)).toEqual([]);
  });

  it('rejects other currencies', () => {
    const params = { ...base, currency: 'USD' } as unknown as UpiPaymentParams;
    expect(codes(validateUpiParams(params))).toEqual(['currency:INVALID_CURRENCY']);
  });

  it.each(['541', '54111', 'abcd', '54 1'])('rejects the merchant code %j', (merchantCode) => {
    expect(codes(validateUpiParams({ ...base, merchantCode }))).toEqual(['merchantCode:INVALID_MERCHANT_CODE']);
  });

  it('applies the conservative default length limits', () => {
    const over = (n: number) => 'x'.repeat(n + 1);
    expect(
      codes(
        validateUpiParams({
          ...base,
          payeeName: over(DEFAULT_UPI_LIMITS.payeeName),
          transactionRef: over(DEFAULT_UPI_LIMITS.transactionRef),
          note: over(DEFAULT_UPI_LIMITS.note),
        }),
      ),
    ).toEqual(['payeeName:TOO_LONG', 'transactionRef:TOO_LONG', 'note:TOO_LONG']);
    expect(
      validateUpiParams({
        ...base,
        payeeName: 'x'.repeat(DEFAULT_UPI_LIMITS.payeeName),
        transactionRef: 'x'.repeat(DEFAULT_UPI_LIMITS.transactionRef),
        note: 'x'.repeat(DEFAULT_UPI_LIMITS.note),
      }),
    ).toEqual([]);
  });

  it('counts characters, not UTF-16 units', () => {
    const note = '🙂'.repeat(DEFAULT_UPI_LIMITS.note);
    expect(validateUpiParams({ ...base, note })).toEqual([]);
  });

  it('lets callers override the limits', () => {
    const note = 'x'.repeat(80);
    expect(codes(validateUpiParams({ ...base, note }))).toEqual(['note:TOO_LONG']);
    expect(validateUpiParams({ ...base, note }, { limits: { note: 80 } })).toEqual([]);
    expect(codes(validateUpiParams(base, { limits: { transactionRef: 3 } }))).toEqual(['transactionRef:TOO_LONG']);
  });

  it('reports values that cannot be URL-encoded', () => {
    expect(codes(validateUpiParams({ ...base, note: 'bad \ud800 surrogate' }))).toEqual(['note:INVALID_CHARACTERS']);
  });

  // Finding 14 (0.1.1): control characters and surrounding whitespace.
  it.each([
    ['payeeName', 'line\nbreak'],
    ['note', 'tab\there'],
    ['note', 'nul\u0000'],
    ['transactionRef', 'R\u007f1'],
    ['transactionId', 'T\u00851'],
    ['payeeVpa', 'shop\r@okbank'],
    ['url', 'https://x.example/\n'],
  ])('rejects control characters in %s (%j)', (field, value) => {
    expect(codes(validateUpiParams({ ...base, [field]: value }))).toEqual([`${field}:INVALID_CHARACTERS`]);
  });

  it.each([
    ['transactionRef', ' R1 '],
    ['transactionRef', 'R1 '],
    ['payeeName', ' Corner Shop'],
    ['note', 'Order 42\u00a0'],
    ['payeeVpa', ' shop@okbank'],
    ['merchantCode', ' 5411'],
    ['transactionId', 'T1 '],
    ['url', ' https://x.example'],
  ])('rejects surrounding whitespace in %s (%j)', (field, value) => {
    expect(codes(validateUpiParams({ ...base, [field]: value }))).toEqual([`${field}:SURROUNDING_WHITESPACE`]);
  });

  it('keeps inner spaces and non-ASCII text', () => {
    expect(validateUpiParams({ ...base, payeeName: 'रवि  स्टोर', note: 'Order 42 – thanks' })).toEqual([]);
  });

  // Finding 15 (0.1.1): limits for transactionId and url, and http(s) only.
  it('applies default limits to transactionId and url', () => {
    expect(DEFAULT_UPI_LIMITS.transactionId).toBe(35);
    expect(DEFAULT_UPI_LIMITS.url).toBe(255);
    const url = 'https://x.example/' + 'a'.repeat(DEFAULT_UPI_LIMITS.url - 18);
    expect(validateUpiParams({ ...base, transactionId: 'T'.repeat(35), url })).toEqual([]);
    expect(codes(validateUpiParams({ ...base, transactionId: 'T'.repeat(36), url: url + 'a' }))).toEqual([
      'transactionId:TOO_LONG',
      'url:TOO_LONG',
    ]);
    expect(validateUpiParams({ ...base, transactionId: 'T'.repeat(40) }, { limits: { transactionId: 40 } })).toEqual([]);
  });

  it.each(['https://shop.example/orders/42', 'http://shop.example', 'HTTPS://SHOP.EXAMPLE/a?b=c#d'])(
    'accepts the url %j',
    (url) => {
      expect(validateUpiParams({ ...base, url })).toEqual([]);
    },
  );

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,hi',
    'intent://pay#Intent;end',
    'upi://pay?pa=x@y',
    'file:///etc/passwd',
    '//shop.example',
    'shop.example/orders',
    'https://',
    'https:///path',
    'https://exa mple.com',
  ])('rejects the url %j', (url) => {
    expect(codes(validateUpiParams({ ...base, url }))).toEqual(['url:INVALID_URL']);
  });

  it('gives a readable message for each problem', () => {
    const [problem] = validateUpiParams({ ...base, amount: '1.234' });
    expect(problem.message).toMatch(/at most two decimals/);
  });

  it('keeps the default limits frozen', () => {
    expect(Object.isFrozen(DEFAULT_UPI_LIMITS)).toBe(true);
  });
});
