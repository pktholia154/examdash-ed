'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, signInWithGoogle, signOutUser, testFirestoreConnection } from '@/lib/firebase/client';
import { buildFirestoreErrorInfo, OperationType } from '@/lib/firebase/errors';
import {
  razorpayWebCheckoutAdapter,
  type CheckoutItemRequest,
} from '@/core/adapters/platform';
import type {
  CartItem,
  PublicCatalogBaseDTO,
  PurchasedItem,
  ReadingProgressRecord,
  UserAnalyticsSummary,
} from '@/lib/design-system/types';
import { computeCartTotals, type CartTotals } from '@/lib/design-system/formatters';
import { loadAllExamAttemptSummaries } from '@/core/exam/storage';
import type { ExamAttemptSummary } from '@/core/exam/engine';

const LOCAL_CART_KEY = 'examdash_cart_v1';
const LOCAL_PURCHASES_PREFIX = 'examdash_purchases_v1_';
const LOCAL_PROGRESS_PREFIX = 'examdash_progress_v1_';

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
  saveReadingProgress: (record: Omit<ReadingProgressRecord, 'id' | 'updatedAt'>) => Promise<void>;
  getReadingProgress: (bookId: string, format: 'pdf' | 'markdown') => ReadingProgressRecord | null;
}

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

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
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, ReadingProgressRecord>) : {};
  } catch {
    return {};
  }
}

function writeLocalProgressMap(uidOrGuest: string, map: Record<string, ReadingProgressRecord>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${LOCAL_PROGRESS_PREFIX}${uidOrGuest}`, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

function mergePurchases(remote: readonly PurchasedItem[], local: readonly PurchasedItem[]): PurchasedItem[] {
  const byId = new Map<string, PurchasedItem>();
  for (const item of local) byId.set(item.id, item);
  for (const item of remote) byId.set(item.id, item);
  return Array.from(byId.values()).sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
}

function hasReviewerHintCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((entry) => entry.trim() === 'ed_rs=1');
}

function toFirebaseSessionUser(fbUser: User): SessionUser {
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
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
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
  const [readingProgressMap, setReadingProgressMap] = useState<Record<string, ReadingProgressRecord>>({});
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [lastOrderReceipt, setLastOrderReceipt] = useState<OrderReceiptSummary | null>(null);
  const [examAttemptSummaries, setExamAttemptSummaries] = useState<ExamAttemptSummary[]>([]);

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

  // Post-mount connection check & guest cart/progress hydration
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setCartItems(readLocalCart());
      setReadingProgressMap(readLocalProgressMap('guest'));
    });
    void testFirestoreConnection();

    const onStorage = (event: StorageEvent) => {
      if (event.key === LOCAL_CART_KEY) {
        setCartItems(readLocalCart());
      }
    };
    const refreshAttempts = () => {
      void loadAllExamAttemptSummaries().then((list) => {
        if (active) setExamAttemptSummaries(list);
      });
    };
    refreshAttempts();
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

  // Auth listener (Firebase Google Sign-In)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      setFirebaseUser(fbUser);
      setFirebaseAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Sync user analytics, cart, purchases, and reading progress once authenticated
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
        setCartItems(readLocalCart());
        setReadingProgressMap(readLocalProgressMap('guest'));
      });
      return () => {
        active = false;
      };
    }

    const currentUid = user.uid;

    // Reviewer test sessions persist cart/purchases/progress locally and authenticate server APIs directly
    if (user.authProvider !== 'firebase-google' || !firebaseUser) {
      let active = true;
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

    const activeFirebaseUser = firebaseUser;
    let cancelled = false;
    let unsubCart: (() => void) | null = null;
    let unsubPurchases: (() => void) | null = null;
    let unsubProgress: (() => void) | null = null;
    const userDocRef = doc(db, 'users', activeFirebaseUser.uid);

    async function bootstrapUserState() {
      setPurchasedItems(readLocalPurchases(activeFirebaseUser.uid));
      setReadingProgressMap(readLocalProgressMap(activeFirebaseUser.uid));
      setPurchasesLoading(true);
      try {
        const snap = await getDoc(userDocRef);
        if (cancelled) return;

        if (snap.exists()) {
          const data = snap.data();
          setAnalytics({
            testsAttempted: typeof data.testsAttempted === 'number' ? data.testsAttempted : 0,
            booksOwned: typeof data.booksOwned === 'number' ? data.booksOwned : 0,
            examsOwned: typeof data.examsOwned === 'number' ? data.examsOwned : 0,
            averageAccuracy: typeof data.averageAccuracy === 'number' ? data.averageAccuracy : 0,
            studyStreakDays: typeof data.studyStreakDays === 'number' ? data.studyStreakDays : 0,
          });
          setRemoteWritable(true);
        } else {
          try {
            await setDoc(userDocRef, {
              uid: activeFirebaseUser.uid,
              displayName: (activeFirebaseUser.displayName || '').slice(0, 120),
              email: (activeFirebaseUser.email || '').slice(0, 254),
              photoURL: (activeFirebaseUser.photoURL || '').slice(0, 1000),
              testsAttempted: 0,
              booksOwned: 0,
              examsOwned: 0,
              averageAccuracy: 0,
              studyStreakDays: 0,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            if (!cancelled) {
              setAnalytics({
                testsAttempted: 0,
                booksOwned: 0,
                examsOwned: 0,
                averageAccuracy: 0,
                studyStreakDays: 0,
              });
              setRemoteWritable(true);
            }
          } catch (createErr) {
            console.warn(
              'Firestore profile init skipped:',
              JSON.stringify(
                buildFirestoreErrorInfo(
                  createErr,
                  OperationType.CREATE,
                  `users/${activeFirebaseUser.uid}`,
                  activeFirebaseUser
                )
              )
            );
            if (!cancelled) {
              setAnalytics({
                testsAttempted: 0,
                booksOwned: 0,
                examsOwned: 0,
                averageAccuracy: 0,
                studyStreakDays: 0,
              });
              setRemoteWritable(false);
            }
          }
        }

        // Cart listener
        const cartCollectionRef = collection(db, 'users', activeFirebaseUser.uid, 'cart');
        const cartQuery = query(cartCollectionRef, where('uid', '==', activeFirebaseUser.uid));
        unsubCart = onSnapshot(
          cartQuery,
          (snapshot) => {
            if (cancelled) return;
            const remoteItems: CartItem[] = snapshot.docs.map((d) => {
              const data = d.data();
              return {
                id: d.id,
                itemId: String(data.itemId ?? d.id),
                contentType:
                  data.contentType === 'exams' || data.contentType === 'quizbooks'
                    ? data.contentType
                    : 'books',
                title: String(data.title ?? ''),
                urlSlug: String(data.urlSlug ?? ''),
                currency: String(data.currency ?? 'INR'),
                buyPrice: Number(data.buyPrice ?? 0),
                listPrice: Number(data.listPrice ?? 0),
                quantity: Math.max(1, Math.min(20, Number(data.quantity ?? 1))),
              };
            });
            setRemoteWritable(true);
            if (remoteItems.length > 0) {
              setCartItems(remoteItems);
              writeLocalCart(remoteItems);
            }
          },
          (err) => {
            console.warn(
              'Firestore cart listener:',
              JSON.stringify(
                buildFirestoreErrorInfo(
                  err,
                  OperationType.LIST,
                  `users/${activeFirebaseUser.uid}/cart`,
                  activeFirebaseUser
                )
              )
            );
          }
        );

        // Purchases listener
        const purchasesRef = collection(db, 'users', activeFirebaseUser.uid, 'purchases');
        const purchasesQuery = query(purchasesRef, where('uid', '==', activeFirebaseUser.uid));
        unsubPurchases = onSnapshot(
          purchasesQuery,
          (snapshot) => {
            if (cancelled) return;
            const remotePurchases: PurchasedItem[] = snapshot.docs.map((d) => {
              const data = d.data();
              const purchasedTs = data.purchasedAt;
              const purchasedAtIso =
                purchasedTs && typeof purchasedTs.toDate === 'function'
                  ? purchasedTs.toDate().toISOString()
                  : typeof purchasedTs === 'string'
                    ? purchasedTs
                    : new Date().toISOString();
              return {
                id: d.id,
                itemId: String(data.itemId ?? ''),
                contentType:
                  data.contentType === 'exams' || data.contentType === 'quizbooks'
                    ? data.contentType
                    : 'books',
                title: String(data.title ?? ''),
                urlSlug: String(data.urlSlug ?? ''),
                currency: String(data.currency ?? 'INR'),
                amountPaid: Number(data.amountPaid ?? 0),
                razorpayOrderId: String(data.razorpayOrderId ?? ''),
                razorpayPaymentId: String(data.razorpayPaymentId ?? ''),
                entitlementProof: String(data.entitlementProof ?? ''),
                status: 'completed',
                purchasedAt: purchasedAtIso,
              };
            });

            const merged = mergePurchases(remotePurchases, readLocalPurchases(activeFirebaseUser.uid));
            setPurchasedItems(merged);
            writeLocalPurchases(activeFirebaseUser.uid, merged);
            setPurchasesLoading(false);
          },
          (err) => {
            console.warn(
              'Firestore purchases listener:',
              JSON.stringify(
                buildFirestoreErrorInfo(
                  err,
                  OperationType.LIST,
                  `users/${activeFirebaseUser.uid}/purchases`,
                  activeFirebaseUser
                )
              )
            );
            setPurchasesLoading(false);
          }
        );

        // Reading Progress listener
        const progressRef = collection(db, 'users', activeFirebaseUser.uid, 'readingProgress');
        const progressQuery = query(progressRef, where('uid', '==', activeFirebaseUser.uid));
        unsubProgress = onSnapshot(
          progressQuery,
          (snapshot) => {
            if (cancelled) return;
            const nextMap: Record<string, ReadingProgressRecord> = {
              ...readLocalProgressMap(activeFirebaseUser.uid),
            };
            for (const d of snapshot.docs) {
              const data = d.data();
              const updatedTs = data.updatedAt;
              const updatedIso =
                updatedTs && typeof updatedTs.toDate === 'function'
                  ? updatedTs.toDate().toISOString()
                  : new Date().toISOString();
              nextMap[d.id] = {
                id: d.id,
                bookId: String(data.bookId ?? ''),
                format: data.format === 'markdown' ? 'markdown' : 'pdf',
                mode: data.mode === 'full' ? 'full' : 'sample',
                pageIndex: Number(data.pageIndex ?? 0),
                totalPages: Number(data.totalPages ?? 0),
                offsetRatio: Number(data.offsetRatio ?? 0),
                blockIndex: Number(data.blockIndex ?? 0),
                zoomScale: Number(data.zoomScale ?? 1),
                progressPercent: Number(data.progressPercent ?? 0),
                updatedAt: updatedIso,
              };
            }
            setReadingProgressMap(nextMap);
            writeLocalProgressMap(activeFirebaseUser.uid, nextMap);
          },
          (err) => {
            console.warn(
              'Firestore readingProgress listener:',
              JSON.stringify(
                buildFirestoreErrorInfo(
                  err,
                  OperationType.LIST,
                  `users/${activeFirebaseUser.uid}/readingProgress`,
                  activeFirebaseUser
                )
              )
            );
          }
        );
      } catch (err) {
        console.warn(
          'Firestore user read:',
          JSON.stringify(
            buildFirestoreErrorInfo(
              err,
              OperationType.GET,
              `users/${activeFirebaseUser.uid}`,
              activeFirebaseUser
            )
          )
        );
        if (!cancelled) {
          setAnalytics({
            testsAttempted: 0,
            booksOwned: 0,
            examsOwned: 0,
            averageAccuracy: 0,
            studyStreakDays: 0,
          });
          setRemoteWritable(false);
          setPurchasesLoading(false);
        }
      }
    }

    void bootstrapUserState();

    return () => {
      cancelled = true;
      if (unsubCart) unsubCart();
      if (unsubPurchases) unsubPurchases();
      if (unsubProgress) unsubProgress();
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
      const signedInUser = await signInWithGoogle();
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
  }, []);

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

        if (!res.ok || !payload.authenticated || !payload.user?.uid || !payload.user?.email || !payload.token) {
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
        await signOutUser();
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
      const existingItem = cartItems.find((entry) => entry.id === cartId);
      const nextQuantity = existingItem ? Math.min(20, existingItem.quantity + 1) : 1;

      const updatedItem: CartItem = {
        id: cartId,
        itemId: item.id,
        contentType: item.contentType,
        title: item.title.slice(0, 240),
        urlSlug: item.urlSlug.slice(0, 240),
        currency: (item.currency || 'INR').slice(0, 8),
        buyPrice: Math.max(0, item.buyPrice),
        listPrice: Math.max(0, item.listPrice),
        quantity: nextQuantity,
      };

      const nextList = existingItem
        ? cartItems.map((entry) => (entry.id === cartId ? updatedItem : entry))
        : [updatedItem, ...cartItems];

      setCartItems(nextList);
      writeLocalCart(nextList);

      if (firebaseUser && remoteWritable) {
        const ref = doc(db, 'users', firebaseUser.uid, 'cart', cartId);
        try {
          if (existingItem) {
            await updateDoc(ref, {
              quantity: nextQuantity,
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(ref, {
              ...updatedItem,
              uid: firebaseUser.uid,
              addedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          console.warn(
            'Firestore cart write fallback to local:',
            JSON.stringify(
              buildFirestoreErrorInfo(
                err,
                OperationType.WRITE,
                `users/${firebaseUser.uid}/cart/${cartId}`,
                firebaseUser
              )
            )
          );
        }
      }
    },
    [cartItems, firebaseUser, remoteWritable]
  );

  const removeFromCart = useCallback(
    async (cartItemId: string) => {
      const nextList = cartItems.filter((entry) => entry.id !== cartItemId);
      setCartItems(nextList);
      writeLocalCart(nextList);

      if (firebaseUser && remoteWritable) {
        try {
          await deleteDoc(doc(db, 'users', firebaseUser.uid, 'cart', cartItemId));
        } catch (err) {
          console.warn(
            'Firestore cart delete:',
            JSON.stringify(
              buildFirestoreErrorInfo(
                err,
                OperationType.DELETE,
                `users/${firebaseUser.uid}/cart/${cartItemId}`,
                firebaseUser
              )
            )
          );
        }
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
        try {
          await updateDoc(doc(db, 'users', firebaseUser.uid, 'cart', cartItemId), {
            quantity: bounded,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          console.warn(
            'Firestore cart quantity update:',
            JSON.stringify(
              buildFirestoreErrorInfo(
                err,
                OperationType.UPDATE,
                `users/${firebaseUser.uid}/cart/${cartItemId}`,
                firebaseUser
              )
            )
          );
        }
      }
    },
    [cartItems, firebaseUser, removeFromCart, remoteWritable]
  );

  const clearCart = useCallback(async () => {
    const previous = [...cartItems];
    setCartItems([]);
    writeLocalCart([]);
    if (firebaseUser && remoteWritable) {
      await Promise.allSettled(
        previous.map((item) => deleteDoc(doc(db, 'users', firebaseUser.uid, 'cart', item.id)))
      );
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

      // Only write to Firestore subcollection for Firebase-authenticated users
      if (activeUser.authProvider !== 'firebase-google' || !firebaseUser) {
        return;
      }

      await Promise.allSettled(
        newPurchases.map(async (p) => {
          const ref = doc(db, 'users', firebaseUser.uid, 'purchases', p.id);
          try {
            await setDoc(ref, {
              id: p.id,
              uid: firebaseUser.uid,
              itemId: p.itemId,
              contentType: p.contentType,
              title: p.title.slice(0, 240),
              urlSlug: p.urlSlug.slice(0, 240),
              currency: p.currency.slice(0, 8),
              amountPaid: Math.max(0, p.amountPaid),
              razorpayOrderId: p.razorpayOrderId.slice(0, 128),
              razorpayPaymentId: p.razorpayPaymentId.slice(0, 128),
              entitlementProof: p.entitlementProof.slice(0, 512),
              status: 'completed',
              purchasedAt: serverTimestamp(),
            });
          } catch (err) {
            console.warn(
              'Firestore purchase write (retained locally):',
              JSON.stringify(
                buildFirestoreErrorInfo(
                  err,
                  OperationType.CREATE,
                  `users/${firebaseUser.uid}/purchases/${p.id}`,
                  firebaseUser
                )
              )
            );
          }
        })
      );
    },
    [firebaseUser]
  );

  const runRazorpayCheckout = useCallback(
    async (itemsToBuy: readonly CheckoutItemRequest[], clearAfter: boolean): Promise<OrderReceiptSummary | null> => {
      setCheckoutError(null);
      let activeUser = user;
      if (!activeUser) {
        activeUser = await signIn();
        if (!activeUser) return null;
      }

      setCheckoutBusy(true);
      try {
        const result = await razorpayWebCheckoutAdapter.checkout({
          items: itemsToBuy,
          user: {
            uid: activeUser.uid,
            email: activeUser.email,
            displayName: activeUser.displayName,
            getIdToken: () => activeUser!.getIdToken(),
          },
        });

        if (result.status === 'cancelled' || !result.purchases || result.purchases.length === 0) {
          return null;
        }

        await persistVerifiedPurchases(activeUser, result.purchases);

        if (clearAfter) {
          await clearCart();
        } else {
          // Remove bought items from cart if present
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
        setCartOpen(false);
        return receipt;
      } catch (err) {
        setCheckoutError(
          err instanceof Error ? err.message : 'Unable to complete Razorpay checkout.'
        );
        return null;
      } finally {
        setCheckoutBusy(false);
      }
    },
    [cartItems, clearCart, persistVerifiedPurchases, removeFromCart, signIn, user]
  );

  const checkoutCart = useCallback(async () => {
    if (cartItems.length === 0) return null;
    const reqItems: CheckoutItemRequest[] = cartItems.map((c) => ({
      itemId: c.itemId,
      contentType: c.contentType,
      quantity: c.quantity,
      title: c.title,
    }));
    return runRazorpayCheckout(reqItems, true);
  }, [cartItems, runRazorpayCheckout]);

  const buyItemNow = useCallback(
    async (item: PublicCatalogBaseDTO) => {
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
    [runRazorpayCheckout]
  );

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
        const ref = doc(db, 'users', firebaseUser.uid, 'readingProgress', id);
        try {
          await setDoc(ref, {
            id,
            uid: firebaseUser.uid,
            bookId: record.bookId,
            format: record.format,
            mode: record.mode,
            pageIndex: record.pageIndex,
            totalPages: record.totalPages,
            offsetRatio: record.offsetRatio,
            blockIndex: record.blockIndex,
            zoomScale: record.zoomScale,
            progressPercent: record.progressPercent,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          console.warn(
            'Firestore readingProgress sync fallback to local:',
            JSON.stringify(
              buildFirestoreErrorInfo(
                err,
                OperationType.WRITE,
                `users/${firebaseUser.uid}/readingProgress/${id}`,
                firebaseUser
              )
            )
          );
        }
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
