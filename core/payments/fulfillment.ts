import {
  parseOrderItemsManifest,
  signEntitlementProof,
  toSubunits,
  verifyOrderBindingToken,
  verifyOrderManifest,
  type OrderBindingLine,
  type RazorpayServerConfig,
} from './razorpay';
import {
  captureRazorpayPayment,
  type RazorpayOrderEntity,
  type RazorpayPaymentEntity,
} from './razorpay-api';
import { fetchPublishedBooks, fetchPublishedExams } from '@/lib/firebase/server-catalog';
import type { PurchasedItem } from '@/lib/design-system/types';

export function makePurchaseDocId(contentType: string, itemId: string): string {
  return `${contentType}_${itemId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

/**
 * Splits a canonical manifest string across up to 4 Razorpay Order note keys (`items`, `items_2`, `items_3`, `items_4`),
 * respecting Razorpay's 256-char per-note value limit so large baskets are never silently truncated.
 */
export function packManifestIntoNotes(manifest: string): Record<string, string> {
  const CHUNK_SIZE = 240;
  const out: Record<string, string> = {};
  if (manifest.length <= CHUNK_SIZE) {
    out.items = manifest;
    return out;
  }
  const keys = ['items', 'items_2', 'items_3', 'items_4'] as const;
  for (let i = 0; i < keys.length; i += 1) {
    const slice = manifest.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    if (!slice) break;
    out[keys[i]] = slice;
  }
  return out;
}

/**
 * Reassembles a canonical manifest string from Razorpay Order `notes`.
 */
export function unpackManifestFromNotes(
  notes: Record<string, unknown> | null | undefined
): string {
  if (!notes || typeof notes !== 'object') return '';
  const keys = ['items', 'items_2', 'items_3', 'items_4'] as const;
  let combined = '';
  for (const k of keys) {
    const v = notes[k];
    if (typeof v === 'string' && v.length > 0) {
      combined += v;
    }
  }
  return combined;
}

export type FulfillmentResult =
  | {
      readonly ok: true;
      readonly orderId: string;
      readonly paymentId: string;
      readonly paymentMethod: string | null;
      readonly amountPaidSubunits: number;
      readonly currency: string;
      readonly capturedNow: boolean;
      readonly purchases: PurchasedItem[];
    }
  | {
      readonly ok: false;
      readonly status: number;
      readonly error: string;
    };

/**
 * Authoritatively verifies a Razorpay Order + Payment pair fetched directly from Razorpay's REST API,
 * auto-captures `authorized` payments if needed, proves ownership & item integrity without trusting
 * client-submitted item lists, and mints server-signed entitlement proofs.
 */
export async function fulfillVerifiedRazorpayOrder(params: {
  readonly config: RazorpayServerConfig;
  readonly uid: string;
  readonly order: RazorpayOrderEntity;
  readonly payment: RazorpayPaymentEntity;
  readonly orderToken?: string;
}): Promise<FulfillmentResult> {
  const { config, uid, order, orderToken } = params;
  let payment = params.payment;

  // 1. Bind payment strictly to this order
  if (payment.order_id !== order.id) {
    return {
      ok: false,
      status: 400,
      error: 'Payment does not belong to the specified Razorpay order.',
    };
  }

  // 2. Verify user ownership stored in Razorpay order notes (blocks cross-user replay)
  const orderNotes = order.notes ?? {};
  const orderOwnerUid = typeof orderNotes.uid === 'string' ? orderNotes.uid.trim() : '';
  if (!orderOwnerUid || orderOwnerUid !== uid) {
    return {
      ok: false,
      status: 403,
      error: 'This Razorpay order belongs to a different account.',
    };
  }

  // 3. Verify currency & amount match between Order and Payment
  const orderCurrency = (order.currency || 'INR').trim().toUpperCase();
  const paymentCurrency = (payment.currency || 'INR').trim().toUpperCase();
  if (paymentCurrency !== orderCurrency || payment.amount !== order.amount) {
    return {
      ok: false,
      status: 400,
      error: 'Payment amount or currency mismatch detected.',
    };
  }

  // 4. Ensure payment is captured (auto-capture if merchant account left it in `authorized` state)
  let capturedNow = false;
  if (payment.status === 'authorized') {
    const captureRes = await captureRazorpayPayment(
      config,
      payment.id,
      order.amount,
      orderCurrency
    );
    if (!captureRes.ok) {
      return {
        ok: false,
        status: 502,
        error: `Payment was authorized but capture failed: ${captureRes.error}`,
      };
    }
    payment = captureRes.data;
    capturedNow = true;
  }

  if (payment.status !== 'captured') {
    const statusLabel = payment.status || 'unknown';
    return {
      ok: false,
      status: 409,
      error:
        statusLabel === 'refunded'
          ? 'This payment has already been refunded.'
          : statusLabel === 'failed'
            ? payment.error_description || 'This Razorpay payment failed.'
            : `Payment is currently in '${statusLabel}' state and has not been captured yet.`,
    };
  }

  // 5. Reconstruct authoritative items ONLY from cryptographically signed server proof
  let authoritativeLines: OrderBindingLine[] | null = null;

  if (orderToken) {
    const tokenCheck = verifyOrderBindingToken(
      orderToken,
      { orderId: order.id, uid },
      config.keySecret
    );
    if (
      tokenCheck.valid &&
      tokenCheck.payload &&
      tokenCheck.payload.amountSubunits === order.amount &&
      tokenCheck.payload.currency.toUpperCase() === orderCurrency
    ) {
      authoritativeLines = [...tokenCheck.payload.items];
    }
  }

  if (!authoritativeLines) {
    const manifest = unpackManifestFromNotes(orderNotes);
    const manifestSig =
      typeof orderNotes.manifest_sig === 'string' ? orderNotes.manifest_sig.trim() : '';

    const isManifestValid = verifyOrderManifest(
      {
        uid,
        currency: orderCurrency,
        amountSubunits: order.amount,
        manifest,
        signature: manifestSig,
      },
      config.keySecret
    );

    if (!isManifestValid) {
      return {
        ok: false,
        status: 403,
        error: 'Order manifest integrity verification failed. Please contact support with your Order ID.',
      };
    }

    const parsedManifestItems = parseOrderItemsManifest(manifest);
    if (parsedManifestItems.length === 0) {
      return {
        ok: false,
        status: 400,
        error: 'Verified order did not contain any valid catalog items.',
      };
    }

    authoritativeLines = parsedManifestItems.map((item) => ({
      itemId: item.itemId,
      contentType: item.contentType,
      quantity: 1,
      unitPriceSubunits: -1, // Resolved from live catalog below
    }));
  }

  // 6. Hydrate catalog metadata & mint signed entitlement proofs
  const [books, exams] = await Promise.all([fetchPublishedBooks(), fetchPublishedExams()]);
  const bookMap = new Map(books.map((b) => [b.id, b]));
  const examMap = new Map(exams.map((e) => [e.id, e]));
  const purchasedAtIso =
    typeof payment.created_at === 'number' && payment.created_at > 0
      ? new Date(payment.created_at * 1000).toISOString()
      : new Date().toISOString();

  const purchases: PurchasedItem[] = [];
  for (const line of authoritativeLines) {
    const catalogItem =
      line.contentType === 'books' ? bookMap.get(line.itemId) : examMap.get(line.itemId);
    if (!catalogItem) continue;

    const unitMajor =
      line.unitPriceSubunits >= 0
        ? line.unitPriceSubunits / 100
        : catalogItem.buyPrice;

    const entitlementProof = signEntitlementProof(
      {
        uid,
        itemId: catalogItem.id,
        contentType: line.contentType,
        orderId: order.id,
        paymentId: payment.id,
      },
      config.keySecret
    );

    purchases.push({
      id: makePurchaseDocId(line.contentType, catalogItem.id),
      itemId: catalogItem.id,
      contentType: line.contentType,
      title: catalogItem.title,
      urlSlug: catalogItem.urlSlug,
      currency: orderCurrency,
      amountPaid: Number((unitMajor * Math.max(1, line.quantity)).toFixed(2)),
      razorpayOrderId: order.id,
      razorpayPaymentId: payment.id,
      entitlementProof,
      status: 'completed',
      purchasedAt: purchasedAtIso,
    });
  }

  if (purchases.length === 0) {
    return {
      ok: false,
      status: 404,
      error: 'None of the items in this order are currently available in the catalog.',
    };
  }

  // Safety sanity check when unit prices were hydrated from catalog during stateless recovery
  const usedCatalogPrices = authoritativeLines.every((l) => l.unitPriceSubunits < 0);
  if (usedCatalogPrices && purchases.length === 1) {
    const single = purchases[0];
    if (toSubunits(single.amountPaid) !== order.amount) {
      // Preserve exact paid amount on the receipt even if catalog price changed later
      purchases[0] = {
        ...single,
        amountPaid: Number((order.amount / 100).toFixed(2)),
      };
    }
  }

  return {
    ok: true,
    orderId: order.id,
    paymentId: payment.id,
    paymentMethod: payment.method ?? null,
    amountPaidSubunits: payment.amount,
    currency: orderCurrency,
    capturedNow,
    purchases,
  };
}
