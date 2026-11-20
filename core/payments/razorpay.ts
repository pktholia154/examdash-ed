import crypto from 'node:crypto';
import { z } from 'zod';

export const CheckoutLineItemSchema = z.object({
  itemId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  contentType: z.enum(['books', 'exams', 'quizbooks']),
  quantity: z.number().int().min(1).max(20).default(1),
});

export type CheckoutLineItemInput = z.infer<typeof CheckoutLineItemSchema>;

export const CreateOrderRequestSchema = z.object({
  items: z.array(CheckoutLineItemSchema).min(1).max(25),
});

export const VerifyPaymentRequestSchema = z.object({
  razorpay_order_id: z
    .string()
    .trim()
    .min(4)
    .max(128)
    .regex(/^order_[a-zA-Z0-9]+$/, 'Invalid Razorpay order ID format.'),
  razorpay_payment_id: z
    .string()
    .trim()
    .min(4)
    .max(128)
    .regex(/^pay_[a-zA-Z0-9]+$/, 'Invalid Razorpay payment ID format.'),
  razorpay_signature: z.string().trim().min(16).max(256),
  orderToken: z.string().trim().min(16).max(4096).optional(),
  items: z.array(CheckoutLineItemSchema).min(1).max(25).optional(),
});

export const ReconcileOrderRequestSchema = z.object({
  razorpay_order_id: z
    .string()
    .trim()
    .min(4)
    .max(128)
    .regex(/^order_[a-zA-Z0-9]+$/, 'Invalid Razorpay order ID format.'),
  orderToken: z.string().trim().min(16).max(4096).optional(),
});

export const RazorpayWebhookPayloadSchema = z.object({
  entity: z.literal('event').optional(),
  account_id: z.string().max(128).optional(),
  event: z.string().min(3).max(128),
  contains: z.array(z.string()).optional(),
  created_at: z.number().int().optional(),
  payload: z.object({
    payment: z
      .object({
        entity: z.object({
          id: z.string().min(4).max(128),
          order_id: z.string().max(128).nullable().optional(),
          amount: z.number().int().nonnegative(),
          currency: z.string().min(3).max(8),
          status: z.string().min(1).max(64),
          method: z.string().max(64).nullable().optional(),
          captured: z.boolean().optional(),
          email: z.string().max(254).nullable().optional(),
          contact: z.string().max(64).nullable().optional(),
          error_code: z.string().max(128).nullable().optional(),
          error_description: z.string().max(500).nullable().optional(),
          notes: z.record(z.string(), z.unknown()).optional(),
        }),
      })
      .optional(),
    order: z
      .object({
        entity: z.object({
          id: z.string().min(4).max(128),
          amount: z.number().int().nonnegative(),
          amount_paid: z.number().int().nonnegative().optional(),
          amount_due: z.number().int().nonnegative().optional(),
          currency: z.string().min(3).max(8),
          receipt: z.string().max(128).nullable().optional(),
          status: z.string().min(1).max(64),
          notes: z.record(z.string(), z.unknown()).optional(),
        }),
      })
      .optional(),
    refund: z
      .object({
        entity: z.object({
          id: z.string().min(4).max(128),
          payment_id: z.string().min(4).max(128),
          amount: z.number().int().nonnegative(),
          currency: z.string().min(3).max(8),
          status: z.string().min(1).max(64),
        }),
      })
      .optional(),
  }),
});

export type RazorpayWebhookPayload = z.infer<typeof RazorpayWebhookPayloadSchema>;

export interface RazorpayServerConfig {
  readonly keyId: string;
  readonly keySecret: string;
  readonly webhookSecret: string | null;
  readonly mode: 'test' | 'live' | 'unknown';
}

export interface ResolvedOrderItem {
  readonly itemId: string;
  readonly contentType: 'books' | 'exams' | 'quizbooks';
  readonly title: string;
  readonly urlSlug: string;
  readonly currency: string;
  readonly unitPrice: number;
  readonly quantity: number;
  readonly lineTotal: number;
}

export interface OrderBindingLine {
  readonly itemId: string;
  readonly contentType: 'books' | 'exams' | 'quizbooks';
  readonly quantity: number;
  readonly unitPriceSubunits: number;
}

export interface OrderBindingTokenPayload {
  readonly orderId: string;
  readonly uid: string;
  readonly currency: string;
  readonly amountSubunits: number;
  readonly items: readonly OrderBindingLine[];
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface EntitlementPayload {
  readonly uid: string;
  readonly itemId: string;
  readonly contentType: string;
  readonly orderId: string;
  readonly paymentId: string;
  readonly issuedAt: number;
}

const ORDER_BINDING_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const KEY_ID_ENV_NAMES = [
  'RAZORPAY_KEY_ID',
  'NEXT_PUBLIC_RAZORPAY_KEY_ID',
  'RAZORPAY_LIVE_KEY_ID',
  'RAZORPAY_KEY',
  'NEXT_PUBLIC_RAZORPAY_KEY',
  'RZP_KEY_ID',
] as const;

const KEY_SECRET_ENV_NAMES = [
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_LIVE_KEY_SECRET',
  'RAZORPAY_SECRET',
  'RZP_KEY_SECRET',
] as const;

const WEBHOOK_SECRET_ENV_NAMES = [
  'RAZORPAY_WEBHOOK_SECRET',
  'RAZORPAY_WEBHOOK_SIGNING_SECRET',
  'RZP_WEBHOOK_SECRET',
] as const;

function stripWrappingQuotes(raw: string): string {
  const trimmed = raw.replace(/^\uFEFF/, '').trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function getRuntimeEnvRecord(): Record<string, string | undefined> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env ?? process.env;
}

/**
 * Reads runtime environment variables via dynamic lookup on `globalThis.process.env`
 * so Next.js / webpack DefinePlugin NEVER statically inlines `NEXT_PUBLIC_RAZORPAY_KEY_ID`
 * as `""` during standalone Docker builds. Also tolerates accidental case or whitespace
 * differences in Cloud Run / Secret Manager variable names and trailing newlines in values.
 */
function readRuntimeEnv(names: readonly string[]): string {
  const runtimeEnv = getRuntimeEnvRecord();
  for (const name of names) {
    const raw = runtimeEnv[name];
    if (typeof raw !== 'string') continue;
    const cleaned = stripWrappingQuotes(raw);
    if (cleaned.length > 0 && !/^MY_RAZORPAY_/i.test(cleaned)) {
      return cleaned;
    }
  }

  // Fallback: case-insensitive & trimmed key lookup in case a secret key has stray spaces/casing
  const upperTargets = new Set(names.map((n) => n.toUpperCase()));
  for (const [envKey, raw] of Object.entries(runtimeEnv)) {
    if (typeof raw !== 'string') continue;
    if (!upperTargets.has(envKey.trim().toUpperCase())) continue;
    const cleaned = stripWrappingQuotes(raw);
    if (cleaned.length > 0 && !/^MY_RAZORPAY_/i.test(cleaned)) {
      return cleaned;
    }
  }

  return '';
}

export function getRazorpayKeySecret(): string {
  return readRuntimeEnv(KEY_SECRET_ENV_NAMES);
}

export function getRazorpayWebhookSecret(): string | null {
  const secret = readRuntimeEnv(WEBHOOK_SECRET_ENV_NAMES);
  return secret || null;
}

export interface RazorpayConfigDiagnostics {
  readonly configured: boolean;
  readonly hasKeyId: boolean;
  readonly hasKeySecret: boolean;
  readonly mode: RazorpayServerConfig['mode'];
  readonly detectedEnvKeys: readonly string[];
}

export function getRazorpayConfigDiagnostics(): RazorpayConfigDiagnostics {
  const runtimeEnv = getRuntimeEnvRecord();
  const detectedEnvKeys = Object.keys(runtimeEnv)
    .filter((k) => /razorpay|rzp/i.test(k))
    .sort();
  const keyId = readRuntimeEnv(KEY_ID_ENV_NAMES);
  const keySecret = getRazorpayKeySecret();
  const mode: RazorpayServerConfig['mode'] = keyId.startsWith('rzp_test_')
    ? 'test'
    : keyId.startsWith('rzp_live_')
      ? 'live'
      : 'unknown';

  return {
    configured: Boolean(keyId && keySecret),
    hasKeyId: Boolean(keyId),
    hasKeySecret: Boolean(keySecret),
    mode,
    detectedEnvKeys,
  };
}

/**
 * Resolves server-side Razorpay configuration from runtime environment variables.
 * Supports `RAZORPAY_KEY_ID`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`, and `RAZORPAY_KEY_SECRET`.
 */
export function getRazorpayServerConfig(): RazorpayServerConfig | null {
  const keyId = readRuntimeEnv(KEY_ID_ENV_NAMES);
  const keySecret = getRazorpayKeySecret();
  const webhookSecret = getRazorpayWebhookSecret();

  if (!keyId || !keySecret) {
    return null;
  }

  const mode: RazorpayServerConfig['mode'] = keyId.startsWith('rzp_test_')
    ? 'test'
    : keyId.startsWith('rzp_live_')
      ? 'live'
      : 'unknown';

  return {
    keyId,
    keySecret,
    webhookSecret,
    mode,
  };
}

/**
 * Deduplicates checkout line items by `(contentType, itemId)` and enforces
 * single-license quantity (`1`) for digital goods so learners can never be
 * accidentally double-billed for the same eBook or online exam pack.
 */
export function normalizeCheckoutItems(
  items: readonly CheckoutLineItemInput[]
): CheckoutLineItemInput[] {
  const seen = new Set<string>();
  const normalized: CheckoutLineItemInput[] = [];
  for (const item of items) {
    const key = `${item.contentType}:${item.itemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      itemId: item.itemId,
      contentType: item.contentType,
      quantity: 1,
    });
  }
  return normalized;
}

/**
 * Ensures every item in an order uses the same uppercase ISO currency code.
 */
export function assertSingleOrderCurrency(items: readonly ResolvedOrderItem[]): string {
  if (items.length === 0) {
    throw new Error('Order must contain at least one item.');
  }
  const currency = (items[0].currency || 'INR').trim().toUpperCase();
  for (const item of items) {
    const itemCurrency = (item.currency || 'INR').trim().toUpperCase();
    if (itemCurrency !== currency) {
      throw new Error(
        `Mixed currencies (${currency} and ${itemCurrency}) cannot be combined in a single Razorpay order.`
      );
    }
  }
  return currency;
}

/**
 * Converts major currency units (e.g., INR rupees) into integer subunits (paise).
 */
export function toSubunits(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Order amount must be a non-negative finite number.');
  }
  return Math.round(amount * 100);
}

/**
 * Computes Razorpay HMAC-SHA256 payment verification signature.
 */
export function computeRazorpaySignature(
  orderId: string,
  paymentId: string,
  keySecret: string
): string {
  return crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

/**
 * Timing-safe verification of Razorpay Checkout payment signature.
 */
export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  providedSignature: string,
  keySecret: string
): boolean {
  if (!orderId || !paymentId || !providedSignature || !keySecret) {
    return false;
  }
  const expectedHex = computeRazorpaySignature(orderId, paymentId, keySecret);
  const expectedBuf = Buffer.from(expectedHex, 'utf8');
  const providedBuf = Buffer.from(providedSignature.trim(), 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Computes Razorpay Webhook HMAC-SHA256 signature over the exact raw request body.
 */
export function computeRazorpayWebhookSignature(
  rawBody: string,
  webhookSecret: string
): string {
  return crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody, 'utf8')
    .digest('hex');
}

/**
 * Timing-safe verification of `X-Razorpay-Signature` header for webhook deliveries.
 */
export function verifyRazorpayWebhookSignature(
  rawBody: string,
  providedSignature: string,
  webhookSecret: string
): boolean {
  if (!rawBody || !providedSignature || !webhookSecret) {
    return false;
  }
  const expectedHex = computeRazorpayWebhookSignature(rawBody, webhookSecret);
  const expectedBuf = Buffer.from(expectedHex, 'utf8');
  const providedBuf = Buffer.from(providedSignature.trim(), 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Encodes ordered items into a compact, canonical string suitable for Razorpay Order `notes`.
 * Format: `books:B1,exams:E1` (sorted deterministically).
 */
export function encodeOrderItemsManifest(
  items: readonly Pick<CheckoutLineItemInput, 'contentType' | 'itemId'>[]
): string {
  return Array.from(
    new Set(items.map((item) => `${item.contentType}:${item.itemId}`))
  )
    .sort()
    .join(',');
}

/**
 * Parses a canonical manifest string (`books:B1,exams:E1`) back into validated checkout line items.
 */
export function parseOrderItemsManifest(manifest: string): CheckoutLineItemInput[] {
  if (!manifest || typeof manifest !== 'string') return [];
  const parsed: CheckoutLineItemInput[] = [];
  for (const part of manifest.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;
    const contentType = trimmed.slice(0, colonIdx);
    const itemId = trimmed.slice(colonIdx + 1);
    const check = CheckoutLineItemSchema.safeParse({
      contentType,
      itemId,
      quantity: 1,
    });
    if (check.success) {
      parsed.push(check.data);
    }
  }
  return normalizeCheckoutItems(parsed);
}

/**
 * Computes a tamper-proof HMAC signature over `(uid, currency, amountSubunits, manifest)`
 * stored in Razorpay Order `notes.manifest_sig` so even stateless webhook/reconciliation
 * lookups can cryptographically prove which exact items & user an order was created for.
 */
export function signOrderManifest(
  params: {
    readonly uid: string;
    readonly currency: string;
    readonly amountSubunits: number;
    readonly manifest: string;
  },
  keySecret: string
): string {
  const canonical = `ed_manifest_v1|${params.uid}|${params.currency.toUpperCase()}|${params.amountSubunits}|${params.manifest}`;
  return crypto.createHmac('sha256', keySecret).update(canonical, 'utf8').digest('hex');
}

export function verifyOrderManifest(
  params: {
    readonly uid: string;
    readonly currency: string;
    readonly amountSubunits: number;
    readonly manifest: string;
    readonly signature: string;
  },
  keySecret: string
): boolean {
  if (!params.uid || !params.currency || !params.manifest || !params.signature || !keySecret) {
    return false;
  }
  const expected = signOrderManifest(params, keySecret);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(params.signature.trim(), 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Mints a short-lived server-signed token binding a Razorpay `order_id` to the exact
 * user UID, resolved line items, locked unit prices, currency, and total subunits.
 */
export function signOrderBindingToken(
  payload: Omit<OrderBindingTokenPayload, 'issuedAt' | 'expiresAt'> & {
    issuedAt?: number;
    expiresAt?: number;
  },
  keySecret: string
): string {
  const issuedAt = payload.issuedAt ?? Date.now();
  const fullPayload: OrderBindingTokenPayload = {
    orderId: payload.orderId,
    uid: payload.uid,
    currency: payload.currency.toUpperCase(),
    amountSubunits: payload.amountSubunits,
    items: payload.items,
    issuedAt,
    expiresAt: payload.expiresAt ?? issuedAt + ORDER_BINDING_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', keySecret)
    .update(`ed_order_v1.${encoded}`)
    .digest('base64url');
  return `ed_order_v1.${encoded}.${sig}`;
}

export function verifyOrderBindingToken(
  token: string,
  expected: { readonly orderId: string; readonly uid: string },
  keySecret: string,
  nowMs: number = Date.now()
): { readonly valid: boolean; readonly payload: OrderBindingTokenPayload | null } {
  if (!token || !keySecret) {
    return { valid: false, payload: null };
  }
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'ed_order_v1') {
    return { valid: false, payload: null };
  }
  const [, encoded, providedSig] = parts;
  if (!encoded || !providedSig) {
    return { valid: false, payload: null };
  }

  const expectedSig = crypto
    .createHmac('sha256', keySecret)
    .update(`ed_order_v1.${encoded}`)
    .digest('base64url');

  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  const providedBuf = Buffer.from(providedSig, 'utf8');
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return { valid: false, payload: null };
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as Partial<OrderBindingTokenPayload>;

    if (
      parsed.orderId !== expected.orderId ||
      parsed.uid !== expected.uid ||
      typeof parsed.currency !== 'string' ||
      typeof parsed.amountSubunits !== 'number' ||
      !Array.isArray(parsed.items) ||
      parsed.items.length === 0 ||
      typeof parsed.expiresAt !== 'number' ||
      nowMs > parsed.expiresAt
    ) {
      return { valid: false, payload: null };
    }

    return { valid: true, payload: parsed as OrderBindingTokenPayload };
  } catch {
    return { valid: false, payload: null };
  }
}

/**
 * Signs a server-verifiable entitlement proof bound to a specific user, catalog item,
 * and verified Razorpay order/payment pair.
 */
export function signEntitlementProof(
  payload: Omit<EntitlementPayload, 'issuedAt'> & { issuedAt?: number },
  keySecret: string
): string {
  const fullPayload: EntitlementPayload = {
    uid: payload.uid,
    itemId: payload.itemId,
    contentType: payload.contentType,
    orderId: payload.orderId,
    paymentId: payload.paymentId,
    issuedAt: payload.issuedAt ?? Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', keySecret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

/**
 * Verifies a server-issued entitlement proof for full-book/exam access without requiring
 * Firebase Admin IAM privileges on Starter Tier projects.
 */
export function verifyEntitlementProof(
  proofToken: string,
  expected: { readonly uid: string; readonly itemId: string; readonly contentType?: string },
  keySecret: string
): { readonly valid: boolean; readonly payload: EntitlementPayload | null } {
  if (!proofToken || !keySecret) {
    return { valid: false, payload: null };
  }
  const parts = proofToken.split('.');
  if (parts.length !== 2) {
    return { valid: false, payload: null };
  }
  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) {
    return { valid: false, payload: null };
  }

  const expectedSig = crypto.createHmac('sha256', keySecret).update(encoded).digest('base64url');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  const providedBuf = Buffer.from(providedSig, 'utf8');
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return { valid: false, payload: null };
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as EntitlementPayload;
    if (
      typeof parsed.uid !== 'string' ||
      typeof parsed.itemId !== 'string' ||
      typeof parsed.orderId !== 'string' ||
      typeof parsed.paymentId !== 'string'
    ) {
      return { valid: false, payload: null };
    }
    if (parsed.uid !== expected.uid || parsed.itemId !== expected.itemId) {
      return { valid: false, payload: null };
    }
    if (expected.contentType && parsed.contentType !== expected.contentType) {
      return { valid: false, payload: null };
    }
    return { valid: true, payload: parsed };
  } catch {
    return { valid: false, payload: null };
  }
}

export function sumOrderSubunits(items: readonly ResolvedOrderItem[]): number {
  const totalMajor = items.reduce((acc, item) => acc + item.lineTotal, 0);
  return toSubunits(totalMajor);
}
