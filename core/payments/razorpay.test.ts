import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRazorpaySignature,
  signEntitlementProof,
  sumOrderSubunits,
  toSubunits,
  verifyEntitlementProof,
  verifyRazorpaySignature,
} from './razorpay';

const TEST_SECRET = 'rzp_test_secret_1234567890';

test('toSubunits converts INR rupees cleanly to integer paise', () => {
  assert.equal(toSubunits(100), 10000);
  assert.equal(toSubunits(199.99), 19999);
  assert.equal(toSubunits(0), 0);
  assert.throws(() => toSubunits(-10));
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

  const ok = verifyEntitlementProof(token, { uid: 'user_abc', itemId: 'B1', contentType: 'books' }, TEST_SECRET);
  assert.equal(ok.valid, true);
  assert.equal(ok.payload?.paymentId, 'pay_1');

  const wrongUser = verifyEntitlementProof(token, { uid: 'user_other', itemId: 'B1' }, TEST_SECRET);
  assert.equal(wrongUser.valid, false);

  const wrongBook = verifyEntitlementProof(token, { uid: 'user_abc', itemId: 'B2' }, TEST_SECRET);
  assert.equal(wrongBook.valid, false);

  const tampered = verifyEntitlementProof(token.slice(0, -4) + 'AAAA', { uid: 'user_abc', itemId: 'B1' }, TEST_SECRET);
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
