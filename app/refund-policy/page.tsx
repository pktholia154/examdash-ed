import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPageServerShell } from '@/components/templates/LegalPageServerShell';
import { BUSINESS_IDENTITY } from '@/lib/compliance/business-info';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildLegalPageGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';

const PAGE_PATH = '/refund-policy';
const PAGE_TITLE = 'Refund & Cancellation Policy';
const PAGE_DESCRIPTION =
  'Refund & Cancellation Policy for Exam Kart (exam-dash.com). Covers digital study books, online exam packs, failed/duplicate Razorpay transactions, and refund timelines.';

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

export default function RefundPolicyPage() {
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
        summary={`Transparent cancellation and refund guidelines for digital books and online mock test packs purchased on ${BUSINESS_IDENTITY.brandName} (${BUSINESS_IDENTITY.officialWebsite}), operated by ${BUSINESS_IDENTITY.legalName}.`}
      >
        <h3>1. Nature of Products &amp; Cancellation Policy</h3>
        <p>
          All products offered on <strong>{BUSINESS_IDENTITY.brandName}</strong> are non-tangible,
          electronic digital goods (PDF/Markdown study books and online computer-based mock exam packs).
          Because digital access is provisioned and unlocked inside your account immediately after successful
          Razorpay payment confirmation, <strong>orders cannot be cancelled once digital access has been
          delivered</strong>.
        </p>
        <p>
          We encourage learners to review each book or exam pack&rsquo;s free sample preview, syllabus
          overview, and compatibility notes on the product detail page before completing payment.
        </p>

        <h3>2. Cases Eligible for Refund</h3>
        <p>A full or appropriate refund will be issued in the following verified situations:</p>
        <ul>
          <li>
            <strong>Payment Debited Without Access (Failed / Pending Gateway Callback):</strong> If money is
            debited from your bank account, UPI app, or card due to a network interruption and the purchased
            item is not unlocked in your account, we will either reconcile and unlock the order at your
            request or issue a <strong>100% refund</strong> to your original payment method.
          </li>
          <li>
            <strong>Duplicate Payment:</strong> If you were inadvertently charged twice for the same digital
            book or exam pack under the same account, the duplicate charge will be refunded in full upon
            verification.
          </li>
          <li>
            <strong>Unresolved Technical Defect:</strong> If a purchased digital book fails to load or an
            online mock test pack cannot be accessed due to a verified platform defect on our end that our
            technical team cannot resolve within 3 business days of reporting, you may request a refund within{' '}
            <strong>7 calendar days</strong> of the purchase date.
          </li>
        </ul>

        <h3>3. Non-Refundable Situations</h3>
        <ul>
          <li>Change of mind, exam date postponement, or personal preference after digital access is unlocked.</li>
          <li>Purchases where substantial portions of the book or mock tests have already been accessed or attempted without any platform defect.</li>
          <li>Account suspension caused by violation of our <Link href="/terms-of-service">Terms of Service</Link> or <Link href="/license-agreement">License Agreement</Link> (such as unauthorized sharing or piracy).</li>
        </ul>

        <h3>4. How to Request a Refund or Resolution</h3>
        <p>
          To submit a refund or failed-transaction request, please email{' '}
          <a href={`mailto:${BUSINESS_IDENTITY.supportEmail}`}>{BUSINESS_IDENTITY.supportEmail}</a> within{' '}
          <strong>7 days</strong> of the transaction with the following details:
        </p>
        <ul>
          <li>Registered account email address</li>
          <li>Order ID and Razorpay Payment ID (e.g., <code>pay_...</code>)</li>
          <li>Transaction date, amount (INR), and a brief description of the issue (plus screenshot if applicable)</li>
        </ul>

        <h3>5. Refund Processing Timeline</h3>
        <ul>
          <li>
            <strong>Verification &amp; Response:</strong> Our support team reviews all requests within{' '}
            <strong>24–48 business hours</strong> ({BUSINESS_IDENTITY.supportHours}).
          </li>
          <li>
            <strong>Settlement Period:</strong> Once approved, refunds are initiated via Razorpay back to the{' '}
            <strong>original payment source</strong> (UPI, bank account, or card) and typically reflect in
            your statement within <strong>5–7 working days</strong>, depending on your issuing bank or
            payment provider.
          </li>
        </ul>

        <h3>6. Billing &amp; Refund Support Contact</h3>
        <p>
          <strong>{BUSINESS_IDENTITY.brandName}</strong> (Legal Name: {BUSINESS_IDENTITY.legalName})<br />
          Email:{' '}
          <a href={`mailto:${BUSINESS_IDENTITY.supportEmail}`}>{BUSINESS_IDENTITY.supportEmail}</a>
          <br />
          Address: {BUSINESS_IDENTITY.officeAddress}
        </p>
      </LegalPageServerShell>
    </>
  );
}
