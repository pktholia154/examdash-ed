import { NextRequest, NextResponse } from 'next/server';
import {
  signEntitlementProof,
  verifyRazorpaySignature,
  VerifyPaymentRequestSchema,
} from '@/core/payments/razorpay';
import { extractBearerToken, verifyFirebaseIdToken } from '@/lib/firebase/server-auth';
import { fetchPublishedBooks, fetchPublishedExams } from '@/lib/firebase/server-catalog';
import type { PurchasedItem } from '@/lib/design-system/types';

export const runtime = 'nodejs';

function makePurchaseId(contentType: string, itemId: string): string {
  return `${contentType}_${itemId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

export async function POST(req: NextRequest) {
  try {
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keySecret) {
      return NextResponse.json(
        { error: 'Razorpay secret is not configured on the server.' },
        { status: 500 }
      );
    }

    const token = extractBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const verifiedUser = await verifyFirebaseIdToken(token);
    if (!verifiedUser) {
      return NextResponse.json({ error: 'Invalid or expired Google session.' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const parsed = VerifyPaymentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payment verification payload.' },
        { status: 400 }
      );
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, items } = parsed.data;

    const isSignatureValid = verifyRazorpaySignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      keySecret
    );

    if (!isSignatureValid) {
      return NextResponse.json(
        { verified: false, error: 'Razorpay payment signature verification failed.' },
        { status: 400 }
      );
    }

    const [books, exams] = await Promise.all([fetchPublishedBooks(), fetchPublishedExams()]);
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const examMap = new Map(exams.map((e) => [e.id, e]));
    const nowIso = new Date().toISOString();

    const purchases: PurchasedItem[] = [];
    for (const line of items) {
      const catalogItem =
        line.contentType === 'books' ? bookMap.get(line.itemId) : examMap.get(line.itemId);
      if (!catalogItem) continue;

      const entitlementProof = signEntitlementProof(
        {
          uid: verifiedUser.uid,
          itemId: catalogItem.id,
          contentType: line.contentType,
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
        },
        keySecret
      );

      purchases.push({
        id: makePurchaseId(line.contentType, catalogItem.id),
        itemId: catalogItem.id,
        contentType: line.contentType,
        title: catalogItem.title,
        urlSlug: catalogItem.urlSlug,
        currency: catalogItem.currency || 'INR',
        amountPaid: catalogItem.buyPrice * line.quantity,
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        entitlementProof,
        status: 'completed',
        purchasedAt: nowIso,
      });
    }

    return NextResponse.json({
      verified: true,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      purchases,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to verify payment.' },
      { status: 500 }
    );
  }
}
