import type { RazorpayServerConfig } from './razorpay';

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface RazorpayApiErrorPayload {
  readonly code?: string;
  readonly description?: string;
  readonly source?: string;
  readonly step?: string;
  readonly reason?: string;
}

export interface RazorpayOrderEntity {
  readonly id: string;
  readonly entity: 'order';
  readonly amount: number;
  readonly amount_paid: number;
  readonly amount_due: number;
  readonly currency: string;
  readonly receipt: string | null;
  readonly status: 'created' | 'attempted' | 'paid' | string;
  readonly attempts: number;
  readonly notes: Record<string, string | number | boolean | null | undefined>;
  readonly created_at: number;
}

export interface RazorpayPaymentEntity {
  readonly id: string;
  readonly entity: 'payment';
  readonly amount: number;
  readonly currency: string;
  readonly status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed' | string;
  readonly order_id: string | null;
  readonly method: string | null;
  readonly captured: boolean;
  readonly email: string | null;
  readonly contact: string | null;
  readonly error_code: string | null;
  readonly error_description: string | null;
  readonly notes: Record<string, string | number | boolean | null | undefined>;
  readonly created_at: number;
}

export interface RazorpayOrderPaymentsList {
  readonly entity: 'collection';
  readonly count: number;
  readonly items: readonly RazorpayPaymentEntity[];
}

export type RazorpayApiResult<T> =
  | { readonly ok: true; readonly status: number; readonly data: T }
  | {
      readonly ok: false;
      readonly status: number;
      readonly error: string;
      readonly code?: string;
    };

function buildBasicAuthHeader(config: Pick<RazorpayServerConfig, 'keyId' | 'keySecret'>): string {
  return `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`, 'utf8').toString('base64')}`;
}

async function razorpayRequest<T>(
  config: Pick<RazorpayServerConfig, 'keyId' | 'keySecret'>,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<RazorpayApiResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${RAZORPAY_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: buildBasicAuthHeader(config),
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    const json = (await response.json().catch(() => null)) as
      | (T & { error?: RazorpayApiErrorPayload })
      | { error?: RazorpayApiErrorPayload }
      | null;

    if (!response.ok || !json) {
      const apiErr = json && typeof json === 'object' && 'error' in json ? json.error : undefined;
      return {
        ok: false,
        status: response.status,
        code: apiErr?.code,
        error:
          apiErr?.description ||
          `Razorpay API request failed (${method} ${path} -> HTTP ${response.status}).`,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: json as T,
    };
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      status: isAbort ? 504 : 502,
      error: isAbort
        ? 'Razorpay payment gateway timed out. Please try again.'
        : err instanceof Error
          ? err.message
          : 'Unable to communicate with Razorpay API.',
    };
  }
}

export async function createRazorpayOrder(
  config: Pick<RazorpayServerConfig, 'keyId' | 'keySecret'>,
  payload: {
    readonly amount: number;
    readonly currency: string;
    readonly receipt: string;
    readonly notes: Record<string, string>;
  }
): Promise<RazorpayApiResult<RazorpayOrderEntity>> {
  return razorpayRequest<RazorpayOrderEntity>(config, 'POST', '/orders', {
    amount: payload.amount,
    currency: payload.currency,
    receipt: payload.receipt,
    notes: payload.notes,
  });
}

export async function fetchRazorpayOrder(
  config: Pick<RazorpayServerConfig, 'keyId' | 'keySecret'>,
  orderId: string
): Promise<RazorpayApiResult<RazorpayOrderEntity>> {
  return razorpayRequest<RazorpayOrderEntity>(
    config,
    'GET',
    `/orders/${encodeURIComponent(orderId)}`
  );
}

export async function fetchRazorpayPayment(
  config: Pick<RazorpayServerConfig, 'keyId' | 'keySecret'>,
  paymentId: string
): Promise<RazorpayApiResult<RazorpayPaymentEntity>> {
  return razorpayRequest<RazorpayPaymentEntity>(
    config,
    'GET',
    `/payments/${encodeURIComponent(paymentId)}`
  );
}

export async function fetchRazorpayOrderPayments(
  config: Pick<RazorpayServerConfig, 'keyId' | 'keySecret'>,
  orderId: string
): Promise<RazorpayApiResult<RazorpayOrderPaymentsList>> {
  return razorpayRequest<RazorpayOrderPaymentsList>(
    config,
    'GET',
    `/orders/${encodeURIComponent(orderId)}/payments`
  );
}

export async function captureRazorpayPayment(
  config: Pick<RazorpayServerConfig, 'keyId' | 'keySecret'>,
  paymentId: string,
  amountSubunits: number,
  currency: string
): Promise<RazorpayApiResult<RazorpayPaymentEntity>> {
  return razorpayRequest<RazorpayPaymentEntity>(
    config,
    'POST',
    `/payments/${encodeURIComponent(paymentId)}/capture`,
    {
      amount: amountSubunits,
      currency: currency.toUpperCase(),
    }
  );
}
