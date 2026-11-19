import React from 'react';
import type { Metadata } from 'next';
import { LegalPageServerShell } from '@/components/templates/LegalPageServerShell';
import { BUSINESS_IDENTITY } from '@/lib/compliance/business-info';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildLegalPageGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';

const PAGE_PATH = '/privacy-policy';
const PAGE_TITLE = 'Privacy Policy';
const PAGE_DESCRIPTION =
  'Privacy Policy for Exam Kart (exam-dash.com), operated by Pardeep Kumar. Explains account data, Razorpay payment security, local storage, and grievance redressal.';

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

export default function PrivacyPolicyPage() {
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
        summary={`This Privacy Policy describes how ${BUSINESS_IDENTITY.brandName} (operated by Legal Entity: ${BUSINESS_IDENTITY.legalName}) collects, uses, processes, and protects personal information on ${BUSINESS_IDENTITY.officialWebsite}.`}
      >
        <h3>1. Entity &amp; Scope</h3>
        <p>
          <strong>{BUSINESS_IDENTITY.brandName}</strong> is operated by{' '}
          <strong>{BUSINESS_IDENTITY.legalName}</strong>, with its principal office located at{' '}
          {BUSINESS_IDENTITY.officeAddress} (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;).
          This Privacy Policy applies to all visitors, registered learners, and purchasers accessing digital
          study books, MCQ question banks, and online mock exam series via{' '}
          <a href={BUSINESS_IDENTITY.officialWebsite}>{BUSINESS_IDENTITY.officialWebsite}</a>.
        </p>

        <h3>2. Information We Collect</h3>
        <ul>
          <li>
            <strong>Account Information:</strong> When you sign in using Google / Firebase Authentication,
            we receive your name, email address, unique user identifier (UID), and profile picture URL so
            we can maintain your purchased library and exam attempt history.
          </li>
          <li>
            <strong>Order &amp; Payment Metadata:</strong> When you purchase a digital book or mock test
            pack, we store order identifiers, Razorpay order/payment reference IDs, purchased item IDs,
            timestamps, and INR amount paid for access fulfillment, invoicing, and support reconciliation.
          </li>
          <li>
            <strong>Payment Card &amp; Banking Credentials (Never Stored by Us):</strong> All online
            payments are processed through <strong>Razorpay Software Private Limited</strong>. We never
            collect, view, or store your debit/credit card numbers, CVV, UPI PINs, or netbanking passwords
            on our servers; such sensitive financial data is encrypted and handled directly by Razorpay
            under PCI-DSS security standards.
          </li>
          <li>
            <strong>Learning Telemetry &amp; Local Storage:</strong> Bookmarks, reading positions, cart
            items, and exam responses may be cached locally in your browser (IndexedDB / local storage) to
            enable offline study continuity and synced securely to your authenticated account.
          </li>
        </ul>

        <h3>3. How We Use Information</h3>
        <ul>
          <li>To authenticate your account and verify payment signatures before unlocking digital content.</li>
          <li>To deliver eBooks (PDF/Markdown), online mock test packs, scores, and performance analytics.</li>
          <li>To prevent fraudulent transactions, unauthorized redistribution, or duplicate charges.</li>
          <li>To respond to technical support, refund inquiries, and legal compliance requests.</li>
        </ul>

        <h3>4. Data Sharing &amp; Third-Party Processors</h3>
        <p>
          We do not sell, rent, or trade your personal information to marketers or data brokers. Personal
          data is shared strictly with essential service providers solely to operate the platform:
        </p>
        <ul>
          <li>
            <strong>Razorpay:</strong> Payment gateway processing, UPI/card settlement, signature
            verification, and refund execution.
          </li>
          <li>
            <strong>Google Firebase / Cloud Infrastructure:</strong> User authentication, encrypted cloud
            database persistence, and static/media delivery.
          </li>
          <li>
            <strong>Legal Disclosures:</strong> Where required by Indian law, court order, or regulatory
            authority.
          </li>
        </ul>

        <h3>5. Data Retention &amp; Security</h3>
        <p>
          We retain your account and transaction records for as long as your account remains active or as
          required for statutory accounting, tax, and dispute-resolution obligations under applicable Indian
          law. All traffic is encrypted in transit via HTTPS/TLS, and sensitive API verification is
          performed exclusively on secured server endpoints.
        </p>

        <h3>6. Your Rights &amp; Data Deletion</h3>
        <p>
          You may request access to, correction of, or deletion of your personal account data (subject to
          mandatory financial transaction recordkeeping) by writing to{' '}
          <a href={`mailto:${BUSINESS_IDENTITY.supportEmail}`}>{BUSINESS_IDENTITY.supportEmail}</a> from
          your registered email address.
        </p>

        <h3>7. Grievance Officer &amp; Contact</h3>
        <p>
          In accordance with the Information Technology Act, 2000 and applicable data protection rules in
          India, any privacy concern or grievance may be addressed to:
        </p>
        <ul>
          <li>
            <strong>Grievance Officer / Legal Name:</strong> {BUSINESS_IDENTITY.legalName}
          </li>
          <li>
            <strong>Brand Name:</strong> {BUSINESS_IDENTITY.brandName}
          </li>
          <li>
            <strong>Email:</strong>{' '}
            <a href={`mailto:${BUSINESS_IDENTITY.supportEmail}`}>{BUSINESS_IDENTITY.supportEmail}</a>
          </li>
          <li>
            <strong>Office Address:</strong> {BUSINESS_IDENTITY.officeAddress}
          </li>
        </ul>
      </LegalPageServerShell>
    </>
  );
}
