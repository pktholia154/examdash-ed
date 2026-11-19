import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import { ReviewerLoginTemplate } from '@/components/templates/ReviewerLoginTemplate';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign In — ExamDash (ed)',
  description: 'Sign in to access your ExamDash account and checkout.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[var(--surface-canvas)]">
          <div className="h-80 w-full max-w-md animate-pulse rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)]" />
        </div>
      }
    >
      <ReviewerLoginTemplate />
    </Suspense>
  );
}
