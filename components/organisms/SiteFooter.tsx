import React from 'react';
import Link from 'next/link';
import { DESIGN_TOKENS } from '@/lib/design-system/tokens';

export function SiteFooter() {
  return (
    <footer
      data-nosnippet=""
      className="mt-16 border-t border-[var(--border-subtle)] bg-[var(--surface-canvas)]"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="font-display font-bold text-[var(--text-primary)]">
            {DESIGN_TOKENS.brand.name}
          </span>
          <span aria-hidden="true">·</span>
          <span>Study Books &amp; Online Exam Packs</span>
        </div>

        <nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-6">
          <Link href="/books" className="hover:text-[var(--text-primary)]">
            Books
          </Link>
          <Link href="/exams" className="hover:text-[var(--text-primary)]">
            Exams
          </Link>
          <Link href="/purchased" rel="nofollow" className="hover:text-[var(--text-primary)]">
            Purchased
          </Link>
          <a href="/sitemap.xml" className="hover:text-[var(--text-primary)]">
            Sitemap
          </a>
        </nav>
      </div>
    </footer>
  );
}
