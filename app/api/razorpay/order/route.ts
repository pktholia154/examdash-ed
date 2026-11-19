import { NextRequest, NextResponse } from 'next/server';
import {
  CreateOrderRequestSchema,
  sumOrderSubunits,
  type ResolvedOrderItem,
} from '@/core/payments/razorpay';
import { extractBearerToken, verifyFirebaseIdToken } from '@/lib/firebase/server-auth';
import { fetchPublishedBooks, fetchPublishedExams } from '@/lib/firebase/server-catalog';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

    if (!keyId || !keySecret) {
      return NextResponse.json(
        { error: 'Razorpay payment gateway is not configured on the server.' },
        { status: 500 }
      );
    }

    const token = extractBearerToken(req);
    if (!token) {
      return NextResponse.json(
        { error: 'Please sign in with Google before proceeding to checkout.' },
        { status: 401 }
      );
    }

    const verifiedUser = await verifyFirebaseIdToken(token);
    if (!verifiedUser) {
      return NextResponse.json(
        { error: 'Invalid or expired Google session. Please sign in again.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = CreateOrderRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid checkout items payload.', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const [books, exams] = await Promise.all([fetchPublishedBooks(), fetchPublishedExams()]);
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const examMap = new Map(exams.map((e) => [e.id, e]));

    const resolvedItems: ResolvedOrderItem[] = [];
    for (const line of parsed.data.items) {
      if (line.contentType === 'books') {
        const book = bookMap.get(line.itemId);
        if (!book) {
          return NextResponse.json(
            { error: `Book '${line.itemId}' is no longer available in the catalog.` },
            { status: 404 }
          );
        }
        resolvedItems.push({
          itemId: book.id,
          contentType: 'books',
          title: book.title,
          urlSlug: book.urlSlug,
          currency: book.currency || 'INR',
          unitPrice: book.buyPrice,
          quantity: line.quantity,
          lineTotal: book.buyPrice * line.quantity,
        });
      } else if (line.contentType === 'exams') {
        const exam = examMap.get(line.itemId);
        if (!exam) {
          return NextResponse.json(
            { error: `Exam pack '${line.itemId}' is no longer available in the catalog.` },
            { status: 404 }
          );
        }
        resolvedItems.push({
          itemId: exam.id,
          contentType: 'exams',
          title: exam.title,
          urlSlug: exam.urlSlug,
          currency: exam.currency || 'INR',
          unitPrice: exam.buyPrice,
          quantity: line.quantity,
          lineTotal: exam.buyPrice * line.quantity,
        });
      }
    }

    if (resolvedItems.length === 0) {
      return NextResponse.json({ error: 'No valid catalog items found for checkout.' }, { status: 400 });
    }

    const amountSubunits = sumOrderSubunits(resolvedItems);
    if (amountSubunits < 100) {
      return NextResponse.json(
        { error: 'Minimum payable amount for Razorpay checkout is ₹1.00.' },
        { status: 400 }
      );
    }

    const currency = resolvedItems[0].currency || 'INR';
    const receipt = `ed_${verifiedUser.uid.slice(0, 8)}_${Date.now()}`.slice(0, 40);
    const basicAuth = Buffer.from(`${keyId}:${keySecret}`, 'utf8').toString('base64');

    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        amount: amountSubunits,
        currency,
        receipt,
        notes: {
          uid: verifiedUser.uid,
          email: verifiedUser.email ?? '',
          itemIds: resolvedItems.map((i) => `${i.contentType}:${i.itemId}`).join(',').slice(0, 240),
        },
      }),
      cache: 'no-store',
    });

    const rzpOrder = (await rzpRes.json().catch(() => ({}))) as {
      id?: string;
      amount?: number;
      currency?: string;
      error?: { description?: string };
    };

    if (!rzpRes.ok || !rzpOrder.id) {
      return NextResponse.json(
        {
          error:
            rzpOrder.error?.description ||
            `Razorpay order creation failed (HTTP ${rzpRes.status}).`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      orderId: rzpOrder.id,
      amount: rzpOrder.amount ?? amountSubunits,
      currency: rzpOrder.currency ?? currency,
      keyId,
      items: resolvedItems,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create Razorpay order.' },
      { status: 500 }
    );
  }
}
