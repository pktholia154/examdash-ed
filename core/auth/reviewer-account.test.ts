import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearFailedLoginAttempts,
  isLoginRateLimited,
  isReviewerSessionToken,
  recordFailedLoginAttempt,
  REVIEWER_UID,
  signReviewerSessionToken,
  verifyReviewerCredentials,
  verifyReviewerSessionToken,
} from './reviewer-account';

test('verifyReviewerCredentials accepts default email and short username case-insensitively', () => {
  const byEmail = verifyReviewerCredentials('Razorpay.Reviewer@Exam-Dash.com', 'ExamDash#Rzp2026!');
  assert.ok(byEmail);
  assert.equal(byEmail.uid, REVIEWER_UID);
  assert.equal(byEmail.email, 'razorpay.reviewer@exam-dash.com');
  assert.equal(byEmail.role, 'razorpay_reviewer');

  const byUsername = verifyReviewerCredentials('razorpay.reviewer', 'ExamDash#Rzp2026!');
  assert.ok(byUsername);
  assert.equal(byUsername.uid, REVIEWER_UID);
});

test('verifyReviewerCredentials rejects invalid email or password', () => {
  assert.equal(verifyReviewerCredentials('razorpay.reviewer@exam-dash.com', 'WrongPass123!'), null);
  assert.equal(verifyReviewerCredentials('general.user@exam-dash.com', 'ExamDash#Rzp2026!'), null);
  assert.equal(verifyReviewerCredentials('', ''), null);
});

test('signReviewerSessionToken and verifyReviewerSessionToken enforce signature and expiry', () => {
  const identity = verifyReviewerCredentials('razorpay.reviewer@exam-dash.com', 'ExamDash#Rzp2026!');
  assert.ok(identity);

  const secret = 'test-signing-secret-12345';
  const now = 1_700_000_000;
  const token = signReviewerSessionToken(identity, secret, now);

  assert.equal(isReviewerSessionToken(token), true);
  assert.equal(isReviewerSessionToken('eyJhbGciOiJSUzI1NiJ9.firebase'), false);

  const verified = verifyReviewerSessionToken(token, secret, now + 100);
  assert.ok(verified);
  assert.equal(verified.uid, REVIEWER_UID);
  assert.equal(verified.email, 'razorpay.reviewer@exam-dash.com');

  // Wrong secret rejected
  assert.equal(verifyReviewerSessionToken(token, 'other-secret', now + 100), null);

  // Tampered payload rejected
  const tampered = `${token.slice(0, -3)}abc`;
  assert.equal(verifyReviewerSessionToken(tampered, secret, now + 100), null);

  // Expired token rejected
  assert.equal(verifyReviewerSessionToken(token, secret, now + 60 * 60 * 25), null);
});

test('verifyReviewerCredentials respects RAZORPAY_TEST_ACCOUNT_ENABLED=false', () => {
  const prev = process.env.RAZORPAY_TEST_ACCOUNT_ENABLED;
  try {
    process.env.RAZORPAY_TEST_ACCOUNT_ENABLED = 'false';
    assert.equal(
      verifyReviewerCredentials('razorpay.reviewer@exam-dash.com', 'ExamDash#Rzp2026!'),
      null
    );
  } finally {
    if (prev === undefined) delete process.env.RAZORPAY_TEST_ACCOUNT_ENABLED;
    else process.env.RAZORPAY_TEST_ACCOUNT_ENABLED = prev;
  }
});

test('sliding-window rate limiter blocks after 15 failed attempts and resets cleanly', () => {
  const key = 'test-ip-198.51.100.42';
  clearFailedLoginAttempts(key);
  const baseNow = 1_700_000_000_000;

  for (let i = 0; i < 14; i++) {
    recordFailedLoginAttempt(key, baseNow + i * 1000);
    assert.equal(isLoginRateLimited(key, baseNow + i * 1000), false);
  }

  recordFailedLoginAttempt(key, baseNow + 15_000);
  assert.equal(isLoginRateLimited(key, baseNow + 16_000), true);

  // Expires after 15-minute window
  assert.equal(isLoginRateLimited(key, baseNow + 16 * 60 * 1000), false);
  clearFailedLoginAttempts(key);
});
