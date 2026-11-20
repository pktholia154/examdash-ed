'use client';

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
import { auth, db, signInWithGoogle, signOutUser } from '@/lib/firebase/client';
import { buildFirestoreErrorInfo, OperationType } from '@/lib/firebase/errors';
import type {
  CartItem,
  PurchasedItem,
  ReadingProgressRecord,
  UserAnalyticsSummary,
} from '@/lib/design-system/types';

export type FirebaseAuthUser = User;

export function subscribeFirebaseAuthState(
  callback: (user: FirebaseAuthUser | null) => void
): () => void {
  return onAuthStateChanged(auth, callback);
}

export function getLiveFirebaseUser(): FirebaseAuthUser | null {
  return auth.currentUser;
}

export async function signInWithFirebaseGoogle(): Promise<FirebaseAuthUser> {
  return signInWithGoogle();
}

export async function signOutFirebaseUser(): Promise<void> {
  await signOutUser();
}

export interface RemoteUserBootstrapCallbacks {
  readonly readLocalPurchases: (uid: string) => PurchasedItem[];
  readonly writeLocalPurchases: (uid: string, items: readonly PurchasedItem[]) => void;
  readonly mergePurchases: (
    remote: readonly PurchasedItem[],
    local: readonly PurchasedItem[]
  ) => PurchasedItem[];
  readonly readLocalProgressMap: (uid: string) => Record<string, ReadingProgressRecord>;
  readonly writeLocalProgressMap: (
    uid: string,
    map: Record<string, ReadingProgressRecord>
  ) => void;
  readonly writeLocalCart: (items: readonly CartItem[]) => void;
  readonly onAnalytics: (analytics: UserAnalyticsSummary) => void;
  readonly onRemoteWritable: (writable: boolean) => void;
  readonly onCartItems: (items: CartItem[]) => void;
  readonly onPurchasedItems: (items: PurchasedItem[]) => void;
  readonly onPurchasesLoading: (loading: boolean) => void;
  readonly onReadingProgressMap: (map: Record<string, ReadingProgressRecord>) => void;
}

/**
 * Bootstraps authenticated user profile and live Firestore listeners (cart, purchases, readingProgress).
 * Strictly loaded dynamically only for signed-in users.
 */
export function startRemoteUserSync(
  activeFirebaseUser: FirebaseAuthUser,
  callbacks: RemoteUserBootstrapCallbacks
): () => void {
  let cancelled = false;
  let unsubCart: (() => void) | null = null;
  let unsubPurchases: (() => void) | null = null;
  let unsubProgress: (() => void) | null = null;
  const userDocRef = doc(db, 'users', activeFirebaseUser.uid);

  async function bootstrap() {
    callbacks.onPurchasedItems(callbacks.readLocalPurchases(activeFirebaseUser.uid));
    callbacks.onReadingProgressMap(callbacks.readLocalProgressMap(activeFirebaseUser.uid));
    callbacks.onPurchasesLoading(true);

    try {
      const snap = await getDoc(userDocRef);
      if (cancelled) return;

      if (snap.exists()) {
        const data = snap.data();
        callbacks.onAnalytics({
          testsAttempted: typeof data.testsAttempted === 'number' ? data.testsAttempted : 0,
          booksOwned: typeof data.booksOwned === 'number' ? data.booksOwned : 0,
          examsOwned: typeof data.examsOwned === 'number' ? data.examsOwned : 0,
          averageAccuracy: typeof data.averageAccuracy === 'number' ? data.averageAccuracy : 0,
          studyStreakDays: typeof data.studyStreakDays === 'number' ? data.studyStreakDays : 0,
        });
        callbacks.onRemoteWritable(true);
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
            callbacks.onAnalytics({
              testsAttempted: 0,
              booksOwned: 0,
              examsOwned: 0,
              averageAccuracy: 0,
              studyStreakDays: 0,
            });
            callbacks.onRemoteWritable(true);
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
            callbacks.onAnalytics({
              testsAttempted: 0,
              booksOwned: 0,
              examsOwned: 0,
              averageAccuracy: 0,
              studyStreakDays: 0,
            });
            callbacks.onRemoteWritable(false);
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
          callbacks.onRemoteWritable(true);
          if (remoteItems.length > 0) {
            callbacks.onCartItems(remoteItems);
            callbacks.writeLocalCart(remoteItems);
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

          const merged = callbacks.mergePurchases(
            remotePurchases,
            callbacks.readLocalPurchases(activeFirebaseUser.uid)
          );
          callbacks.onPurchasedItems(merged);
          callbacks.writeLocalPurchases(activeFirebaseUser.uid, merged);
          callbacks.onPurchasesLoading(false);
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
          callbacks.onPurchasesLoading(false);
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
            ...callbacks.readLocalProgressMap(activeFirebaseUser.uid),
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
          callbacks.onReadingProgressMap(nextMap);
          callbacks.writeLocalProgressMap(activeFirebaseUser.uid, nextMap);
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
        callbacks.onAnalytics({
          testsAttempted: 0,
          booksOwned: 0,
          examsOwned: 0,
          averageAccuracy: 0,
          studyStreakDays: 0,
        });
        callbacks.onRemoteWritable(false);
        callbacks.onPurchasesLoading(false);
      }
    }
  }

  void bootstrap();

  return () => {
    cancelled = true;
    if (unsubCart) unsubCart();
    if (unsubPurchases) unsubPurchases();
    if (unsubProgress) unsubProgress();
  };
}

export async function writeRemoteCartItem(
  fbUser: FirebaseAuthUser,
  item: CartItem
): Promise<void> {
  const ref = doc(db, 'users', fbUser.uid, 'cart', item.id);
  try {
    await setDoc(ref, {
      ...item,
      uid: fbUser.uid,
      addedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn(
      'Firestore cart write fallback to local:',
      JSON.stringify(
        buildFirestoreErrorInfo(
          err,
          OperationType.WRITE,
          `users/${fbUser.uid}/cart/${item.id}`,
          fbUser
        )
      )
    );
  }
}

export async function deleteRemoteCartItem(
  fbUser: FirebaseAuthUser,
  cartItemId: string
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'users', fbUser.uid, 'cart', cartItemId));
  } catch (err) {
    console.warn(
      'Firestore cart delete:',
      JSON.stringify(
        buildFirestoreErrorInfo(
          err,
          OperationType.DELETE,
          `users/${fbUser.uid}/cart/${cartItemId}`,
          fbUser
        )
      )
    );
  }
}

export async function updateRemoteCartItemQuantity(
  fbUser: FirebaseAuthUser,
  cartItemId: string,
  quantity: number
): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', fbUser.uid, 'cart', cartItemId), {
      quantity,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn(
      'Firestore cart quantity update:',
      JSON.stringify(
        buildFirestoreErrorInfo(
          err,
          OperationType.UPDATE,
          `users/${fbUser.uid}/cart/${cartItemId}`,
          fbUser
        )
      )
    );
  }
}

export async function clearRemoteCartItems(
  fbUser: FirebaseAuthUser,
  items: readonly CartItem[]
): Promise<void> {
  await Promise.allSettled(
    items.map((item) => deleteDoc(doc(db, 'users', fbUser.uid, 'cart', item.id)))
  );
}

export async function persistRemotePurchases(
  liveFbUser: FirebaseAuthUser,
  newPurchases: readonly PurchasedItem[]
): Promise<void> {
  const userDocRef = doc(db, 'users', liveFbUser.uid);
  try {
    const userSnap = await getDoc(userDocRef);
    if (!userSnap.exists()) {
      await setDoc(userDocRef, {
        uid: liveFbUser.uid,
        displayName: (liveFbUser.displayName || '').slice(0, 120),
        email: (liveFbUser.email || '').slice(0, 254),
        photoURL: (liveFbUser.photoURL || '').slice(0, 1000),
        testsAttempted: 0,
        booksOwned: 0,
        examsOwned: 0,
        averageAccuracy: 0,
        studyStreakDays: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (profileErr) {
    console.warn(
      'Firestore user parent ensure skipped:',
      JSON.stringify(
        buildFirestoreErrorInfo(
          profileErr,
          OperationType.WRITE,
          `users/${liveFbUser.uid}`,
          liveFbUser
        )
      )
    );
  }

  await Promise.allSettled(
    newPurchases.map(async (p) => {
      const ref = doc(db, 'users', liveFbUser.uid, 'purchases', p.id);
      try {
        const existingSnap = await getDoc(ref);
        if (existingSnap.exists()) {
          return;
        }
        await setDoc(ref, {
          id: p.id,
          uid: liveFbUser.uid,
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
              `users/${liveFbUser.uid}/purchases/${p.id}`,
              liveFbUser
            )
          )
        );
      }
    })
  );
}

export async function writeRemoteReadingProgress(
  fbUser: FirebaseAuthUser,
  record: ReadingProgressRecord
): Promise<void> {
  const ref = doc(db, 'users', fbUser.uid, 'readingProgress', record.id);
  try {
    await setDoc(ref, {
      id: record.id,
      uid: fbUser.uid,
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
          `users/${fbUser.uid}/readingProgress/${record.id}`,
          fbUser
        )
      )
    );
  }
}
