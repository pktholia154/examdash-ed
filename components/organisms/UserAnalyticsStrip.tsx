'use client';

import React from 'react';
import { AnalyticsMetricTile } from '@/components/molecules/AnalyticsMetricTile';
import { formatPrice } from '@/lib/design-system/formatters';
import type { UserAnalyticsSummary } from '@/lib/design-system/types';

export interface UserAnalyticsStripProps {
  readonly isSignedIn: boolean;
  readonly userName: string | null;
  readonly analytics: UserAnalyticsSummary | null;
  readonly publishedBooksCount: number;
  readonly publishedExamsCount: number;
  readonly cartItemCount: number;
  readonly cartSavings: number;
  readonly cartCurrency: string;
  readonly onSignIn: () => void;
}

export function UserAnalyticsStrip({
  isSignedIn,
  userName,
  analytics,
  publishedBooksCount,
  publishedExamsCount,
  cartItemCount,
  cartSavings,
  cartCurrency,
  onSignIn,
}: UserAnalyticsStripProps) {
  const metrics = isSignedIn
    ? [
        {
          label: 'Books Owned',
          value: String(analytics?.booksOwned ?? 0),
          detail: `${publishedBooksCount} published in catalog`,
        },
        {
          label: 'Exam Packs Owned',
          value: String(analytics?.examsOwned ?? 0),
          detail: `${publishedExamsCount} published in catalog`,
        },
        {
          label: 'Mock Tests Attempted',
          value: String(analytics?.testsAttempted ?? 0),
          detail: `${analytics?.studyStreakDays ?? 0} day study streak`,
        },
        {
          label: 'Average Accuracy',
          value: `${analytics?.averageAccuracy ?? 0}%`,
          detail: cartItemCount > 0 ? `${cartItemCount} item(s) in cart` : 'Synced with your account',
        },
      ]
    : [
        {
          label: 'Published Books',
          value: String(publishedBooksCount),
          detail: 'Live from Firebase books',
        },
        {
          label: 'Published Exam Packs',
          value: String(publishedExamsCount),
          detail: 'Live from ExamPackDocument',
        },
        {
          label: 'Items in Cart',
          value: String(cartItemCount),
          detail: cartItemCount > 0 ? 'Saved for checkout' : 'Add items to build your pack',
        },
        {
          label: 'Active Cart Savings',
          value: formatPrice(cartSavings, cartCurrency),
          detail: cartSavings > 0 ? 'Combined catalog discount' : 'Sign in to sync study stats',
        },
      ];

  return (
    <section
      id="overview"
      aria-labelledby="dashboard-overview-heading"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)]"
    >
      <div className="flex flex-col gap-2 border-b border-[var(--border-subtle)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2
            id="dashboard-overview-heading"
            className="text-sm font-semibold text-[var(--text-primary)]"
          >
            {isSignedIn && userName ? `${userName}'s Study Dashboard` : 'Quick Dashboard & Analytics'}
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            {isSignedIn
              ? 'Live metrics synchronized with your ExamDash account.'
              : 'Sign in with Google to track mock test attempts, accuracy, and owned materials.'}
          </p>
        </div>

        {!isSignedIn && (
          <button
            type="button"
            onClick={onSignIn}
            data-nosnippet=""
            className="inline-flex min-h-[40px] items-center self-start text-xs font-semibold text-[var(--brand-accent)] underline-offset-4 hover:underline sm:self-auto whitespace-nowrap shrink-0"
          >
            Sync progress with Google
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--border-subtle)] lg:grid-cols-4 lg:divide-y-0">
        {metrics.map((metric) => (
          <AnalyticsMetricTile
            key={metric.label}
            label={metric.label}
            value={metric.value}
            detail={metric.detail}
          />
        ))}
      </div>
    </section>
  );
}
