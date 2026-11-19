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

interface RazorpayHandlerResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
  };
  theme?: {
    color?: string;
  };
  handler: (response: RazorpayHandlerResponse) => void;
  modal?: {
    ondismiss?: () => void;
  };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, callback: (resp: { error?: { description?: string } }) => void) => void;
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
          quantity: item.quantity,
        })),
      }),
    });

    const orderPayload = (await orderRes.json().catch(() => ({}))) as {
      orderId?: string;
      amount?: number;
      currency?: string;
      keyId?: string;
      error?: string;
    };

    if (!orderRes.ok || !orderPayload.orderId || !orderPayload.keyId) {
      throw new Error(orderPayload.error || 'Could not initiate Razorpay order.');
    }

    // Step 2: Load Razorpay Checkout JS SDK
    await loadRazorpayScript();
    if (!window.Razorpay) {
      throw new Error('Razorpay checkout unavailable.');
    }

    const description =
      ctx.items.length === 1
        ? ctx.items[0].title.slice(0, 120)
        : `${ctx.items.length} study materials on ExamDash`;

    // Step 3: Launch Razorpay modal and await verified capture
    const paymentResponse = await new Promise<RazorpayHandlerResponse | null>((resolve, reject) => {
      const RazorpayCtor = window.Razorpay!;
      let settled = false;

      const rzp = new RazorpayCtor({
        key: orderPayload.keyId!,
        amount: orderPayload.amount ?? 0,
        currency: orderPayload.currency ?? 'INR',
        name: 'ExamDash (ed)',
        description,
        order_id: orderPayload.orderId!,
        prefill: {
          name: ctx.user.displayName ?? undefined,
          email: ctx.user.email ?? undefined,
        },
        theme: {
          color: '#0f172a',
        },
        handler: (response: RazorpayHandlerResponse) => {
          settled = true;
          resolve(response);
        },
        modal: {
          ondismiss: () => {
            if (!settled) {
              settled = true;
              resolve(null);
            }
          },
        },
      });

      rzp.on('payment.failed', (failure) => {
        if (!settled) {
          settled = true;
          reject(new Error(failure.error?.description || 'Razorpay payment failed.'));
        }
      });

      rzp.open();
    });

    if (!paymentResponse) {
      return { status: 'cancelled' };
    }

    // Step 4: Server-side HMAC-SHA256 verification + signed entitlement issuance
    const verifyRes = await fetch('/api/razorpay/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        razorpay_order_id: paymentResponse.razorpay_order_id,
        razorpay_payment_id: paymentResponse.razorpay_payment_id,
        razorpay_signature: paymentResponse.razorpay_signature,
        items: ctx.items.map((item) => ({
          itemId: item.itemId,
          contentType: item.contentType,
          quantity: item.quantity,
        })),
      }),
    });

    const verifyPayload = (await verifyRes.json().catch(() => ({}))) as {
      verified?: boolean;
      purchases?: PurchasedItem[];
      error?: string;
    };

    if (!verifyRes.ok || !verifyPayload.verified || !Array.isArray(verifyPayload.purchases)) {
      throw new Error(verifyPayload.error || 'Payment verification failed on server.');
    }

    return {
      status: 'success',
      orderId: paymentResponse.razorpay_order_id,
      paymentId: paymentResponse.razorpay_payment_id,
      purchases: verifyPayload.purchases,
    };
  },
};
