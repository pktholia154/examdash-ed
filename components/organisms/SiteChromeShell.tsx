'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { TopHeader } from '@/components/organisms/TopHeader';
import { OfflineBanner } from '@/components/organisms/OfflineBanner';
import { SiteFooter } from '@/components/organisms/SiteFooter';
import { useAppSession } from '@/components/providers/AppSessionProvider';

const LazyCartDrawer = dynamic(
  () => import('@/components/organisms/CartDrawer').then((m) => m.CartDrawer),
  { ssr: false }
);

export interface SiteChromeShellProps {
  readonly children: React.ReactNode;
}

/**
 * Thin client layout chrome accepting Server Components as `children`
 * so editorial SSR HTML is never duplicated into client hydration payloads.
 */
export function SiteChromeShell({ children }: SiteChromeShellProps) {
  const router = useRouter();
  const {
    user,
    authReady,
    authBusy,
    cartItems,
    cartTotals,
    cartOpen,
    setCartOpen,
    purchasedItems,
    checkoutBusy,
    checkoutError,
    pendingOrder,
    reconcileBusy,
    reconcileMessage,
    signIn,
    signOut,
    removeFromCart,
    updateCartQuantity,
    clearCart,
    checkoutCart,
    reconcileOrder,
  } = useAppSession();

  const handleCartCheckout = async () => {
    const receipt = await checkoutCart();
    if (receipt) {
      router.push(`/purchased?order=${encodeURIComponent(receipt.orderId)}`);
    }
  };

  const handleReconcile = async () => {
    const res = await reconcileOrder();
    if (res?.status === 'completed') {
      setCartOpen(false);
      router.push(`/purchased?order=${encodeURIComponent(res.orderId)}`);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--surface-canvas)]">
      <TopHeader
        userName={user?.displayName ?? user?.email ?? null}
        userPhotoUrl={user?.photoURL ?? null}
        authReady={authReady}
        authBusy={authBusy}
        cartCount={cartTotals.itemCount}
        purchasedCount={purchasedItems.length}
        onSignIn={() => void signIn()}
        onSignOut={() => void signOut()}
        onOpenCart={() => setCartOpen(true)}
      />

      <OfflineBanner />

      {children}

      <SiteFooter />

      {cartOpen && (
        <LazyCartDrawer
          open={cartOpen}
          items={cartItems}
          totals={cartTotals}
          isSignedIn={Boolean(user)}
          checkoutBusy={checkoutBusy}
          checkoutError={checkoutError}
          pendingOrder={pendingOrder}
          reconcileBusy={reconcileBusy}
          reconcileMessage={reconcileMessage}
          onClose={() => setCartOpen(false)}
          onUpdateQuantity={(id, qty) => void updateCartQuantity(id, qty)}
          onRemoveItem={(id) => void removeFromCart(id)}
          onClearCart={() => void clearCart()}
          onSignIn={() => void signIn()}
          onCheckout={() => void handleCartCheckout()}
          onReconcilePendingOrder={() => void handleReconcile()}
        />
      )}
    </div>
  );
}
