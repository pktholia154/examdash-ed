import { NextRequest, NextResponse } from 'next/server';
import {
  getRazorpayServerConfig,
  verifyRazorpaySignature,
  VerifyPaymentRequestSchema,
} from '@/core/payments/razorpay';
import { fetchRazorpayOrder, fetchRazorpayPayment } from '@/core/payments/razorpay-api';
import { fulfillVerifiedRazorpayOrder } from '@/core/payments/fulfillment';
import { extractBearerToken, verifyFirebaseIdToken } from '@/lib/firebase/server-auth';

export const runtime = 'nodejs';

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
    const parsed = VerifyPaymentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payment verification payload.', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderToken } = parsed.data;

    // Layer 1: Timing-safe HMAC-SHA256 verification of Razorpay checkout signature
    const isSignatureValid = verifyRazorpaySignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      config.keySecret
    );

    if (!isSignatureValid) {
      return NextResponse.json(
        { verified: false, error: 'Razorpay payment signature verification failed.' },
        { status: 400 }
      );
    }

    // Layer 2: Authoritative server-to-server cross-check against Razorpay Orders & Payments APIs
    const [orderRes, paymentRes] = await Promise.all([
      fetchRazorpayOrder(config, razorpay_order_id),
      fetchRazorpayPayment(config, razorpay_payment_id),
    ]);

    if (!orderRes.ok) {
      return NextResponse.json(
        { verified: false, error: `Could not verify Razorpay order: ${orderRes.error}` },
        { status: orderRes.status === 504 ? 504 : 502 }
      );
    }

    if (!paymentRes.ok) {
      return NextResponse.json(
        { verified: false, error: `Could not verify Razorpay payment: ${paymentRes.error}` },
        { status: paymentRes.status === 504 ? 504 : 502 }
      );
    }

    // Layer 3 & 4: Ownership, capture enforcement, signed manifest verification & entitlement issuance
    const fulfillment = await fulfillVerifiedRazorpayOrder({
      config,
      uid: verifiedUser.uid,
      order: orderRes.data,
      payment: paymentRes.data,
      orderToken,
    });

    if (!fulfillment.ok) {
      return NextResponse.json(
        { verified: false, error: fulfillment.error },
        { status: fulfillment.status }
      );
    }

    return NextResponse.json(
      {
        verified: true,
        orderId: fulfillment.orderId,
        paymentId: fulfillment.paymentId,
        paymentMethod: fulfillment.paymentMethod,
        amountPaidSubunits: fulfillment.amountPaidSubunits,
        currency: fulfillment.currency,
        capturedNow: fulfillment.capturedNow,
        purchases: fulfillment.purchases,
      },
      {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to verify payment.' },
      { status: 500 }
    );
  }
}
