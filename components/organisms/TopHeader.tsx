'use client';

import React from 'react';
import Link from 'next/link';
import { Library, LogIn, LogOut, ShoppingCart } from 'lucide-react';
import { DESIGN_TOKENS } from '@/lib/design-system/tokens';

export interface TopHeaderProps {
  readonly userName: string | null;
  readonly userPhotoUrl: string | null;
  readonly authReady: boolean;
  readonly authBusy: boolean;
  readonly cartCount: number;
  readonly purchasedCount?: number;
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
  readonly onOpenCart: () => void;
}

export function TopHeader({
  userName,
  userPhotoUrl,
  authReady,
  authBusy,
  cartCount,
  purchasedCount = 0,
  onSignIn,
  onSignOut,
  onOpenCart,
}: TopHeaderProps) {
  const shortName = userName ? userName.split(' ')[0] : null;

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)]/95 backdrop-blur-sm safe-top">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-3 sm:gap-8 sm:px-6 lg:px-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <Link
          href="/"
          className="font-display text-base font-bold tracking-tight text-[var(--text-primary)] whitespace-nowrap shrink-0 sm:text-lg"
        >
          {DESIGN_TOKENS.brand.name}
        </Link>

        {/* Zone 2: Clean single-line navigation links */}
        <nav
          aria-label="Primary navigation"
          className="hidden items-center gap-7 text-sm font-medium text-[var(--text-secondary)] md:flex"
        >
          <Link
            href="/#overview"
            className="whitespace-nowrap shrink-0 transition-colors hover:text-[var(--text-primary)]"
          >
            Overview
          </Link>
          <Link
            href="/#books"
            className="whitespace-nowrap shrink-0 transition-colors hover:text-[var(--text-primary)]"
          >
            Books
          </Link>
          <Link
            href="/#exams"
            className="whitespace-nowrap shrink-0 transition-colors hover:text-[var(--text-primary)]"
          >
            Exams
          </Link>
          <Link
            href="/purchased"
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors hover:text-[var(--text-primary)]"
          >
            <span>Purchased</span>
            {purchasedCount > 0 && (
              <span className="font-mono-tabular text-xs font-semibold text-[var(--text-primary)]">
                ({purchasedCount})
              </span>
            )}
          </Link>
        </nav>

        {/* Zone 3: Mobile Purchased Shortcut, Cart & Google Sign-In Action */}
        <div className="flex items-center gap-1.5 shrink-0 sm:gap-2" data-nosnippet="">
          <Link
            href="/purchased"
            aria-label="Purchased library"
            className="inline-flex h-11 min-w-[44px] items-center justify-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-2 text-xs font-medium text-[var(--text-primary)] whitespace-nowrap shrink-0 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] md:hidden"
          >
            <Library className="h-4 w-4" aria-hidden="true" />
            {purchasedCount > 0 && (
              <span className="font-mono-tabular text-xs font-semibold">{purchasedCount}</span>
            )}
          </Link>

          <button
            type="button"
            onClick={onOpenCart}
            aria-label={cartCount > 0 ? `Open cart with ${cartCount} items` : 'Open cart'}
            className="relative inline-flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-2.5 text-sm font-medium text-[var(--text-primary)] whitespace-nowrap shrink-0 transition-colors duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] sm:px-3"
          >
            <ShoppingCart className="h-4 w-4" aria-hidden="true" />
            {cartCount > 0 && (
              <span className="font-mono-tabular text-xs font-semibold">{cartCount}</span>
            )}
          </button>

          {authReady && userName ? (
            <div className="flex items-center gap-2 shrink-0">
              {userPhotoUrl ? (
                <img
                  src={userPhotoUrl}
                  alt={userName}
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 rounded-full border border-[var(--border-subtle)] object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)]"
                >
                  {userName.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="hidden max-w-[120px] truncate text-sm font-medium text-[var(--text-primary)] sm:inline">
                {shortName}
              </span>
              <button
                type="button"
                onClick={onSignOut}
                disabled={authBusy}
                aria-label="Sign out"
                className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 text-sm font-medium text-[var(--text-secondary)] whitespace-nowrap shrink-0 transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              disabled={authBusy}
              aria-label="Sign in with Google"
              className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-[var(--brand-ink)] px-3 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors duration-150 hover:bg-[var(--brand-ink-hover)] disabled:opacity-60 sm:gap-2 sm:px-4 sm:text-sm"
            >
              <LogIn className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="sm:hidden">{authBusy ? 'Signing in...' : 'Sign in'}</span>
              <span className="hidden sm:inline">
                {authBusy ? 'Signing in...' : 'Sign in with Google'}
              </span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
