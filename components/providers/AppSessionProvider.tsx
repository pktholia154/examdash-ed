'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CheckoutItemRequest,
  PendingRazorpayOrder,
  ReconcileOrderResult,
} from '@/core/adapters/platform';
import type {
  CartItem,
  PublicCatalogBaseDTO,
  PurchasedItem,
  ReadingProgressRecord,
  UserAnalyticsSummary,
} from '@/lib/design-system/types';
import { computeCartTotals, type CartTotals } from '@/lib/design-system/formatters';
import type { ExamAttemptSummary } from '@/core/exam/engine';
import type { FirebaseAuthUser } from '@/lib/firebase/session-sync';

const LOCAL_CART_KEY = 'examdash_cart_v1';
const LOCAL_PURCHASES_PREFIX = 'examdash_purchases_v1_';
const LOCAL_PROGRESS_PREFIX = 'examdash_progress_v1_';
const LOCAL_FB_AUTH_HINT_KEY = 'examdash_fb_auth_hint_v1';

export interface OrderReceiptSummary {
  readonly orderId: string;
  readonly paymentId: string;
  readonly itemCount: number;
  readonly completedAt: string;
}

export interface SessionUser {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly photoURL: string | null;
  readonly authProvider: 'firebase-google' | 'reviewer-test';
  readonly getIdToken: () => Promise<string>;
}

interface ReviewerSessionState {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string;
  readonly token: string;
}

export interface ReviewerSignInResult {
  readonly ok: boolean;
  readonly error?: string;
}

interface AppSessionContextValue {
  user: SessionUser | null;
  authReady: boolean;
  authBusy: boolean;
  authError: string | null;
  analytics: UserAnalyticsSummary | null;
  cartItems: readonly CartItem[];
  cartTotals: CartTotals;
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  purchasedItems: readonly PurchasedItem[];
  purchasesLoading: boolean;
  readingProgressMap: Readonly<Record<string, ReadingProgressRecord>>;
  checkoutBusy: boolean;
  checkoutError: string | null;
  clearCheckoutError: () => void;
  lastOrderReceipt: OrderReceiptSummary | null;
  pendingOrder: PendingRazorpayOrder | null;
  reconcileBusy: boolean;
  reconcileMessage: string | null;
  clearReconcileMessage: () => void;
  signIn: () => Promise<SessionUser | null>;
  signInWithReviewerCredentials: (identifier: string, password: string) => Promise<ReviewerSignInResult>;
  signOut: () => Promise<void>;
  addToCart: (item: PublicCatalogBaseDTO) => Promise<void>;
  removeFromCart: (cartItemId: string) => Promise<void>;
  updateCartQuantity: (cartItemId: string, quantity: number) => Promise<void>;
  clearCart: () => Promise<void>;
  isInCart: (contentType: string, itemId: string) => boolean;
  isPurchased: (contentType: string, itemId: string) => boolean;
  getPurchase: (contentType: string, itemId: string) => PurchasedItem | null;
  checkoutCart: () => Promise<OrderReceiptSummary | null>;
  buyItemNow: (item: PublicCatalogBaseDTO) => Promise<OrderReceiptSummary | null>;
  reconcileOrder: (orderId?: string) => Promise<ReconcileOrderResult | null>;
  dismissPendingOrder: () => void;
  saveReadingProgress: (record: Omit<ReadingProgressRecord, 'id' | 'updatedAt'>) => Promise<void>;
  getReadingProgress: (bookId: string, format: 'pdf' | 'markdown') => ReadingProgressRecord | null;
}

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

type FirebaseSyncModule = typeof import('@/lib/firebase/session-sync');
type PlatformAdapterModule = typeof import('@/core/adapters/platform');

let firebaseSyncPromise: Promise<FirebaseSyncModule> | null = null;
let platformAdapterPromise: Promise<PlatformAdapterModule> | null = null;

function loadFirebaseSync(): Promise<FirebaseSyncModule> {
  if (!firebaseSyncPromise) {
    firebaseSyncPromise = import('@/lib/firebase/session-sync');
  }
  return firebaseSyncPromise;
}

function loadPlatformAdapter(): Promise<PlatformAdapterModule> {
  if (!platformAdapterPromise) {
    platformAdapterPromise = import('@/core/adapters/platform');
  }
  return platformAdapterPromise;
}

function makeItemDocId(contentType: string, itemId: string): string {
  return `${contentType}_${itemId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

function makeProgressDocId(bookId: string, format: 'pdf' | 'markdown'): string {
  return `${bookId}_${format}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

function readLocalCart(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is CartItem =>
        typeof x === 'object' &&
        x !== null &&
        typeof x.id === 'string' &&
        typeof x.itemId === 'string' &&
        typeof x.title === 'string' &&
        typeof x.buyPrice === 'number'
    );
  } catch {
    return [];
  }
}

function writeLocalCart(items: readonly CartItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_CART_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

function readLocalPurchases(uid: string): PurchasedItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${LOCAL_PURCHASES_PREFIX}${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is PurchasedItem =>
        typeof x === 'object' &&
        x !== null &&
        typeof x.id === 'string' &&
        typeof x.itemId === 'string' &&
        typeof x.entitlementProof === 'string'
    );
  } catch {
    return [];
  }
}

function writeLocalPurchases(uid: string, items: readonly PurchasedItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${LOCAL_PURCHASES_PREFIX}${uid}`, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

function readLocalProgressMap(uidOrGuest: string): Record<string, ReadingProgressRecord> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(`${LOCAL_PROGRESS_PREFIX}${uidOrGuest}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, ReadingProgressRecord>)
      : {};
  } catch {
    return {};
  }
}

function writeLocalProgressMap(
  uidOrGuest: string,
  map: Record<string, ReadingProgressRecord>
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${LOCAL_PROGRESS_PREFIX}${uidOrGuest}`, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

function mergePurchases(
  remote: readonly PurchasedItem[],
  local: readonly PurchasedItem[]
): PurchasedItem[] {
  const byId = new Map<string, PurchasedItem>();
  for (const item of local) byId.set(item.id, item);
  for (const item of remote) byId.set(item.id, item);
  return Array.from(byId.values()).sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
}

function hasReviewerHintCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((entry) => entry.trim() === 'ed_rs=1');
}

function readFirebaseAuthHint(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LOCAL_FB_AUTH_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function writeFirebaseAuthHint(active: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (active) {
      window.localStorage.setItem(LOCAL_FB_AUTH_HINT_KEY, '1');
    } else {
      window.localStorage.removeItem(LOCAL_FB_AUTH_HINT_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

function isAuthPriorityRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  return (
    path.startsWith('/purchased') ||
    path.startsWith('/login') ||
    path.startsWith('/signin') ||
    path.startsWith('/account')
  );
}

async function hasStoredFirebaseIndexedDb(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  const idbWithList = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>;
  };
  if (typeof idbWithList.databases !== 'function') return false;
  try {
    const dbs = await idbWithList.databases();
    return dbs.some((d) => d.name === 'firebaseLocalStorageDb');
  } catch {
    return false;
  }
}

function toFirebaseSessionUser(fbUser: FirebaseAuthUser): SessionUser {
  return {
    uid: fbUser.uid,
    email: fbUser.email,
    displayName: fbUser.displayName,
    photoURL: fbUser.photoURL,
    authProvider: 'firebase-google',
    getIdToken: () => fbUser.getIdToken(),
  };
}

export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseAuthUser | null>(null);
  const [reviewerSession, setReviewerSession] = useState<ReviewerSessionState | null>(null);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);
  const [reviewerHydrated, setReviewerHydrated] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<UserAnalyticsSummary | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [remoteWritable, setRemoteWritable] = useState(false);

  const [purchasedItems, setPurchasedItems] = useState<PurchasedItem[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [readingProgressMap, setReadingProgressMap] = useState<
    Record<string, ReadingProgressRecord>
  >({});
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [lastOrderReceipt, setLastOrderReceipt] = useState<OrderReceiptSummary | null>(null);
  const [pendingOrder, setPendingOrder] = useState<PendingRazorpayOrder | null>(null);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);
  const [examAttemptSummaries, setExamAttemptSummaries] = useState<ExamAttemptSummary[]>([]);
  const checkoutInFlightRef = useRef(false);
  const authUnsubRef = useRef<(() => void) | null>(null);

  const authReady = firebaseAuthReady && reviewerHydrated;

  const user = useMemo<SessionUser | null>(() => {
    if (firebaseUser) {
      return toFirebaseSessionUser(firebaseUser);
    }
    if (reviewerSession) {
      return {
        uid: reviewerSession.uid,
        email: reviewerSession.email,
        displayName: reviewerSession.displayName,
        photoURL: null,
        authProvider: 'reviewer-test',
        getIdToken: async () => reviewerSession.token,
      };
    }
    return null;
  }, [firebaseUser, reviewerSession]);

  const attachFirebaseAuthListener = useCallback(async () => {
    if (authUnsubRef.current) return;
    const syncMod = await loadFirebaseSync();
    if (authUnsubRef.current) return;
    authUnsubRef.current = syncMod.subscribeFirebaseAuthState((fbUser) => {
      setFirebaseUser(fbUser);
      setFirebaseAuthReady(true);
      if (fbUser) {
        writeFirebaseAuthHint(true);
      }
    });
  }, []);

  // Post-mount local guest cart/progress hydration + marketing param cleanup (zero network calls)
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setCartItems(readLocalCart());
      setReadingProgressMap(readLocalProgressMap('guest'));
    });

    const onStorage = (event: StorageEvent) => {
      if (event.key === LOCAL_CART_KEY) {
        setCartItems(readLocalCart());
      }
    };
    const refreshAttempts = () => {
      void import('@/core/exam/storage')
        .then((mod) => mod.loadAllExamAttemptSummaries())
        .then((list) => {
          if (active) setExamAttemptSummaries(list);
        })
        .catch(() => undefined);
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('examdash:attempt-updated', refreshAttempts);

    // Clean marketing attribution params post-mount without breaking browser history
    if (window.location.search) {
      const url = new URL(window.location.href);
      let mutated = false;
      for (const key of Array.from(url.searchParams.keys())) {
        if (key.startsWith('utm_') || key === 'gclid' || key === 'fbclid') {
          url.searchParams.delete(key);
          mutated = true;
        }
      }
      if (mutated) {
        const clean =
          url.pathname +
          (url.searchParams.toString() ? `?${url.searchParams.toString()}` : '') +
          url.hash;
        window.history.replaceState(window.history.state, '', clean);
      }
    }

    return () => {
      active = false;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('examdash:attempt-updated', refreshAttempts);
    };
  }, []);

  // Hydrate hidden reviewer session ONLY when the presence cookie hint is set
  useEffect(() => {
    let active = true;
    if (!hasReviewerHintCookie()) {
      void Promise.resolve().then(() => {
        if (active) setReviewerHydrated(true);
      });
      return () => {
        active = false;
      };
    }

    fetch('/api/auth/reviewer-session', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          payload: {
            authenticated?: boolean;
            user?: { uid?: string; email?: string; displayName?: string } | null;
            token?: string | null;
          } | null
        ) => {
          if (!active) return;
          if (
            payload?.authenticated &&
            payload.user?.uid &&
            payload.user?.email &&
            payload.token
          ) {
            setReviewerSession({
              uid: payload.user.uid,
              email: payload.user.email,
              displayName: payload.user.displayName || 'Razorpay Reviewer',
              token: payload.token,
            });
          } else {
            setReviewerSession(null);
          }
        }
      )
      .catch(() => {
        if (active) setReviewerSession(null);
      })
      .finally(() => {
        if (active) setReviewerHydrated(true);
      });

    return () => {
      active = false;
    };
  }, []);

  // Lazy-boot Firebase Auth SDK ONLY when a returning session hint exists or on auth-priority routes.
  // Public anonymous visitors & search crawlers download zero Firebase Auth/Firestore chunks.
  useEffect(() => {
    let active = true;

    async function maybeHydrateFirebaseAuth() {
      const shouldBootImmediately = readFirebaseAuthHint() || isAuthPriorityRoute();
      if (shouldBootImmediately) {
        await attachFirebaseAuthListener();
        return;
      }

      const hasExistingFbDb = await hasStoredFirebaseIndexedDb();
      if (!active) return;
      if (hasExistingFbDb) {
        await attachFirebaseAuthListener();
        return;
      }

      setFirebaseAuthReady(true);
    }

    void maybeHydrateFirebaseAuth();

    return () => {
      active = false;
      if (authUnsubRef.current) {
        authUnsubRef.current();
        authUnsubRef.current = null;
      }
    };
  }, [attachFirebaseAuthListener]);

  // Sync user analytics, cart, purchases, reading progress, and exam attempts once authenticated
  useEffect(() => {
    if (!authReady) return;

    if (!user) {
      let active = true;
      void Promise.resolve().then(() => {
        if (!active) return;
        setAnalytics(null);
        setRemoteWritable(false);
        setPurchasedItems([]);
        setPurchasesLoading(false);
        setPendingOrder(null);
        setCartItems(readLocalCart());
        setReadingProgressMap(readLocalProgressMap('guest'));
      });
      return () => {
        active = false;
      };
    }

    const currentUid = user.uid;
    let active = true;

    // Hydrate local exam attempts for signed-in analytics strip
    void import('@/core/exam/storage')
      .then((mod) => mod.loadAllExamAttemptSummaries())
      .then((list) => {
        if (active) setExamAttemptSummaries(list);
      })
      .catch(() => undefined);

    // Hydrate pending Razorpay order lazily
    void loadPlatformAdapter()
      .then((mod) => {
        if (active) setPendingOrder(mod.readPendingRazorpayOrder(currentUid));
      })
      .catch(() => undefined);

    // Reviewer test sessions persist cart/purchases/progress locally and authenticate server APIs directly
    if (user.authProvider !== 'firebase-google' || !firebaseUser) {
      void Promise.resolve().then(() => {
        if (!active) return;
        setPurchasedItems(readLocalPurchases(currentUid));
        setReadingProgressMap(readLocalProgressMap(currentUid));
        setAnalytics({
          testsAttempted: 0,
          booksOwned: 0,
          examsOwned: 0,
          averageAccuracy: 0,
          studyStreakDays: 0,
        });
        setRemoteWritable(false);
        setPurchasesLoading(false);
      });
      return () => {
        active = false;
      };
    }

    let stopRemoteSync: (() => void) | null = null;
    void loadFirebaseSync().then((syncMod) => {
      if (!active) return;
      stopRemoteSync = syncMod.startRemoteUserSync(firebaseUser, {
        readLocalPurchases,
        writeLocalPurchases,
        mergePurchases,
        readLocalProgressMap,
        writeLocalProgressMap,
        writeLocalCart,
        onAnalytics: setAnalytics,
        onRemoteWritable: setRemoteWritable,
        onCartItems: setCartItems,
        onPurchasedItems: setPurchasedItems,
        onPurchasesLoading: setPurchasesLoading,
        onReadingProgressMap: setReadingProgressMap,
      });
    });

    return () => {
      active = false;
      if (stopRemoteSync) stopRemoteSync();
    };
  }, [authReady, firebaseUser, user]);

  // Derived analytics synced cleanly with real owned counts and completed exam attempts
  const effectiveAnalytics = useMemo<UserAnalyticsSummary | null>(() => {
    if (!analytics) return null;
    const booksOwned = Math.max(
      analytics.booksOwned,
      purchasedItems.filter((p) => p.contentType === 'books').length
    );
    const examsOwned = Math.max(
      analytics.examsOwned,
      purchasedItems.filter((p) => p.contentType === 'exams').length
    );
    const submittedLocal = examAttemptSummaries.filter((s) => s.phase === 'submitted');
    const testsAttempted = Math.max(analytics.testsAttempted, submittedLocal.length);
    const localAvgAccuracy =
      submittedLocal.length > 0
        ? Math.round(
            submittedLocal.reduce((acc, s) => acc + (s.accuracy ?? 0), 0) / submittedLocal.length
          )
        : 0;
    const averageAccuracy =
      submittedLocal.length > 0 ? localAvgAccuracy : analytics.averageAccuracy;

    return {
      ...analytics,
      booksOwned,
      examsOwned,
      testsAttempted,
      averageAccuracy,
    };
  }, [analytics, examAttemptSummaries, purchasedItems]);

  const signIn = useCallback(async (): Promise<SessionUser | null> => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await attachFirebaseAuthListener();
      const syncMod = await loadFirebaseSync();
      const signedInUser = await syncMod.signInWithFirebaseGoogle();
      writeFirebaseAuthHint(true);
      setFirebaseUser(signedInUser);
      setFirebaseAuthReady(true);
      return toFirebaseSessionUser(signedInUser);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to complete Google sign-in.';
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError('Google sign-in could not be completed. Please allow popups and try again.');
      }
      return null;
    } finally {
      setAuthBusy(false);
    }
  }, [attachFirebaseAuthListener]);

  const signInWithReviewerCredentials = useCallback(
    async (identifier: string, password: string): Promise<ReviewerSignInResult> => {
      setAuthBusy(true);
      setAuthError(null);
      try {
        const res = await fetch('/api/auth/reviewer-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password }),
          cache: 'no-store',
        });

        const payload = (await res.json().catch(() => ({}))) as {
          authenticated?: boolean;
          user?: { uid?: string; email?: string; displayName?: string };
          token?: string;
          error?: string;
        };

        if (
          !res.ok ||
          !payload.authenticated ||
          !payload.user?.uid ||
          !payload.user?.email ||
          !payload.token
        ) {
          return {
            ok: false,
            error: payload.error || 'Invalid email or password.',
          };
        }

        setReviewerSession({
          uid: payload.user.uid,
          email: payload.user.email,
          displayName: payload.user.displayName || 'Razorpay Reviewer',
          token: payload.token,
        });
        setReviewerHydrated(true);
        return { ok: true };
      } catch {
        return {
          ok: false,
          error: 'Unable to reach sign-in service. Please try again.',
        };
      } finally {
        setAuthBusy(false);
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      if (reviewerSession || hasReviewerHintCookie()) {
        await fetch('/api/auth/reviewer-logout', { method: 'POST', cache: 'no-store' }).catch(
          () => undefined
        );
        setReviewerSession(null);
      }
      if (firebaseUser) {
        const syncMod = await loadFirebaseSync();
        await syncMod.signOutFirebaseUser();
        writeFirebaseAuthHint(false);
      }
    } catch {
      setAuthError('Could not sign out right now.');
    } finally {
      setAuthBusy(false);
    }
  }, [firebaseUser, reviewerSession]);

  const addToCart = useCallback(
    async (item: PublicCatalogBaseDTO) => {
      const cartId = makeItemDocId(item.contentType, item.id);

      const alreadyOwned = purchasedItems.some(
        (entry) =>
          entry.id === cartId ||
          (entry.contentType === item.contentType && entry.itemId === item.id)
      );
      if (alreadyOwned) return;

      const existingItem = cartItems.find((entry) => entry.id === cartId);
      if (existingItem) return;

      const updatedItem: CartItem = {
        id: cartId,
        itemId: item.id,
        contentType: item.contentType,
        title: item.title.slice(0, 240),
        urlSlug: item.urlSlug.slice(0, 240),
        currency: (item.currency || 'INR').slice(0, 8),
        buyPrice: Math.max(0, item.buyPrice),
        listPrice: Math.max(0, item.listPrice),
        quantity: 1,
      };

      const nextList = [updatedItem, ...cartItems];

      setCartItems(nextList);
      writeLocalCart(nextList);

      if (firebaseUser && remoteWritable) {
        const syncMod = await loadFirebaseSync();
        await syncMod.writeRemoteCartItem(firebaseUser, updatedItem);
      }
    },
    [cartItems, firebaseUser, purchasedItems, remoteWritable]
  );

  const removeFromCart = useCallback(
    async (cartItemId: string) => {
      const nextList = cartItems.filter((entry) => entry.id !== cartItemId);
      setCartItems(nextList);
      writeLocalCart(nextList);

      if (firebaseUser && remoteWritable) {
        const syncMod = await loadFirebaseSync();
        await syncMod.deleteRemoteCartItem(firebaseUser, cartItemId);
      }
    },
    [cartItems, firebaseUser, remoteWritable]
  );

  const updateCartQuantity = useCallback(
    async (cartItemId: string, quantity: number) => {
      if (quantity <= 0) {
        await removeFromCart(cartItemId);
        return;
      }
      const bounded = Math.max(1, Math.min(20, Math.floor(quantity)));
      const nextList = cartItems.map((entry) =>
        entry.id === cartItemId ? { ...entry, quantity: bounded } : entry
      );
      setCartItems(nextList);
      writeLocalCart(nextList);

      if (firebaseUser && remoteWritable) {
        const syncMod = await loadFirebaseSync();
        await syncMod.updateRemoteCartItemQuantity(firebaseUser, cartItemId, bounded);
      }
    },
    [cartItems, firebaseUser, removeFromCart, remoteWritable]
  );

  const clearCart = useCallback(async () => {
    const previous = [...cartItems];
    setCartItems([]);
    writeLocalCart([]);
    if (firebaseUser && remoteWritable) {
      const syncMod = await loadFirebaseSync();
      await syncMod.clearRemoteCartItems(firebaseUser, previous);
    }
  }, [cartItems, firebaseUser, remoteWritable]);

  const isInCart = useCallback(
    (contentType: string, itemId: string) => {
      const targetId = makeItemDocId(contentType, itemId);
      return cartItems.some((entry) => entry.id === targetId);
    },
    [cartItems]
  );

  const getPurchase = useCallback(
    (contentType: string, itemId: string): PurchasedItem | null => {
      const targetId = makeItemDocId(contentType, itemId);
      return (
        purchasedItems.find(
          (entry) =>
            entry.id === targetId ||
            (entry.contentType === contentType && entry.itemId === itemId)
        ) ?? null
      );
    },
    [purchasedItems]
  );

  const isPurchased = useCallback(
    (contentType: string, itemId: string) => getPurchase(contentType, itemId) !== null,
    [getPurchase]
  );

  const persistVerifiedPurchases = useCallback(
    async (activeUser: SessionUser, newPurchases: readonly PurchasedItem[]) => {
      const merged = mergePurchases(newPurchases, readLocalPurchases(activeUser.uid));
      setPurchasedItems(merged);
      writeLocalPurchases(activeUser.uid, merged);

      if (activeUser.authProvider !== 'firebase-google') {
        return;
      }

      const syncMod = await loadFirebaseSync();
      const liveFbUser = syncMod.getLiveFirebaseUser();
      if (!liveFbUser || liveFbUser.uid !== activeUser.uid) {
        return;
      }
      await syncMod.persistRemotePurchases(liveFbUser, newPurchases);
    },
    []
  );

  const runRazorpayCheckout = useCallback(
    async (
      itemsToBuy: readonly CheckoutItemRequest[],
      clearAfter: boolean
    ): Promise<OrderReceiptSummary | null> => {
      if (checkoutInFlightRef.current) return null;
      setCheckoutError(null);
      setReconcileMessage(null);

      let activeUser = user;
      if (!activeUser) {
        activeUser = await signIn();
        if (!activeUser) return null;
      }

      const unownedItems = itemsToBuy.filter(
        (item) => !isPurchased(item.contentType, item.itemId)
      );
      if (unownedItems.length === 0) {
        setCheckoutError('All selected items are already unlocked in your Purchased Library.');
        return null;
      }

      checkoutInFlightRef.current = true;
      setCheckoutBusy(true);
      try {
        const platform = await loadPlatformAdapter();
        const result = await platform.razorpayWebCheckoutAdapter.checkout({
          items: unownedItems,
          user: {
            uid: activeUser.uid,
            email: activeUser.email,
            displayName: activeUser.displayName,
            getIdToken: () => activeUser!.getIdToken(),
          },
        });

        setPendingOrder(platform.readPendingRazorpayOrder(activeUser.uid));

        if (result.status === 'cancelled' || !result.purchases || result.purchases.length === 0) {
          return null;
        }

        await persistVerifiedPurchases(activeUser, result.purchases);

        if (clearAfter) {
          await clearCart();
        } else {
          const boughtIds = new Set(result.purchases.map((p) => p.id));
          for (const id of boughtIds) {
            if (cartItems.some((c) => c.id === id)) {
              await removeFromCart(id);
            }
          }
        }

        const receipt: OrderReceiptSummary = {
          orderId: result.orderId ?? '',
          paymentId: result.paymentId ?? '',
          itemCount: result.purchases.length,
          completedAt: new Date().toISOString(),
        };
        setLastOrderReceipt(receipt);
        setPendingOrder(null);
        setCartOpen(false);
        return receipt;
      } catch (err) {
        if (activeUser) {
          const platform = await loadPlatformAdapter().catch(() => null);
          if (platform) setPendingOrder(platform.readPendingRazorpayOrder(activeUser.uid));
        }
        setCheckoutError(
          err instanceof Error ? err.message : 'Unable to complete Razorpay checkout.'
        );
        return null;
      } finally {
        checkoutInFlightRef.current = false;
        setCheckoutBusy(false);
      }
    },
    [cartItems, clearCart, isPurchased, persistVerifiedPurchases, removeFromCart, signIn, user]
  );

  const checkoutCart = useCallback(async () => {
    if (cartItems.length === 0) return null;
    const reqItems: CheckoutItemRequest[] = cartItems.map((c) => ({
      itemId: c.itemId,
      contentType: c.contentType,
      quantity: 1,
      title: c.title,
    }));
    return runRazorpayCheckout(reqItems, true);
  }, [cartItems, runRazorpayCheckout]);

  const buyItemNow = useCallback(
    async (item: PublicCatalogBaseDTO) => {
      if (isPurchased(item.contentType, item.id)) return null;
      return runRazorpayCheckout(
        [
          {
            itemId: item.id,
            contentType: item.contentType,
            quantity: 1,
            title: item.title,
          },
        ],
        false
      );
    },
    [isPurchased, runRazorpayCheckout]
  );

  const reconcileOrder = useCallback(
    async (explicitOrderId?: string): Promise<ReconcileOrderResult | null> => {
      const targetOrderId = (explicitOrderId ?? pendingOrder?.orderId ?? '').trim();
      if (!targetOrderId || !user) return null;

      setReconcileBusy(true);
      setReconcileMessage(null);
      setCheckoutError(null);
      try {
        const platform = await loadPlatformAdapter();
        const orderToken =
          pendingOrder && pendingOrder.orderId === targetOrderId
            ? pendingOrder.orderToken
            : undefined;

        const result = await platform.reconcileRazorpayOrder({
          orderId: targetOrderId,
          orderToken,
          getIdToken: () => user.getIdToken(),
        });

        setPendingOrder(platform.readPendingRazorpayOrder(user.uid));

        if (result.status === 'completed' && result.purchases && result.purchases.length > 0) {
          await persistVerifiedPurchases(user, result.purchases);
          const boughtIds = new Set(result.purchases.map((p) => p.id));
          for (const id of boughtIds) {
            if (cartItems.some((c) => c.id === id)) {
              await removeFromCart(id);
            }
          }
          setLastOrderReceipt({
            orderId: result.orderId,
            paymentId: result.paymentId ?? '',
            itemCount: result.purchases.length,
            completedAt: new Date().toISOString(),
          });
          setReconcileMessage(
            `Order ${result.orderId} verified and unlocked (${result.purchases.length} item${result.purchases.length === 1 ? '' : 's'}).`
          );
          return result;
        }

        setReconcileMessage(
          result.message || `Order ${result.orderId} is currently ${result.status}.`
        );
        return result;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Unable to verify Razorpay order right now.';
        setReconcileMessage(msg);
        return null;
      } finally {
        setReconcileBusy(false);
      }
    },
    [cartItems, pendingOrder, persistVerifiedPurchases, removeFromCart, user]
  );

  const dismissPendingOrder = useCallback(() => {
    void loadPlatformAdapter().then((platform) => platform.clearPendingRazorpayOrder());
    setPendingOrder(null);
    setReconcileMessage(null);
  }, []);

  const saveReadingProgress = useCallback(
    async (input: Omit<ReadingProgressRecord, 'id' | 'updatedAt'>) => {
      const id = makeProgressDocId(input.bookId, input.format);
      const record: ReadingProgressRecord = {
        ...input,
        id,
        pageIndex: Math.max(0, Math.floor(input.pageIndex)),
        totalPages: Math.max(0, Math.floor(input.totalPages)),
        offsetRatio: Math.min(1, Math.max(0, Number(input.offsetRatio.toFixed(4)))),
        blockIndex: Math.max(0, Math.floor(input.blockIndex)),
        zoomScale: Math.min(4, Math.max(0.5, Number(input.zoomScale.toFixed(2)))),
        progressPercent: Math.min(100, Math.max(0, Math.round(input.progressPercent))),
        updatedAt: new Date().toISOString(),
      };

      const bucketKey = user ? user.uid : 'guest';
      setReadingProgressMap((prev) => {
        const next = { ...prev, [id]: record };
        writeLocalProgressMap(bucketKey, next);
        return next;
      });

      if (firebaseUser && remoteWritable) {
        const syncMod = await loadFirebaseSync();
        await syncMod.writeRemoteReadingProgress(firebaseUser, record);
      }
    },
    [firebaseUser, remoteWritable, user]
  );

  const getReadingProgress = useCallback(
    (bookId: string, format: 'pdf' | 'markdown'): ReadingProgressRecord | null => {
      const id = makeProgressDocId(bookId, format);
      return readingProgressMap[id] ?? null;
    },
    [readingProgressMap]
  );

  const clearCheckoutError = useCallback(() => setCheckoutError(null), []);
  const clearReconcileMessage = useCallback(() => setReconcileMessage(null), []);
  const cartTotals = useMemo(() => computeCartTotals(cartItems), [cartItems]);

  const value = useMemo<AppSessionContextValue>(
    () => ({
      user,
      authReady,
      authBusy,
      authError,
      analytics: effectiveAnalytics,
      cartItems,
      cartTotals,
      cartOpen,
      setCartOpen,
      purchasedItems,
      purchasesLoading,
      readingProgressMap,
      checkoutBusy,
      checkoutError,
      clearCheckoutError,
      lastOrderReceipt,
      pendingOrder,
      reconcileBusy,
      reconcileMessage,
      clearReconcileMessage,
      signIn,
      signInWithReviewerCredentials,
      signOut,
      addToCart,
      removeFromCart,
      updateCartQuantity,
      clearCart,
      isInCart,
      isPurchased,
      getPurchase,
      checkoutCart,
      buyItemNow,
      reconcileOrder,
      dismissPendingOrder,
      saveReadingProgress,
      getReadingProgress,
    }),
    [
      user,
      authReady,
      authBusy,
      authError,
      effectiveAnalytics,
      cartItems,
      cartTotals,
      cartOpen,
      purchasedItems,
      purchasesLoading,
      readingProgressMap,
      checkoutBusy,
      checkoutError,
      clearCheckoutError,
      lastOrderReceipt,
      pendingOrder,
      reconcileBusy,
      reconcileMessage,
      clearReconcileMessage,
      signIn,
      signInWithReviewerCredentials,
      signOut,
      addToCart,
      removeFromCart,
      updateCartQuantity,
      clearCart,
      isInCart,
      isPurchased,
      getPurchase,
      checkoutCart,
      buyItemNow,
      reconcileOrder,
      dismissPendingOrder,
      saveReadingProgress,
      getReadingProgress,
    ]
  );

  return <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>;
}

export function useAppSession(): AppSessionContextValue {
  const ctx = useContext(AppSessionContext);
  if (!ctx) {
    throw new Error('useAppSession must be used inside AppSessionProvider.');
  }
  return ctx;
}
