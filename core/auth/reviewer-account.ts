import crypto from 'node:crypto';
import { z } from 'zod';

/**
 * Hexagonal Server-Only Domain Module: Razorpay Verification Reviewer Account
 *
 * Provides a dedicated, hidden test-account credential gate exclusively for
 * payment-gateway verification (e.g., Razorpay KYC / checkout flow audit).
 *
 * Security design:
 * - Zero plaintext credentials in source code (default password verified via salted scrypt hash).
 * - Constant-time credential & HMAC signature verification (`crypto.timingSafeEqual`).
 * - Fully overridable or disableable via server-only environment variables:
 *   - RAZORPAY_TEST_ACCOUNT_ENABLED ("true" | "false", default "true")
 *   - RAZORPAY_TEST_EMAIL
 *   - RAZORPAY_TEST_PASSWORD
 *   - RAZORPAY_TEST_SESSION_SECRET
 */

export const REVIEWER_SESSION_COOKIE_NAME = 'ed_reviewer_session';
export const REVIEWER_SESSION_HINT_COOKIE_NAME = 'ed_rs';
export const REVIEWER_TOKEN_PREFIX = 'rzp_rev_v1.';
export const REVIEWER_UID = 'rzp_test_reviewer_ed';
export const REVIEWER_DISPLAY_NAME = 'Razorpay Reviewer';
export const REVIEWER_SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours

const DEFAULT_REVIEWER_EMAIL = 'razorpay.reviewer@exam-dash.com';
const DEFAULT_PASSWORD_SALT = 'acd49a1e1b5471e1ca8e045c3a1e28ac';
const DEFAULT_PASSWORD_SCRYPT_HEX =
  '9410231a254b51489afeaaec80d2c903ae9ae7425b1800c282bd00f4cb16a5c69ca7df807cc8c955f225d703d9cb2d5b60d3d8e24d8a7d55cdb83486283e4aab';

export const ReviewerLoginInputSchema = z.object({
  identifier: z.string().trim().min(1, 'Email or username is required.').max(254),
  password: z.string().min(1, 'Password is required.').max(256),
});

export interface VerifiedReviewerIdentity {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: 'razorpay_reviewer';
}

interface ReviewerTokenPayload {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
  readonly role: 'razorpay_reviewer';
  readonly iat: number;
  readonly exp: number;
}

export function isReviewerAccountEnabled(): boolean {
  const raw = process.env.RAZORPAY_TEST_ACCOUNT_ENABLED?.trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

export function getConfiguredReviewerEmail(): string {
  const envEmail = process.env.RAZORPAY_TEST_EMAIL?.trim().toLowerCase();
  return envEmail && envEmail.length > 0 ? envEmail : DEFAULT_REVIEWER_EMAIL;
}

export function getReviewerSessionSigningSecret(): string {
  const dedicated = process.env.RAZORPAY_TEST_SESSION_SECRET?.trim();
  if (dedicated) return dedicated;

  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (razorpaySecret) {
    return crypto
      .createHmac('sha256', razorpaySecret)
      .update('examdash:razorpay-reviewer-session:v1')
      .digest('hex');
  }

  // Deterministic server-only fallback for local/preview environments before secrets are set
  return crypto
    .createHash('sha256')
    .update(`examdash:reviewer-fallback:${DEFAULT_PASSWORD_SALT}:${DEFAULT_REVIEWER_EMAIL}`)
    .digest('hex');
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

function verifyPasswordConstantTime(candidatePassword: string): boolean {
  const envPassword = process.env.RAZORPAY_TEST_PASSWORD;
  if (typeof envPassword === 'string' && envPassword.length > 0) {
    return timingSafeStringEqual(candidatePassword, envPassword);
  }

  const derived = crypto.scryptSync(candidatePassword, DEFAULT_PASSWORD_SALT, 64);
  const expected = Buffer.from(DEFAULT_PASSWORD_SCRYPT_HEX, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

/**
 * Verifies reviewer credentials in constant time.
 * Accepts the configured email (case-insensitive) or its username prefix before `@`.
 */
export function verifyReviewerCredentials(
  identifier: string,
  password: string
): VerifiedReviewerIdentity | null {
  if (!isReviewerAccountEnabled()) return null;

  const normalizedInput = identifier.trim().toLowerCase();
  const configuredEmail = getConfiguredReviewerEmail();
  const configuredUsername = configuredEmail.includes('@')
    ? configuredEmail.slice(0, configuredEmail.indexOf('@'))
    : configuredEmail;

  const emailMatched = timingSafeStringEqual(normalizedInput, configuredEmail);
  const usernameMatched =
    configuredUsername.length > 0 && timingSafeStringEqual(normalizedInput, configuredUsername);

  // Always execute password KDF check to avoid timing side-channels
  const passwordMatched = verifyPasswordConstantTime(password);

  if ((!emailMatched && !usernameMatched) || !passwordMatched) {
    return null;
  }

  return {
    uid: REVIEWER_UID,
    email: configuredEmail,
    displayName: REVIEWER_DISPLAY_NAME,
    role: 'razorpay_reviewer',
  };
}

export function signReviewerSessionToken(
  identity: VerifiedReviewerIdentity,
  secret: string = getReviewerSessionSigningSecret(),
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const payload: ReviewerTokenPayload = {
    sub: identity.uid,
    email: identity.email,
    name: identity.displayName,
    role: identity.role,
    iat: nowSeconds,
    exp: nowSeconds + REVIEWER_SESSION_TTL_SECONDS,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${REVIEWER_TOKEN_PREFIX}${encodedPayload}`)
    .digest('base64url');

  return `${REVIEWER_TOKEN_PREFIX}${encodedPayload}.${signature}`;
}

export function isReviewerSessionToken(token: string): boolean {
  return token.trim().startsWith(REVIEWER_TOKEN_PREFIX);
}

export function verifyReviewerSessionToken(
  token: string,
  secret: string = getReviewerSessionSigningSecret(),
  nowSeconds: number = Math.floor(Date.now() / 1000)
): VerifiedReviewerIdentity | null {
  if (!isReviewerAccountEnabled()) return null;

  const clean = token.trim();
  if (!clean.startsWith(REVIEWER_TOKEN_PREFIX) || clean.length > 2048) {
    return null;
  }

  const rest = clean.slice(REVIEWER_TOKEN_PREFIX.length);
  const dotIdx = rest.indexOf('.');
  if (dotIdx <= 0 || dotIdx !== rest.lastIndexOf('.')) {
    return null;
  }

  const encodedPayload = rest.slice(0, dotIdx);
  const providedSig = rest.slice(dotIdx + 1);
  if (!encodedPayload || !providedSig) {
    return null;
  }

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${REVIEWER_TOKEN_PREFIX}${encodedPayload}`)
    .digest('base64url');

  const sigBufA = Buffer.from(providedSig, 'utf8');
  const sigBufB = Buffer.from(expectedSig, 'utf8');
  if (sigBufA.length !== sigBufB.length || !crypto.timingSafeEqual(sigBufA, sigBufB)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as Partial<ReviewerTokenPayload>;

    if (
      parsed.sub !== REVIEWER_UID ||
      parsed.role !== 'razorpay_reviewer' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.name !== 'string' ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.iat !== 'number'
    ) {
      return null;
    }

    if (nowSeconds >= parsed.exp || parsed.iat > nowSeconds + 60) {
      return null;
    }

    return {
      uid: parsed.sub,
      email: parsed.email,
      displayName: parsed.name,
      role: 'razorpay_reviewer',
    };
  } catch {
    return null;
  }
}

// --- Sliding-Window In-Memory Rate Limiter for Reviewer Login ---

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_ATTEMPTS = 15;
const failedAttemptBuckets = new Map<string, number[]>();

export function isLoginRateLimited(clientKey: string, nowMs: number = Date.now()): boolean {
  const history = failedAttemptBuckets.get(clientKey);
  if (!history) return false;
  const recent = history.filter((ts) => nowMs - ts < RATE_WINDOW_MS);
  if (recent.length === 0) {
    failedAttemptBuckets.delete(clientKey);
    return false;
  }
  failedAttemptBuckets.set(clientKey, recent);
  return recent.length >= RATE_MAX_ATTEMPTS;
}

export function recordFailedLoginAttempt(clientKey: string, nowMs: number = Date.now()): void {
  const existing = failedAttemptBuckets.get(clientKey) ?? [];
  const recent = existing.filter((ts) => nowMs - ts < RATE_WINDOW_MS);
  recent.push(nowMs);
  failedAttemptBuckets.set(clientKey, recent);

  // Prevent unbounded memory growth under rotating IPs
  if (failedAttemptBuckets.size > 5000) {
    const oldestKey = failedAttemptBuckets.keys().next().value;
    if (oldestKey) failedAttemptBuckets.delete(oldestKey);
  }
}

export function clearFailedLoginAttempts(clientKey: string): void {
  failedAttemptBuckets.delete(clientKey);
}
