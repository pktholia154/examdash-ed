import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2, Clock, Globe, Mail, MapPin } from 'lucide-react';
import { LegalPageServerShell } from '@/components/templates/LegalPageServerShell';
import { BUSINESS_IDENTITY } from '@/lib/compliance/business-info';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildContactPageGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';

const PAGE_PATH = '/contact-us';
const PAGE_TITLE = 'Contact Us';
const PAGE_DESCRIPTION =
  'Official Contact Us page for Exam Kart (exam-dash.com), operated by Pardeep Kumar. Email support@exam-kart.com or reach our Bhiwani, Haryana office.';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_PATH },
  openGraph: {
    type: 'website',
    url: PAGE_PATH,
    title: `${PAGE_TITLE} — ${BUSINESS_IDENTITY.brandName}`,
    description: PAGE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${PAGE_TITLE} — ${BUSINESS_IDENTITY.brandName}`,
    description: PAGE_DESCRIPTION,
  },
};

export default function ContactUsPage() {
  const graph = buildContactPageGraph(getCanonicalBaseUrl(), {
    legalName: BUSINESS_IDENTITY.legalName,
    brandName: BUSINESS_IDENTITY.brandName,
    email: BUSINESS_IDENTITY.supportEmail,
    address: BUSINESS_IDENTITY.officeAddress,
    website: BUSINESS_IDENTITY.officialWebsite,
    dateModified: BUSINESS_IDENTITY.policyEffectiveIso,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: escapeJsonLd(graph) }}
      />
      <LegalPageServerShell
        currentPath={PAGE_PATH}
        title={PAGE_TITLE}
        summary={`Reach the ${BUSINESS_IDENTITY.brandName} support and billing team for order help, Razorpay payment verification queries, refund requests, or legal correspondence.`}
      >
        <section
          aria-label="Official Business and Contact Information"
          className="not-prose grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              <Building2 className="h-4 w-4" aria-hidden="true" />
              <span>Business Identity</span>
            </div>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Brand Name</dt>
                <dd className="font-semibold text-[var(--text-primary)]">
                  {BUSINESS_IDENTITY.brandName}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Legal Name (Proprietor)</dt>
                <dd className="font-medium text-[var(--text-primary)]">
                  {BUSINESS_IDENTITY.legalName}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Official Website</dt>
                <dd>
                  <a
                    href={BUSINESS_IDENTITY.officialWebsite}
                    className="inline-flex items-center gap-1.5 font-medium text-[var(--brand-accent)] underline underline-offset-4"
                  >
                    <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{BUSINESS_IDENTITY.officialWebsite}</span>
                  </a>
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              <Mail className="h-4 w-4" aria-hidden="true" />
              <span>Customer Support &amp; Grievance</span>
            </div>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Support Email</dt>
                <dd>
                  <a
                    href={`mailto:${BUSINESS_IDENTITY.supportEmail}`}
                    className="font-semibold text-[var(--brand-accent)] underline underline-offset-4"
                  >
                    {BUSINESS_IDENTITY.supportEmail}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Support Hours</dt>
                <dd className="inline-flex items-center gap-1.5 text-[var(--text-primary)]">
                  <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                  <span>{BUSINESS_IDENTITY.supportHours}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-muted)]">Typical Response Time</dt>
                <dd className="text-[var(--text-secondary)]">{BUSINESS_IDENTITY.responseSla}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-5 sm:col-span-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              <span>Registered Office Address</span>
            </div>
            <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">
              {BUSINESS_IDENTITY.legalName} ({BUSINESS_IDENTITY.brandName})
              <br />
              {BUSINESS_IDENTITY.officeAddress}
            </p>
          </div>
        </section>

        <h3>Payment, Order &amp; Technical Support Guidance</h3>
        <p>
          If your inquiry relates to an online payment via Razorpay, a missing book/exam unlock, or a refund
          request under our <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link>, please email{' '}
          <a href={`mailto:${BUSINESS_IDENTITY.supportEmail}`}>{BUSINESS_IDENTITY.supportEmail}</a> with:
        </p>
        <ul>
          <li>Your registered sign-in email address</li>
          <li>The Order ID and Razorpay Payment ID from your confirmation receipt or UPI/bank alert</li>
          <li>The title of the study book or online exam pack</li>
          <li>A brief description or screenshot of the error message</li>
        </ul>

        <h3>Grievance Redressal</h3>
        <p>
          For escalated billing disputes, privacy concerns, or copyright notices, address your email to the
          Grievance Officer (<strong>{BUSINESS_IDENTITY.legalName}</strong>) at{' '}
          <a href={`mailto:${BUSINESS_IDENTITY.supportEmail}`}>{BUSINESS_IDENTITY.supportEmail}</a> or send
          physical correspondence to {BUSINESS_IDENTITY.officeAddress}.
        </p>
      </LegalPageServerShell>
    </>
  );
}
