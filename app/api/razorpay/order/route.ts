import { NextRequest, NextResponse } from 'next/server';
import {
  assertSingleOrderCurrency,
  CreateOrderRequestSchema,
  encodeOrderItemsManifest,
  getRazorpayConfigDiagnostics,
  getRazorpayServerConfig,
  normalizeCheckoutItems,
  signOrderBindingToken,
  signOrderManifest,
  sumOrderSubunits,
  toSubunits,
  type OrderBindingLine,
  type ResolvedOrderItem,
} from '@/core/payments/razorpay';
import { createRazorpayOrder } from '@/core/payments/razorpay-api';
import { packManifestIntoNotes } from '@/core/payments/fulfillment';
import { extractBearerToken, verifyFirebaseIdToken } from '@/lib/firebase/server-auth';
import { fetchPublishedBooks, fetchPublishedExams } from '@/lib/firebase/server-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const config = getRazorpayServerConfig();
    if (!config) {
      const diag = getRazorpayConfigDiagnostics();
      const missing: string[] = [];
      if (!diag.hasKeyId) missing.push('RAZORPAY_KEY_ID (or NEXT_PUBLIC_RAZORPAY_KEY_ID)');
      if (!diag.hasKeySecret) missing.push('RAZORPAY_KEY_SECRET');
      console.error(
        JSON.stringify({
          scope: 'razorpay.order.unconfigured',
          hasKeyId: diag.hasKeyId,
          hasKeySecret: diag.hasKeySecret,
          detectedEnvKeys: diag.detectedEnvKeys,
        })
      );
      return NextResponse.json(
        {
          error: `Razorpay payment gateway is not configured on the server (missing ${missing.join(' and ')} in runtime environment).`,
        },
        { status: 503 }
      );
    }

    const token = extractBearerToken(req);
    if (!token) {
      return NextResponse.json(
        { error: 'Please sign in before proceeding to checkout.' },
        { status: 401 }
      );
    }

    const verifiedUser = await verifyFirebaseIdToken(token);
    if (!verifiedUser) {
      return NextResponse.json(
        { error: 'Invalid or expired session. Please sign in again.' },
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

    // Deduplicate digital items and enforce single-license quantity = 1
    const normalizedItems = normalizeCheckoutItems(parsed.data.items);

    const [books, exams] = await Promise.all([fetchPublishedBooks(), fetchPublishedExams()]);
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const examMap = new Map(exams.map((e) => [e.id, e]));

    const resolvedItems: ResolvedOrderItem[] = [];
    for (const line of normalizedItems) {
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
          currency: (book.currency || 'INR').trim().toUpperCase(),
          unitPrice: book.buyPrice,
          quantity: 1,
          lineTotal: book.buyPrice,
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
          currency: (exam.currency || 'INR').trim().toUpperCase(),
          unitPrice: exam.buyPrice,
          quantity: 1,
          lineTotal: exam.buyPrice,
        });
      }
    }

    if (resolvedItems.length === 0) {
      return NextResponse.json(
        { error: 'No valid catalog items found for checkout.' },
        { status: 400 }
      );
    }

    let currency: string;
    try {
      currency = assertSingleOrderCurrency(resolvedItems);
    } catch (currencyErr) {
      return NextResponse.json(
        { error: currencyErr instanceof Error ? currencyErr.message : 'Currency mismatch.' },
        { status: 400 }
      );
    }

    const amountSubunits = sumOrderSubunits(resolvedItems);
    if (amountSubunits < 100) {
      return NextResponse.json(
        { error: 'Minimum payable amount for Razorpay checkout is ₹1.00.' },
        { status: 400 }
      );
    }

    const receipt = `ed_${verifiedUser.uid.slice(0, 8)}_${Date.now()}`.slice(0, 40);
    const manifest = encodeOrderItemsManifest(resolvedItems);
    const manifestSig = signOrderManifest(
      {
        uid: verifiedUser.uid,
        currency,
        amountSubunits,
        manifest,
      },
      config.keySecret
    );

    const packedManifestNotes = packManifestIntoNotes(manifest);
    const orderRes = await createRazorpayOrder(config, {
      amount: amountSubunits,
      currency,
      receipt,
      notes: {
        uid: verifiedUser.uid,
        email: (verifiedUser.email ?? '').slice(0, 240),
        platform: 'exam-dash.com',
        expected_subunits: String(amountSubunits),
        manifest_sig: manifestSig,
        ...packedManifestNotes,
      },
    });

    if (!orderRes.ok || !orderRes.data.id) {
      return NextResponse.json(
        {
          error: !orderRes.ok ? orderRes.error : 'Razorpay order creation failed.',
        },
        { status: !orderRes.ok && orderRes.status === 504 ? 504 : 502 }
      );
    }

    const rzpOrder = orderRes.data;
    const bindingLines: OrderBindingLine[] = resolvedItems.map((item) => ({
      itemId: item.itemId,
      contentType: item.contentType,
      quantity: item.quantity,
      unitPriceSubunits: toSubunits(item.unitPrice),
    }));

    const orderToken = signOrderBindingToken(
      {
        orderId: rzpOrder.id,
        uid: verifiedUser.uid,
        currency: rzpOrder.currency || currency,
        amountSubunits: rzpOrder.amount ?? amountSubunits,
        items: bindingLines,
      },
      config.keySecret
    );

    return NextResponse.json(
      {
        orderId: rzpOrder.id,
        amount: rzpOrder.amount ?? amountSubunits,
        currency: rzpOrder.currency ?? currency,
        receipt,
        keyId: config.keyId,
        mode: config.mode,
        orderToken,
        items: resolvedItems,
      },
      {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create Razorpay order.' },
      { status: 500 }
    );
  }
}
