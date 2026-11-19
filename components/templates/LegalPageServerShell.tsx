import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { SiteChromeShell } from '@/components/organisms/SiteChromeShell';
import {
  BUSINESS_IDENTITY,
  COMPLIANCE_PAGE_LINKS,
} from '@/lib/compliance/business-info';

export interface LegalPageServerShellProps {
  readonly currentPath: string;
  readonly title: string;
  readonly summary: string;
  readonly children: React.ReactNode;
}

/**
 * 100% Server-Rendered Compliance & Legal Document Template.
 * Matches the white monochrome editorial aesthetic with seamless typography,
 * single `<h1>`, zero hard visual clutter, and complete first-byte HTML output.
 */
export function LegalPageServerShell({
  currentPath,
  title,
  summary,
  children,
}: LegalPageServerShellProps) {
  return (
    <SiteChromeShell>
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <li>
              <Link
                href="/"
                className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Home</span>
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-[var(--text-primary)]">
              {title}
            </li>
          </ol>
        </nav>

        <header className="space-y-3 border-b border-[var(--border-subtle)] pb-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-[var(--text-muted)]">
            <span>{BUSINESS_IDENTITY.brandName}</span>
            <span aria-hidden="true">·</span>
            <span>Legal Entity: {BUSINESS_IDENTITY.legalName}</span>
            <span aria-hidden="true">·</span>
            <span>Last Updated: {BUSINESS_IDENTITY.policyEffectiveDate}</span>
          </div>

          <h1 className="text-balance text-hero font-bold text-[var(--text-primary)]">
            {title}
          </h1>

          <p className="text-sm leading-relaxed text-[var(--text-secondary)] sm:text-base">
            {summary}
          </p>
        </header>

        <article className="seo-overview-prose">{children}</article>

        <section
          aria-label="Legal and compliance pages"
          className="border-t border-[var(--border-subtle)] pt-6"
        >
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Related Policies &amp; Support
          </h2>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--text-secondary)]">
            {COMPLIANCE_PAGE_LINKS.map((item) => {
              const isActive = item.href === currentPath;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={
                      isActive
                        ? 'font-semibold text-[var(--text-primary)] underline underline-offset-4'
                        : 'hover:text-[var(--text-primary)] hover:underline hover:underline-offset-4'
                    }
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </SiteChromeShell>
  );
}
