import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Page Not Found',
  robots: { index: false, follow: false },
};

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <p className="font-mono-tabular text-sm font-semibold text-[var(--text-muted)]">404</p>
      <h1 className="mt-2 text-2xl font-bold text-[var(--text-primary)]">
        This study resource could not be found
      </h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        The book or exam pack you requested may have been moved or unpublished.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-[44px] items-center rounded-lg bg-[var(--brand-ink)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--brand-ink-hover)]"
      >
        Return to ExamDash (ed)
      </Link>
    </main>
  );
}
