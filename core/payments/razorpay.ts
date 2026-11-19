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
  razorpay_order_id: z.string().min(4).max(128),
  razorpay_payment_id: z.string().min(4).max(128),
  razorpay_signature: z.string().min(16).max(256),
  items: z.array(CheckoutLineItemSchema).min(1).max(25),
});

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

export interface EntitlementPayload {
  readonly uid: string;
  readonly itemId: string;
  readonly contentType: string;
  readonly orderId: string;
  readonly paymentId: string;
  readonly issuedAt: number;
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
