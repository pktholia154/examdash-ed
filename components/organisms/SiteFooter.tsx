import React from 'react';
import Link from 'next/link';
import {
  BUSINESS_IDENTITY,
  COMPLIANCE_PAGE_LINKS,
} from '@/lib/compliance/business-info';
import { DESIGN_TOKENS } from '@/lib/design-system/tokens';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-[var(--border-subtle)] bg-[var(--surface-canvas)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-8 text-xs text-[var(--text-muted)] sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
            <span className="font-display font-bold text-[var(--text-primary)]">
              {DESIGN_TOKENS.brand.name}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-[var(--text-secondary)]">
              {BUSINESS_IDENTITY.brandName}
            </span>
            <span aria-hidden="true">·</span>
            <span>Study Books &amp; Online Exam Packs</span>
          </div>

          <nav aria-label="Catalog navigation" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
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

        <nav
          aria-label="Legal and compliance policies"
          className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--border-subtle)] pt-4 text-xs sm:text-sm"
        >
          {COMPLIANCE_PAGE_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline hover:underline-offset-4"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex flex-col gap-1.5 border-t border-[var(--border-subtle)] pt-4 text-xs leading-relaxed text-[var(--text-muted)] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p>
            <strong className="font-semibold text-[var(--text-secondary)]">
              {BUSINESS_IDENTITY.brandName}
            </strong>{' '}
            (Legal Name: {BUSINESS_IDENTITY.legalName}) · {BUSINESS_IDENTITY.officeAddress}
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a
              href={`mailto:${BUSINESS_IDENTITY.supportEmail}`}
              className="font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
            >
              {BUSINESS_IDENTITY.supportEmail}
            </a>
            <span aria-hidden="true">·</span>
            <a
              href={BUSINESS_IDENTITY.officialWebsite}
              className="hover:text-[var(--text-primary)] hover:underline"
            >
              {BUSINESS_IDENTITY.officialWebsite}
            </a>
            <span aria-hidden="true">·</span>
            <Link
              href="/login"
              rel="nofollow"
              className="hover:text-[var(--text-primary)] hover:underline"
            >
              Partner Login
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
