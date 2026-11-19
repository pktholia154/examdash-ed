import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPageServerShell } from '@/components/templates/LegalPageServerShell';
import { BUSINESS_IDENTITY } from '@/lib/compliance/business-info';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildLegalPageGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';

const PAGE_PATH = '/terms-of-service';
const PAGE_TITLE = 'Terms of Service';
const PAGE_DESCRIPTION =
  'Terms of Service governing purchases, accounts, Razorpay payments, and digital access on Exam Kart (exam-dash.com), operated by Pardeep Kumar.';

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

export default function TermsOfServicePage() {
  const graph = buildLegalPageGraph(getCanonicalBaseUrl(), {
    path: PAGE_PATH,
    name: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
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
        summary={`These Terms of Service govern your use of ${BUSINESS_IDENTITY.officialWebsite} operated under the brand name ${BUSINESS_IDENTITY.brandName} by ${BUSINESS_IDENTITY.legalName}. By accessing or purchasing any digital product, you agree to these terms.`}
      >
        <h3>1. Platform &amp; Operator Identity</h3>
        <p>
          {BUSINESS_IDENTITY.brandName} is an online educational platform accessible at{' '}
          <a href={BUSINESS_IDENTITY.officialWebsite}>{BUSINESS_IDENTITY.officialWebsite}</a> and legally
          operated by <strong>{BUSINESS_IDENTITY.legalName}</strong> from {BUSINESS_IDENTITY.officeAddress}.
          The platform provides digital study books, MCQ question banks, and interactive online mock
          examinations (&ldquo;Digital Products&rdquo;).
        </p>

        <h3>2. Eligibility &amp; User Accounts</h3>
        <p>
          To purchase paid study materials or save mock test performance, you must authenticate with a valid
          account and provide accurate registration details. If you are under 18 years of age, you may use
          the platform only under the supervision of a parent or legal guardian who agrees to be bound by
          these Terms. You are responsible for maintaining the confidentiality of your login credentials and
          all activity occurring under your account.
        </p>

        <h3>3. Pricing, Payments &amp; Digital Fulfillment</h3>
        <ul>
          <li>
            <strong>Currency &amp; Pricing:</strong> All listed prices are displayed clearly on product pages
            and in the cart prior to checkout (typically in Indian Rupees, INR). Prices are subject to
            change without affecting orders already completed.
          </li>
          <li>
            <strong>Payment Processing:</strong> Online payments are processed securely via{' '}
            <strong>Razorpay</strong> (supporting UPI, debit/credit cards, netbanking, and supported wallets).
            An order is deemed confirmed only after cryptographic payment verification completes on our server.
          </li>
          <li>
            <strong>Instant Digital Delivery:</strong> Because our offerings are purely digital, access to
            purchased books and online exam packs is unlocked inside your{' '}
            <Link href="/purchased">Purchased Library</Link> immediately upon successful payment verification.
            No physical shipping is involved.
          </li>
        </ul>

        <h3>4. Acceptable Use &amp; Restrictions</h3>
        <p>You agree not to misuse the platform or its digital contents. Specifically, you must not:</p>
        <ul>
          <li>
            Share account credentials across multiple individuals or resell access to your library.
          </li>
          <li>
            Scrape, crawl programmatically beyond public robots rules, bulk-download, copy, or redistribute
            paid PDFs, Markdown notes, or exam questions on third-party channels, websites, or messaging groups.
          </li>
          <li>
            Attempt to bypass paywalls, tamper with Razorpay payment verification endpoints, or disrupt
            platform availability.
          </li>
        </ul>

        <h3>5. Intellectual Property</h3>
        <p>
          All platform code, visual design, question sets, study notes, and branding under{' '}
          {BUSINESS_IDENTITY.brandName} belong to <strong>{BUSINESS_IDENTITY.legalName}</strong> or the
          respective content publishers/licensors. Purchasing an item grants usage rights strictly in
          accordance with our <Link href="/license-agreement">License Agreement</Link> and does not
          transfer ownership or copyright.
        </p>

        <h3>6. Refunds &amp; Cancellations</h3>
        <p>
          All cancellations, failed-transaction adjustments, and refund requests are governed by our{' '}
          <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link>.
        </p>

        <h3>7. Educational Disclaimer &amp; Limitation of Liability</h3>
        <p>
          All study books and practice test series are provided as supplementary educational preparation
          resources on an &ldquo;as-is&rdquo; and &ldquo;as-available&rdquo; basis. While we strive for
          accuracy, {BUSINESS_IDENTITY.brandName} does not guarantee specific examination scores, ranks, or
          selection outcomes. To the maximum extent permitted by applicable Indian law, our aggregate
          liability arising out of any transaction shall not exceed the purchase price actually paid by you
          for the specific Digital Product in dispute.
        </p>

        <h3>8. Governing Law &amp; Dispute Resolution</h3>
        <p>
          These Terms are governed by and construed in accordance with the laws of India. Subject to
          applicable consumer protection laws, courts in <strong>{BUSINESS_IDENTITY.jurisdiction}</strong>{' '}
          shall have exclusive jurisdiction over any disputes arising under these Terms.
        </p>

        <h3>9. Contact Information</h3>
        <p>
          Questions regarding these Terms may be sent to{' '}
          <a href={`mailto:${BUSINESS_IDENTITY.supportEmail}`}>{BUSINESS_IDENTITY.supportEmail}</a> or mailed
          to {BUSINESS_IDENTITY.legalName}, {BUSINESS_IDENTITY.officeAddress}.
        </p>
      </LegalPageServerShell>
    </>
  );
}
