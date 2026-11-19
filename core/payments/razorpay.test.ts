import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSingleOrderCurrency,
  computeRazorpaySignature,
  computeRazorpayWebhookSignature,
  encodeOrderItemsManifest,
  normalizeCheckoutItems,
  parseOrderItemsManifest,
  RazorpayWebhookPayloadSchema,
  signEntitlementProof,
  signOrderBindingToken,
  signOrderManifest,
  sumOrderSubunits,
  toSubunits,
  verifyEntitlementProof,
  verifyOrderBindingToken,
  verifyOrderManifest,
  verifyRazorpaySignature,
  verifyRazorpayWebhookSignature,
} from './razorpay';
import { packManifestIntoNotes, unpackManifestFromNotes } from './fulfillment';

const TEST_SECRET = 'rzp_test_secret_1234567890';
const TEST_WEBHOOK_SECRET = 'whsec_razorpay_test_987654321';

test('toSubunits converts INR rupees cleanly to integer paise', () => {
  assert.equal(toSubunits(100), 10000);
  assert.equal(toSubunits(199.99), 19999);
  assert.equal(toSubunits(0), 0);
  assert.throws(() => toSubunits(-10));
});

test('normalizeCheckoutItems deduplicates digital items and enforces quantity = 1', () => {
  const normalized = normalizeCheckoutItems([
    { itemId: 'B1', contentType: 'books', quantity: 3 },
    { itemId: 'B1', contentType: 'books', quantity: 2 },
    { itemId: 'E1', contentType: 'exams', quantity: 5 },
  ]);

  assert.deepEqual(normalized, [
    { itemId: 'B1', contentType: 'books', quantity: 1 },
    { itemId: 'E1', contentType: 'exams', quantity: 1 },
  ]);
});

test('assertSingleOrderCurrency accepts uniform currency and rejects mixed currencies', () => {
  assert.equal(
    assertSingleOrderCurrency([
      {
        itemId: 'B1',
        contentType: 'books',
        title: 'Book 1',
        urlSlug: 'book-1',
        currency: 'inr',
        unitPrice: 100,
        quantity: 1,
        lineTotal: 100,
      },
      {
        itemId: 'E1',
        contentType: 'exams',
        title: 'Exam 1',
        urlSlug: 'exam-1',
        currency: 'INR',
        unitPrice: 200,
        quantity: 1,
        lineTotal: 200,
      },
    ]),
    'INR'
  );

  assert.throws(() =>
    assertSingleOrderCurrency([
      {
        itemId: 'B1',
        contentType: 'books',
        title: 'Book 1',
        urlSlug: 'book-1',
        currency: 'INR',
        unitPrice: 100,
        quantity: 1,
        lineTotal: 100,
      },
      {
        itemId: 'E1',
        contentType: 'exams',
        title: 'Exam 1',
        urlSlug: 'exam-1',
        currency: 'USD',
        unitPrice: 10,
        quantity: 1,
        lineTotal: 10,
      },
    ])
  );
});

test('verifyRazorpaySignature accepts valid HMAC-SHA256 and rejects tampered signatures', () => {
  const orderId = 'order_Test12345';
  const paymentId = 'pay_Test98765';
  const validSig = computeRazorpaySignature(orderId, paymentId, TEST_SECRET);

  assert.equal(verifyRazorpaySignature(orderId, paymentId, validSig, TEST_SECRET), true);
  assert.equal(verifyRazorpaySignature(orderId, paymentId, validSig + 'x', TEST_SECRET), false);
  assert.equal(verifyRazorpaySignature(orderId, 'pay_Wrong', validSig, TEST_SECRET), false);
  assert.equal(verifyRazorpaySignature(orderId, paymentId, validSig, 'wrong_secret'), false);
});

test('verifyRazorpayWebhookSignature verifies exact raw body bytes in constant time', () => {
  const rawBody = JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_123456',
          order_id: 'order_123456',
          amount: 10000,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
  });

  const sig = computeRazorpayWebhookSignature(rawBody, TEST_WEBHOOK_SECRET);
  assert.equal(verifyRazorpayWebhookSignature(rawBody, sig, TEST_WEBHOOK_SECRET), true);
  assert.equal(verifyRazorpayWebhookSignature(rawBody + ' ', sig, TEST_WEBHOOK_SECRET), false);
  assert.equal(verifyRazorpayWebhookSignature(rawBody, sig, 'wrong_webhook_secret'), false);
  assert.equal(RazorpayWebhookPayloadSchema.safeParse(JSON.parse(rawBody)).success, true);
});

test('order manifest encoding, chunking, signing, and verification prevent item swapping', () => {
  const manifest = encodeOrderItemsManifest([
    { contentType: 'exams', itemId: 'E2' },
    { contentType: 'books', itemId: 'B1' },
    { contentType: 'books', itemId: 'B1' },
  ]);
  assert.equal(manifest, 'books:B1,exams:E2');
  assert.deepEqual(parseOrderItemsManifest(manifest), [
    { contentType: 'books', itemId: 'B1', quantity: 1 },
    { contentType: 'exams', itemId: 'E2', quantity: 1 },
  ]);

  const sig = signOrderManifest(
    { uid: 'user_abc', currency: 'INR', amountSubunits: 30000, manifest },
    TEST_SECRET
  );

  assert.equal(
    verifyOrderManifest(
      { uid: 'user_abc', currency: 'INR', amountSubunits: 30000, manifest, signature: sig },
      TEST_SECRET
    ),
    true
  );

  // Tampering with item list, user, or amount must fail verification
  assert.equal(
    verifyOrderManifest(
      {
        uid: 'user_abc',
        currency: 'INR',
        amountSubunits: 30000,
        manifest: 'books:B1,exams:E999',
        signature: sig,
      },
      TEST_SECRET
    ),
    false
  );
  assert.equal(
    verifyOrderManifest(
      { uid: 'user_other', currency: 'INR', amountSubunits: 30000, manifest, signature: sig },
      TEST_SECRET
    ),
    false
  );
  assert.equal(
    verifyOrderManifest(
      { uid: 'user_abc', currency: 'INR', amountSubunits: 10000, manifest, signature: sig },
      TEST_SECRET
    ),
    false
  );

  // Multi-chunk Razorpay notes packing & unpacking for large carts
  const longManifest = Array.from({ length: 25 }, (_, i) => `books:BOOK_LONG_ID_${i}`).join(',');
  const notes = packManifestIntoNotes(longManifest);
  assert.ok(Object.values(notes).every((v) => v.length <= 240));
  assert.equal(unpackManifestFromNotes(notes), longManifest);
});

test('signOrderBindingToken and verifyOrderBindingToken enforce uid, orderId, and TTL', () => {
  const now = 1_700_000_000_000;
  const token = signOrderBindingToken(
    {
      orderId: 'order_Bind123',
      uid: 'user_abc',
      currency: 'INR',
      amountSubunits: 25000,
      items: [{ itemId: 'B1', contentType: 'books', quantity: 1, unitPriceSubunits: 25000 }],
      issuedAt: now,
      expiresAt: now + 60_000,
    },
    TEST_SECRET
  );

  const valid = verifyOrderBindingToken(
    token,
    { orderId: 'order_Bind123', uid: 'user_abc' },
    TEST_SECRET,
    now + 30_000
  );
  assert.equal(valid.valid, true);
  assert.equal(valid.payload?.amountSubunits, 25000);

  const expired = verifyOrderBindingToken(
    token,
    { orderId: 'order_Bind123', uid: 'user_abc' },
    TEST_SECRET,
    now + 120_000
  );
  assert.equal(expired.valid, false);

  const wrongUser = verifyOrderBindingToken(
    token,
    { orderId: 'order_Bind123', uid: 'user_evil' },
    TEST_SECRET,
    now + 10_000
  );
  assert.equal(wrongUser.valid, false);

  const wrongOrder = verifyOrderBindingToken(
    token,
    { orderId: 'order_Other', uid: 'user_abc' },
    TEST_SECRET,
    now + 10_000
  );
  assert.equal(wrongOrder.valid, false);
});

test('signEntitlementProof and verifyEntitlementProof bind access to uid and itemId', () => {
  const token = signEntitlementProof(
    {
      uid: 'user_abc',
      itemId: 'B1',
      contentType: 'books',
      orderId: 'order_1',
      paymentId: 'pay_1',
      issuedAt: 1700000000000,
    },
    TEST_SECRET
  );

  const ok = verifyEntitlementProof(
    token,
    { uid: 'user_abc', itemId: 'B1', contentType: 'books' },
    TEST_SECRET
  );
  assert.equal(ok.valid, true);
  assert.equal(ok.payload?.paymentId, 'pay_1');

  const wrongUser = verifyEntitlementProof(token, { uid: 'user_other', itemId: 'B1' }, TEST_SECRET);
  assert.equal(wrongUser.valid, false);

  const wrongBook = verifyEntitlementProof(token, { uid: 'user_abc', itemId: 'B2' }, TEST_SECRET);
  assert.equal(wrongBook.valid, false);

  const tampered = verifyEntitlementProof(
    token.slice(0, -4) + 'AAAA',
    { uid: 'user_abc', itemId: 'B1' },
    TEST_SECRET
  );
  assert.equal(tampered.valid, false);
});

test('sumOrderSubunits aggregates line totals accurately', () => {
  const paise = sumOrderSubunits([
    {
      itemId: 'B1',
      contentType: 'books',
      title: 'History',
      urlSlug: 'history',
      currency: 'INR',
      unitPrice: 100,
      quantity: 1,
      lineTotal: 100,
    },
    {
      itemId: 'E1',
      contentType: 'exams',
      title: 'IBPS',
      urlSlug: 'ibps',
      currency: 'INR',
      unitPrice: 200,
      quantity: 2,
      lineTotal: 400,
    },
  ]);
  assert.equal(paise, 50000);
});
