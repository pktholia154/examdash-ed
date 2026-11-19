'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import {
  CreditCard,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';
import { MonogramThumbnail } from '@/components/atoms/MonogramThumbnail';
import { getContentTypeConfig } from '@/lib/design-system/content-types';
import { formatPrice, type CartTotals } from '@/lib/design-system/formatters';
import type { CartItem } from '@/lib/design-system/types';
import type { PendingRazorpayOrder } from '@/core/adapters/platform';

export interface CartDrawerProps {
  readonly open: boolean;
  readonly items: readonly CartItem[];
  readonly totals: CartTotals;
  readonly isSignedIn: boolean;
  readonly checkoutBusy?: boolean;
  readonly checkoutError?: string | null;
  readonly pendingOrder?: PendingRazorpayOrder | null;
  readonly reconcileBusy?: boolean;
  readonly reconcileMessage?: string | null;
  readonly onClose: () => void;
  readonly onUpdateQuantity?: (cartItemId: string, quantity: number) => void;
  readonly onRemoveItem: (cartItemId: string) => void;
  readonly onClearCart: () => void;
  readonly onSignIn: () => void;
  readonly onCheckout?: () => void;
  readonly onReconcilePendingOrder?: () => void;
}

export function CartDrawer({
  open,
  items,
  totals,
  isSignedIn,
  checkoutBusy = false,
  checkoutError = null,
  pendingOrder = null,
  reconcileBusy = false,
  reconcileMessage = null,
  onClose,
  onRemoveItem,
  onClearCart,
  onSignIn,
  onCheckout,
  onReconcilePendingOrder,
}: CartDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-nosnippet=""
      role="dialog"
      aria-modal="true"
      aria-labelledby="cart-drawer-heading"
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/35 backdrop-blur-xs"
    >
      <div className="flex-1" onClick={onClose} aria-hidden="true" />
      <aside className="flex h-full w-full max-w-md flex-col bg-[var(--surface-canvas)] shadow-[var(--shadow-drawer)]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div>
            <h2 id="cart-drawer-heading" className="text-base font-bold text-[var(--text-primary)]">
              Your Study Cart
            </h2>
            <p className="font-mono-tabular text-xs text-[var(--text-muted)]">
              {items.length === 1 ? '1 digital item' : `${items.length} digital items`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cart drawer"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {pendingOrder && isSignedIn && onReconcilePendingOrder && (
            <div
              role="status"
              className="mb-4 space-y-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] p-3.5"
            >
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                Unverified Razorpay order detected
              </p>
              <p className="font-mono-tabular text-xs text-[var(--text-secondary)]">
                Order {pendingOrder.orderId}
                {pendingOrder.amountSubunits > 0
                  ? ` · ${formatPrice(pendingOrder.amountSubunits / 100, pendingOrder.currency)}`
                  : ''}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                If payment was debited via UPI or card, verify status to unlock your items immediately.
              </p>
              <button
                type="button"
                onClick={onReconcilePendingOrder}
                disabled={reconcileBusy}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[var(--brand-ink)] bg-[var(--surface-canvas)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--brand-ink)] hover:text-white disabled:opacity-60"
              >
                {reconcileBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{reconcileBusy ? 'Checking Razorpay...' : 'Verify Pending Payment'}</span>
              </button>
            </div>
          )}

          {reconcileMessage && (
            <p
              role="status"
              className="mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]"
            >
              {reconcileMessage}
            </p>
          )}

          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--surface-subtle)] text-[var(--text-muted)]">
                <ShoppingCart className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="mt-4 text-sm font-semibold text-[var(--text-primary)]">
                Your cart is empty
              </p>
              <p className="mt-1 max-w-xs text-xs text-[var(--text-muted)]">
                Add study books or online exam packs from the catalog to unlock full editions via Razorpay.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {items.map((item) => {
                const config = getContentTypeConfig(item.contentType);
                return (
                  <li key={item.id} className="flex items-start gap-3.5 py-4 first:pt-0">
                    <MonogramThumbnail
                      title={item.title}
                      contentType={item.contentType}
                      size="compact"
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`${config.routePrefix}/${item.urlSlug}`}
                        onClick={onClose}
                        className="line-clamp-2 text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--brand-accent)]"
                      >
                        {item.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {config.singularLabel} · Single-user digital license
                      </p>

                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono-tabular text-sm font-bold text-[var(--text-primary)]">
                            {formatPrice(item.buyPrice, item.currency)}
                          </span>
                          {item.listPrice > item.buyPrice && (
                            <span className="font-mono-tabular text-xs text-[var(--text-muted)] line-through">
                              {formatPrice(item.listPrice, item.currency)}
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => onRemoveItem(item.id)}
                          aria-label={`Remove ${item.title} from cart`}
                          className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--semantic-danger)]"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-5 py-4 space-y-3">
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between text-[var(--text-secondary)]">
                <span>List Total</span>
                <span className="font-mono-tabular">
                  {formatPrice(totals.totalListPrice, totals.currency)}
                </span>
              </div>
              {totals.totalSavings > 0 && (
                <div className="flex items-center justify-between text-[var(--semantic-discount)]">
                  <span>Catalog Discount</span>
                  <span className="font-mono-tabular font-medium">
                    -{formatPrice(totals.totalSavings, totals.currency)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-2 text-base font-bold text-[var(--text-primary)]">
                <span>Total Payable</span>
                <span className="font-mono-tabular">
                  {formatPrice(totals.subtotal, totals.currency)}
                </span>
              </div>
            </div>

            {checkoutError && (
              <p
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
              >
                {checkoutError}
              </p>
            )}

            {isSignedIn ? (
              <button
                type="button"
                onClick={onCheckout}
                disabled={checkoutBusy}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand-ink)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-ink-hover)] disabled:opacity-60"
              >
                {checkoutBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Opening Razorpay...</span>
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" aria-hidden="true" />
                    <span>
                      Pay {formatPrice(totals.subtotal, totals.currency)} with Razorpay
                    </span>
                  </>
                )}
              </button>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={onSignIn}
                  className="min-h-[44px] w-full rounded-lg bg-[var(--brand-ink)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-ink-hover)]"
                >
                  Sign in with Google to Pay via Razorpay
                </button>
                <div className="text-center">
                  <Link
                    href="/login?redirect=/"
                    rel="nofollow"
                    onClick={onClose}
                    className="text-xs text-[var(--text-muted)] underline-offset-4 transition-colors hover:text-[var(--text-primary)] hover:underline"
                  >
                    Partner / verification email sign-in
                  </Link>
                </div>
              </div>
            )}

            <div className="flex flex-col items-center gap-1 pt-0.5 text-center text-[11px] text-[var(--text-muted)]">
              <p className="inline-flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Secured by Razorpay · UPI, Cards, Netbanking · Instant Digital Unlock</span>
              </p>
              <p>
                By paying, you agree to our{' '}
                <Link
                  href="/terms-of-service"
                  onClick={onClose}
                  className="underline underline-offset-2 hover:text-[var(--text-primary)]"
                >
                  Terms
                </Link>{' '}
                &amp;{' '}
                <Link
                  href="/refund-policy"
                  onClick={onClose}
                  className="underline underline-offset-2 hover:text-[var(--text-primary)]"
                >
                  Refund Policy
                </Link>
                .
              </p>
            </div>

            <button
              type="button"
              onClick={onClearCart}
              disabled={checkoutBusy}
              className="min-h-[40px] w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              Clear cart
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
