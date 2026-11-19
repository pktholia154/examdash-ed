'use client';

import type { PurchasedItem } from '@/lib/design-system/types';

/**
 * Hexagonal Platform Adapter Layer
 * Swap Web implementations for Capacitor plugins (@capacitor/filesystem, @capacitor/preferences,
 * @capacitor/status-bar, @capacitor/browser, IAP / Play Billing) without modifying reader UI.
 */

export interface OfflineStorageAdapter {
  saveBinary(key: string, data: ArrayBuffer): Promise<void>;
  readBinary(key: string): Promise<ArrayBuffer | null>;
  deleteBinary(key: string): Promise<void>;
  hasBinary(key: string): Promise<boolean>;
  saveText(key: string, content: string): Promise<void>;
  readText(key: string): Promise<string | null>;
  deleteText(key: string): Promise<void>;
  hasText(key: string): Promise<boolean>;
}

export interface PreferencesAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface FullscreenAdapter {
  isSupported(): boolean;
  isFullscreen(): boolean;
  enter(element: HTMLElement): Promise<void>;
  exit(): Promise<void>;
}

export interface ExternalLinkAdapter {
  openExternal(url: string): void;
}

export interface CheckoutItemRequest {
  readonly itemId: string;
  readonly contentType: 'books' | 'exams' | 'quizbooks';
  readonly quantity: number;
  readonly title: string;
}

export interface CheckoutContext {
  readonly items: readonly CheckoutItemRequest[];
  readonly user: {
    readonly uid: string;
    readonly email: string | null;
    readonly displayName: string | null;
    readonly getIdToken: () => Promise<string>;
  };
}

export interface CheckoutResult {
  readonly status: 'success' | 'cancelled';
  readonly orderId?: string;
  readonly paymentId?: string;
  readonly purchases?: readonly PurchasedItem[];
}

export interface CheckoutAdapter {
  checkout(ctx: CheckoutContext): Promise<CheckoutResult>;
}

// --- IndexedDB Helper (Fallback for Web OPFS and Primary for Markdown text) ---

const IDB_NAME = 'examdash_offline_vault_v1';
const IDB_STORE_BIN = 'binary_files';
const IDB_STORE_TEXT = 'text_files';

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_BIN)) {
        db.createObjectStore(IDB_STORE_BIN);
      }
      if (!db.objectStoreNames.contains(IDB_STORE_TEXT)) {
        db.createObjectStore(IDB_STORE_TEXT);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function idbPut<T>(storeName: string, key: string, value: T): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as T | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

function safeFileKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return null;
  }
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

/**
 * Web Offline Storage Adapter:
 * - Binary PDFs: Origin Private File System (OPFS) primary, IndexedDB fallback.
 * - Markdown text: IndexedDB store.
 */
export const webOfflineStorageAdapter: OfflineStorageAdapter = {
  async saveBinary(key: string, data: ArrayBuffer): Promise<void> {
    const safeKey = safeFileKey(key);
    const root = await getOpfsRoot();
    if (root) {
      try {
        const handle = await root.getFileHandle(safeKey, { create: true });
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        return;
      } catch {
        // Fall through to IndexedDB
      }
    }
    await idbPut(IDB_STORE_BIN, safeKey, data);
  },

  async readBinary(key: string): Promise<ArrayBuffer | null> {
    const safeKey = safeFileKey(key);
    const root = await getOpfsRoot();
    if (root) {
      try {
        const handle = await root.getFileHandle(safeKey);
        const file = await handle.getFile();
        return await file.arrayBuffer();
      } catch {
        // Check IndexedDB fallback
      }
    }
    try {
      return await idbGet<ArrayBuffer>(IDB_STORE_BIN, safeKey);
    } catch {
      return null;
    }
  },

  async deleteBinary(key: string): Promise<void> {
    const safeKey = safeFileKey(key);
    const root = await getOpfsRoot();
    if (root) {
      try {
        await root.removeEntry(safeKey);
      } catch {
        // Ignore missing entry
      }
    }
    try {
      await idbDelete(IDB_STORE_BIN, safeKey);
    } catch {
      // Ignore
    }
  },

  async hasBinary(key: string): Promise<boolean> {
    const safeKey = safeFileKey(key);
    const root = await getOpfsRoot();
    if (root) {
      try {
        await root.getFileHandle(safeKey);
        return true;
      } catch {
        // Check IndexedDB fallback
      }
    }
    try {
      const existing = await idbGet<ArrayBuffer>(IDB_STORE_BIN, safeKey);
      return existing !== null;
    } catch {
      return false;
    }
  },

  async saveText(key: string, content: string): Promise<void> {
    await idbPut(IDB_STORE_TEXT, safeFileKey(key), content);
  },

  async readText(key: string): Promise<string | null> {
    try {
      return await idbGet<string>(IDB_STORE_TEXT, safeFileKey(key));
    } catch {
      return null;
    }
  },

  async deleteText(key: string): Promise<void> {
    try {
      await idbDelete(IDB_STORE_TEXT, safeFileKey(key));
    } catch {
      // Ignore
    }
  },

  async hasText(key: string): Promise<boolean> {
    try {
      const content = await idbGet<string>(IDB_STORE_TEXT, safeFileKey(key));
      return typeof content === 'string';
    } catch {
      return false;
    }
  },
};

export const webPreferencesAdapter: PreferencesAdapter = {
  get(key: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Ignore storage quota errors
    }
  },
  remove(key: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore
    }
  },
};

export const webFullscreenAdapter: FullscreenAdapter = {
  isSupported(): boolean {
    if (typeof document === 'undefined') return false;
    return Boolean(document.fullscreenEnabled);
  },
  isFullscreen(): boolean {
    if (typeof document === 'undefined') return false;
    return Boolean(document.fullscreenElement);
  },
  async enter(element: HTMLElement): Promise<void> {
    if (element.requestFullscreen) {
      await element.requestFullscreen();
    }
  },
  async exit(): Promise<void> {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  },
};

export const webExternalLinkAdapter: ExternalLinkAdapter = {
  openExternal(url: string): void {
    if (typeof document === 'undefined') return;
    // Use anchor click with rel=noopener noreferrer to avoid blocked popups in iframes
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
};

// --- Razorpay Web Checkout Adapter ---

export interface PendingRazorpayOrder {
  readonly orderId: string;
  readonly uid: string;
  readonly amountSubunits: number;
  readonly currency: string;
  readonly orderToken: string;
  readonly itemTitles: readonly string[];
  readonly createdAt: string;
}

export interface ReconcileOrderResult {
  readonly status: 'completed' | 'pending' | 'failed' | 'refunded';
  readonly orderId: string;
  readonly paymentId?: string;
  readonly message?: string;
  readonly purchases?: readonly PurchasedItem[];
}

const PENDING_ORDER_STORAGE_KEY = 'examdash_pending_rzp_order_v1';
const PENDING_ORDER_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

export function savePendingRazorpayOrder(order: PendingRazorpayOrder): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PENDING_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Ignore storage quota errors
  }
}

export function readPendingRazorpayOrder(uid: string): PendingRazorpayOrder | null {
  if (typeof window === 'undefined' || !uid) return null;
  try {
    const raw = window.localStorage.getItem(PENDING_ORDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingRazorpayOrder>;
    if (
      typeof parsed.orderId !== 'string' ||
      typeof parsed.uid !== 'string' ||
      parsed.uid !== uid ||
      typeof parsed.createdAt !== 'string'
    ) {
      return null;
    }
    const ageMs = Date.now() - Date.parse(parsed.createdAt);
    if (!Number.isFinite(ageMs) || ageMs > PENDING_ORDER_MAX_AGE_MS) {
      window.localStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
      return null;
    }
    return {
      orderId: parsed.orderId,
      uid: parsed.uid,
      amountSubunits: typeof parsed.amountSubunits === 'number' ? parsed.amountSubunits : 0,
      currency: typeof parsed.currency === 'string' ? parsed.currency : 'INR',
      orderToken: typeof parsed.orderToken === 'string' ? parsed.orderToken : '',
      itemTitles: Array.isArray(parsed.itemTitles)
        ? parsed.itemTitles.filter((t): t is string => typeof t === 'string')
        : [],
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

export function clearPendingRazorpayOrder(orderId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (!orderId) {
      window.localStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
      return;
    }
    const raw = window.localStorage.getItem(PENDING_ORDER_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { orderId?: string };
    if (parsed.orderId === orderId) {
      window.localStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

interface RazorpayHandlerResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayFailureEvent {
  error?: {
    code?: string;
    description?: string;
    source?: string;
    step?: string;
    reason?: string;
  };
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  image?: string;
  order_id: string;
  timeout?: number;
  retry?: {
    enabled: boolean;
    max_count: number;
  };
  notes?: Record<string, string>;
  prefill?: {
    name?: string;
    email?: string;
  };
  theme?: {
    color?: string;
  };
  handler: (response: RazorpayHandlerResponse) => void;
  modal?: {
    confirm_close?: boolean;
    escape?: boolean;
    backdropclose?: boolean;
    ondismiss?: () => void;
  };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, callback: (resp: RazorpayFailureEvent) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let razorpayScriptPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay checkout requires a browser environment.'));
  }
  if (window.Razorpay) {
    return Promise.resolve();
  }
  if (razorpayScriptPromise) {
    return razorpayScriptPromise;
  }
  razorpayScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => {
          razorpayScriptPromise = null;
          reject(new Error('Failed to load Razorpay Checkout SDK. Please check your connection.'));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      razorpayScriptPromise = null;
      reject(new Error('Failed to load Razorpay Checkout SDK. Please check your connection.'));
    };
    document.head.appendChild(script);
  });
  return razorpayScriptPromise;
}

export async function reconcileRazorpayOrder(params: {
  readonly orderId: string;
  readonly orderToken?: string;
  readonly getIdToken: () => Promise<string>;
}): Promise<ReconcileOrderResult> {
  const idToken = await params.getIdToken();
  const res = await fetch('/api/razorpay/reconcile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      razorpay_order_id: params.orderId.trim(),
      orderToken: params.orderToken || undefined,
    }),
    cache: 'no-store',
  });

  const payload = (await res.json().catch(() => ({}))) as {
    status?: 'completed' | 'pending' | 'failed' | 'refunded';
    verified?: boolean;
    orderId?: string;
    paymentId?: string;
    purchases?: PurchasedItem[];
    message?: string;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(payload.error || 'Could not check Razorpay order status.');
  }

  if (payload.status === 'completed' && payload.verified && Array.isArray(payload.purchases)) {
    clearPendingRazorpayOrder(params.orderId);
    return {
      status: 'completed',
      orderId: payload.orderId || params.orderId,
      paymentId: payload.paymentId,
      purchases: payload.purchases,
    };
  }

  if (payload.status === 'failed' || payload.status === 'refunded') {
    clearPendingRazorpayOrder(params.orderId);
  }

  return {
    status: payload.status ?? 'pending',
    orderId: payload.orderId || params.orderId,
    paymentId: payload.paymentId,
    message: payload.message,
  };
}

export const razorpayWebCheckoutAdapter: CheckoutAdapter = {
  async checkout(ctx: CheckoutContext): Promise<CheckoutResult> {
    const idToken = await ctx.user.getIdToken();

    // Step 1: Create authoritative Razorpay order server-side
    const orderRes = await fetch('/api/razorpay/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        items: ctx.items.map((item) => ({
          itemId: item.itemId,
          contentType: item.contentType,
          quantity: 1,
        })),
      }),
      cache: 'no-store',
    });

    const orderPayload = (await orderRes.json().catch(() => ({}))) as {
      orderId?: string;
      amount?: number;
      currency?: string;
      keyId?: string;
      orderToken?: string;
      error?: string;
    };

    if (!orderRes.ok || !orderPayload.orderId || !orderPayload.keyId) {
      throw new Error(orderPayload.error || 'Could not initiate Razorpay order.');
    }

    const createdOrderId = orderPayload.orderId;
    const createdOrderToken = orderPayload.orderToken ?? '';

    // Persist pending order BEFORE opening Razorpay modal so interrupted UPI/3DS flows can recover
    savePendingRazorpayOrder({
      orderId: createdOrderId,
      uid: ctx.user.uid,
      amountSubunits: orderPayload.amount ?? 0,
      currency: orderPayload.currency ?? 'INR',
      orderToken: createdOrderToken,
      itemTitles: ctx.items.map((i) => i.title),
      createdAt: new Date().toISOString(),
    });

    // Step 2: Load Razorpay Checkout JS SDK
    await loadRazorpayScript();
    if (!window.Razorpay) {
      throw new Error('Razorpay checkout unavailable.');
    }

    const description =
      ctx.items.length === 1
        ? ctx.items[0].title.slice(0, 120)
        : `${ctx.items.length} study materials on Exam Kart`;

    const logoUrl =
      typeof window !== 'undefined' ? `${window.location.origin}/pwa-192x192.png` : undefined;

    // Step 3: Launch Razorpay modal and await verified capture.
    // IMPORTANT: Do NOT settle/reject on `payment.failed` while the modal remains open,
    // because Razorpay allows in-modal retries (e.g., switching from Card to UPI).
    // Record the last failure and surface it only if the user dismisses without succeeding.
    const paymentResponse = await new Promise<RazorpayHandlerResponse | null>((resolve, reject) => {
      const RazorpayCtor = window.Razorpay!;
      let settled = false;
      let lastFailureMessage: string | null = null;

      const rzp = new RazorpayCtor({
        key: orderPayload.keyId!,
        amount: orderPayload.amount ?? 0,
        currency: orderPayload.currency ?? 'INR',
        name: 'Exam Kart · ExamDash',
        description,
        image: logoUrl,
        order_id: createdOrderId,
        timeout: 600,
        retry: {
          enabled: true,
          max_count: 3,
        },
        notes: {
          uid: ctx.user.uid,
          platform: 'exam-dash.com',
        },
        prefill: {
          name: ctx.user.displayName ?? undefined,
          email: ctx.user.email ?? undefined,
        },
        theme: {
          color: '#0f172a',
        },
        handler: (response: RazorpayHandlerResponse) => {
          if (!settled) {
            settled = true;
            resolve(response);
          }
        },
        modal: {
          confirm_close: true,
          escape: true,
          backdropclose: false,
          ondismiss: () => {
            if (!settled) {
              settled = true;
              if (lastFailureMessage) {
                reject(new Error(lastFailureMessage));
              } else {
                resolve(null);
              }
            }
          },
        },
      });

      rzp.on('payment.failed', (failure) => {
        const desc = failure.error?.description?.trim();
        const reason = failure.error?.reason?.trim();
        lastFailureMessage = desc
          ? reason && !desc.toLowerCase().includes(reason.toLowerCase())
            ? `${desc} (${reason})`
            : desc
          : 'Razorpay payment failed. If money was debited, use Verify Pending Order.';
      });

      rzp.open();
    });

    if (!paymentResponse) {
      // User dismissed without completing; keep pending order only briefly if they want to double-check,
      // or check once quietly on user demand. Clearing on clean cancel avoids nagging when they just closed the popup.
      clearPendingRazorpayOrder(createdOrderId);
      return { status: 'cancelled' };
    }

    // Step 4: Refresh auth token right before verification (3DS/UPI flows can take several minutes)
    const freshToken = await ctx.user.getIdToken();

    try {
      const verifyRes = await fetch('/api/razorpay/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${freshToken}`,
        },
        body: JSON.stringify({
          razorpay_order_id: paymentResponse.razorpay_order_id,
          razorpay_payment_id: paymentResponse.razorpay_payment_id,
          razorpay_signature: paymentResponse.razorpay_signature,
          orderToken: createdOrderToken || undefined,
          items: ctx.items.map((item) => ({
            itemId: item.itemId,
            contentType: item.contentType,
            quantity: 1,
          })),
        }),
        cache: 'no-store',
      });

      const verifyPayload = (await verifyRes.json().catch(() => ({}))) as {
        verified?: boolean;
        purchases?: PurchasedItem[];
        error?: string;
      };

      if (verifyRes.ok && verifyPayload.verified && Array.isArray(verifyPayload.purchases)) {
        clearPendingRazorpayOrder(createdOrderId);
        return {
          status: 'success',
          orderId: paymentResponse.razorpay_order_id,
          paymentId: paymentResponse.razorpay_payment_id,
          purchases: verifyPayload.purchases,
        };
      }

      // If verification encountered a transient gateway/server error (5xx), attempt automatic reconcile once
      if (verifyRes.status >= 500) {
        const reconciled = await reconcileRazorpayOrder({
          orderId: paymentResponse.razorpay_order_id,
          orderToken: createdOrderToken || undefined,
          getIdToken: () => ctx.user.getIdToken(),
        });
        if (reconciled.status === 'completed' && reconciled.purchases) {
          return {
            status: 'success',
            orderId: reconciled.orderId,
            paymentId: reconciled.paymentId ?? paymentResponse.razorpay_payment_id,
            purchases: reconciled.purchases,
          };
        }
      }

      throw new Error(
        verifyPayload.error ||
          `Payment verification could not complete right now. Save your Order ID (${paymentResponse.razorpay_order_id}) and tap "Verify Pending Order".`
      );
    } catch (verifyErr) {
      // Last-chance automatic reconcile if network dropped right after Razorpay modal callback
      try {
        const reconciled = await reconcileRazorpayOrder({
          orderId: paymentResponse.razorpay_order_id,
          orderToken: createdOrderToken || undefined,
          getIdToken: () => ctx.user.getIdToken(),
        });
        if (reconciled.status === 'completed' && reconciled.purchases) {
          return {
            status: 'success',
            orderId: reconciled.orderId,
            paymentId: reconciled.paymentId ?? paymentResponse.razorpay_payment_id,
            purchases: reconciled.purchases,
          };
        }
      } catch {
        // Fall through to original error while keeping pendingOrder saved for manual retry
      }
      throw verifyErr;
    }
  },
};

