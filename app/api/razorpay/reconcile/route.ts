import { NextRequest, NextResponse } from 'next/server';
import {
  getRazorpayServerConfig,
  ReconcileOrderRequestSchema,
} from '@/core/payments/razorpay';
import {
  fetchRazorpayOrder,
  fetchRazorpayOrderPayments,
  type RazorpayPaymentEntity,
} from '@/core/payments/razorpay-api';
import { fulfillVerifiedRazorpayOrder } from '@/core/payments/fulfillment';
import { extractBearerToken, verifyFirebaseIdToken } from '@/lib/firebase/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Picks the highest-priority actionable payment for an order:
 * 1. `captured` (already settled)
 * 2. `authorized` (will be auto-captured by fulfillment)
 * 3. `created` (pending bank/UPI confirmation)
 * 4. `failed` / `refunded`
 */
function selectBestPayment(
  payments: readonly RazorpayPaymentEntity[]
): RazorpayPaymentEntity | null {
  if (payments.length === 0) return null;
  const captured = payments.find((p) => p.status === 'captured');
  if (captured) return captured;
  const authorized = payments.find((p) => p.status === 'authorized');
  if (authorized) return authorized;
  const created = payments.find((p) => p.status === 'created');
  if (created) return created;
  return payments[0];
}

/**
 * POST /api/razorpay/reconcile
 * Recovers interrupted or callback-missed Razorpay orders (e.g. UPI app switch,
 * browser crash, or transient network drop after payment debit) by querying
 * Razorpay's authoritative Orders & Order Payments REST APIs.
 */
export async function POST(req: NextRequest) {
  try {
    const config = getRazorpayServerConfig();
    if (!config) {
      return NextResponse.json(
        { error: 'Razorpay payment gateway is not configured on the server.' },
        { status: 503 }
      );
    }

    const token = extractBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const verifiedUser = await verifyFirebaseIdToken(token);
    if (!verifiedUser) {
      return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const parsed = ReconcileOrderRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Please enter a valid Razorpay Order ID (for example: order_...).',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { razorpay_order_id, orderToken } = parsed.data;

    const [orderRes, paymentsRes] = await Promise.all([
      fetchRazorpayOrder(config, razorpay_order_id),
      fetchRazorpayOrderPayments(config, razorpay_order_id),
    ]);

    if (!orderRes.ok) {
      return NextResponse.json(
        {
          error:
            orderRes.status === 404 || orderRes.status === 400
              ? 'We could not find a Razorpay order with that ID.'
              : `Unable to look up Razorpay order: ${orderRes.error}`,
        },
        { status: orderRes.status === 404 || orderRes.status === 400 ? 404 : 502 }
      );
    }

    const order = orderRes.data;
    const ownerUid = typeof order.notes?.uid === 'string' ? order.notes.uid.trim() : '';
    if (!ownerUid || ownerUid !== verifiedUser.uid) {
      return NextResponse.json(
        { error: 'This Razorpay order is not associated with your signed-in account.' },
        { status: 403 }
      );
    }

    if (!paymentsRes.ok) {
      return NextResponse.json(
        { error: `Unable to inspect payments for this order: ${paymentsRes.error}` },
        { status: 502 }
      );
    }

    const bestPayment = selectBestPayment(paymentsRes.data.items);
    if (!bestPayment) {
      return NextResponse.json(
        {
          status: 'pending',
          verified: false,
          orderId: order.id,
          message:
            'No completed payment has been recorded by Razorpay for this order yet. If money was debited, please wait a minute and retry or email support@exam-kart.com.',
        },
        { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
      );
    }

    if (bestPayment.status === 'created') {
      return NextResponse.json(
        {
          status: 'pending',
          verified: false,
          orderId: order.id,
          paymentId: bestPayment.id,
          message:
            'Your payment is still awaiting bank/UPI confirmation. Please check again in a moment.',
        },
        { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
      );
    }

    if (bestPayment.status === 'failed') {
      return NextResponse.json(
        {
          status: 'failed',
          verified: false,
          orderId: order.id,
          paymentId: bestPayment.id,
          message:
            bestPayment.error_description ||
            'The payment attempt for this order failed. No funds were captured by Exam Kart.',
        },
        { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
      );
    }

    if (bestPayment.status === 'refunded') {
      return NextResponse.json(
        {
          status: 'refunded',
          verified: false,
          orderId: order.id,
          paymentId: bestPayment.id,
          message: 'This payment has been refunded to the original payment source.',
        },
        { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
      );
    }

    // Captured or Authorized -> Fulfill & unlock immediately
    const fulfillment = await fulfillVerifiedRazorpayOrder({
      config,
      uid: verifiedUser.uid,
      order,
      payment: bestPayment,
      orderToken,
    });

    if (!fulfillment.ok) {
      return NextResponse.json(
        { status: 'error', verified: false, error: fulfillment.error },
        { status: fulfillment.status }
      );
    }

    return NextResponse.json(
      {
        status: 'completed',
        verified: true,
        orderId: fulfillment.orderId,
        paymentId: fulfillment.paymentId,
        paymentMethod: fulfillment.paymentMethod,
        amountPaidSubunits: fulfillment.amountPaidSubunits,
        currency: fulfillment.currency,
        capturedNow: fulfillment.capturedNow,
        purchases: fulfillment.purchases,
      },
      { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to reconcile Razorpay order.' },
      { status: 500 }
    );
  }
}
