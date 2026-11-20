import { NextRequest, NextResponse } from 'next/server';
import {
  getRazorpayServerConfig,
  getRazorpayWebhookSecret,
  RazorpayWebhookPayloadSchema,
  verifyRazorpayWebhookSignature,
} from '@/core/payments/razorpay';
import { captureRazorpayPayment } from '@/core/payments/razorpay-api';

export const runtime = 'nodejs';

// Bounded in-memory idempotency set for webhook event replay protection within the server instance
const MAX_TRACKED_EVENTS = 2000;
const processedEventIds = new Set<string>();

function markEventProcessed(eventId: string): boolean {
  if (!eventId) return false;
  if (processedEventIds.has(eventId)) return true;
  processedEventIds.add(eventId);
  if (processedEventIds.size > MAX_TRACKED_EVENTS) {
    const oldest = processedEventIds.values().next().value;
    if (oldest) processedEventIds.delete(oldest);
  }
  return false;
}

/**
 * POST /api/razorpay/webhook
 * Authoritative Razorpay server-to-server webhook endpoint.
 *
 * Setup in Razorpay Dashboard -> Webhooks:
 * - Endpoint URL: https://exam-dash.com/api/razorpay/webhook
 * - Secret: set identical value in `RAZORPAY_WEBHOOK_SECRET`
 * - Recommended events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.created`, `refund.processed`
 */
export async function POST(req: NextRequest) {
  try {
    const webhookSecret = getRazorpayWebhookSecret();
    if (!webhookSecret) {
      return NextResponse.json(
        { error: 'Razorpay webhook secret is not configured on the server.' },
        { status: 503 }
      );
    }

    const signature = req.headers.get('x-razorpay-signature')?.trim() ?? '';
    const eventId = req.headers.get('x-razorpay-event-id')?.trim() ?? '';

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing X-Razorpay-Signature header.' },
        { status: 400 }
      );
    }

    // CRITICAL: Read exact raw request bytes before any JSON parsing so HMAC matches Razorpay's signature
    const rawBody = await req.text();
    if (!rawBody) {
      return NextResponse.json({ error: 'Empty webhook payload.' }, { status: 400 });
    }

    const isSignatureValid = verifyRazorpayWebhookSignature(rawBody, signature, webhookSecret);
    if (!isSignatureValid) {
      return NextResponse.json(
        { error: 'Invalid Razorpay webhook signature.' },
        { status: 401 }
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Malformed JSON webhook body.' }, { status: 400 });
    }

    const parsed = RazorpayWebhookPayloadSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Unrecognized Razorpay webhook payload schema.' },
        { status: 400 }
      );
    }

    const isDuplicate = markEventProcessed(eventId);
    const { event, payload } = parsed.data;
    const payment = payload.payment?.entity;
    const order = payload.order?.entity;
    const refund = payload.refund?.entity;

    if (isDuplicate) {
      return NextResponse.json(
        { received: true, duplicate: true, event, eventId },
        { status: 200 }
      );
    }

    let autoCaptured = false;

    // If Razorpay delivers `payment.authorized` (auto-capture off or delayed), capture idempotently server-side
    if (event === 'payment.authorized' && payment && payment.status === 'authorized') {
      const config = getRazorpayServerConfig();
      if (config) {
        const cap = await captureRazorpayPayment(
          config,
          payment.id,
          payment.amount,
          payment.currency
        );
        if (cap.ok) {
          autoCaptured = true;
        } else {
          console.warn(
            JSON.stringify({
              scope: 'razorpay.webhook.autocapture_failed',
              event,
              eventId,
              paymentId: payment.id,
              orderId: payment.order_id ?? null,
              error: cap.error,
            })
          );
        }
      }
    }

    // Structured non-PII observability log for billing & refund reconciliation
    console.info(
      JSON.stringify({
        scope: 'razorpay.webhook.received',
        event,
        eventId: eventId || null,
        orderId: order?.id ?? payment?.order_id ?? null,
        paymentId: payment?.id ?? refund?.payment_id ?? null,
        refundId: refund?.id ?? null,
        status: payment?.status ?? order?.status ?? refund?.status ?? null,
        amountSubunits: payment?.amount ?? order?.amount ?? refund?.amount ?? null,
        currency: payment?.currency ?? order?.currency ?? refund?.currency ?? null,
        autoCaptured,
      })
    );

    return NextResponse.json(
      {
        received: true,
        duplicate: false,
        event,
        eventId: eventId || null,
        autoCaptured,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      }
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: 'razorpay.webhook.error',
        error: error instanceof Error ? error.message : 'Unexpected webhook error',
      })
    );
    return NextResponse.json(
      { error: 'Unable to process Razorpay webhook.' },
      { status: 500 }
    );
  }
}
