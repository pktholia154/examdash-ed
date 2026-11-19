import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPageServerShell } from '@/components/templates/LegalPageServerShell';
import { BUSINESS_IDENTITY } from '@/lib/compliance/business-info';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildLegalPageGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';

const PAGE_PATH = '/license-agreement';
const PAGE_TITLE = 'License Agreement';
const PAGE_DESCRIPTION =
  'End-User License Agreement (EULA) for digital study books, PDFs, Markdown notes, and online exam mock tests on Exam Kart (exam-dash.com).';

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

export default function LicenseAgreementPage() {
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
        summary={`End-User License Agreement (EULA) setting forth the permitted single-user personal study rights and restrictions for all digital books and exam packs on ${BUSINESS_IDENTITY.brandName}.`}
      >
        <h3>1. Parties to This Agreement</h3>
        <p>
          This End-User License Agreement (&ldquo;Agreement&rdquo;) is entered into between you
          (&ldquo;Licensee&rdquo; or &ldquo;User&rdquo;) and{' '}
          <strong>{BUSINESS_IDENTITY.legalName}</strong>, operating under the brand name{' '}
          <strong>{BUSINESS_IDENTITY.brandName}</strong> at{' '}
          <a href={BUSINESS_IDENTITY.officialWebsite}>{BUSINESS_IDENTITY.officialWebsite}</a>{' '}
          (&ldquo;Licensor&rdquo;). By downloading, opening, or accessing any digital book, study guide,
          or online mock test pack, you agree to comply with this Agreement.
        </p>

        <h3>2. Grant of Personal Study License</h3>
        <p>
          Subject to full payment (where applicable) and ongoing compliance with our{' '}
          <Link href="/terms-of-service">Terms of Service</Link>, Licensor grants you a{' '}
          <strong>
            limited, non-exclusive, non-transferable, non-sublicensable, revocable personal license
          </strong>{' '}
          to access and read the licensed Digital Products solely for your own individual, non-commercial
          educational and competitive examination preparation.
        </p>

        <h3>3. Permitted Uses</h3>
        <ul>
          <li>Viewing and reading purchased study books inside the integrated PDF or Markdown reader on your personal devices.</li>
          <li>Using built-in offline caching on your authorized browser/device solely for personal study continuity.</li>
          <li>Attempting licensed online mock tests and reviewing post-exam score analytics for self-evaluation.</li>
        </ul>

        <h3>4. Strict Restrictions</h3>
        <p>All Digital Products are licensed, not sold. Under this Agreement, you may <strong>not</strong>:</p>
        <ul>
          <li>
            Copy, reproduce, mirror, upload, or distribute any PDF, Markdown text, question bank, or answer
            explanation to websites, cloud drives, Telegram/WhatsApp groups, coaching portals, or peer
            networks.
          </li>
          <li>
            Rent, lease, sell, sublicense, loan, or commercially exploit any part of the content, whether
            modified or unmodified.
          </li>
          <li>
            Use automated bots, scrapers, screen-recording tools, or AI-dataset harvesters to extract
            question banks or book text in bulk.
          </li>
          <li>
            Remove, obscure, or alter copyright notices, publisher attributions, or digital identifiers
            embedded in the material.
          </li>
        </ul>

        <h3>5. Ownership &amp; Intellectual Property Rights</h3>
        <p>
          {BUSINESS_IDENTITY.legalName} ({BUSINESS_IDENTITY.brandName}) and its respective partner authors
          and publishers retain all right, title, copyright, and intellectual property interests in every
          Digital Product. No ownership rights pass to the Licensee.
        </p>

        <h3>6. Free Samples &amp; Open Previews</h3>
        <p>
          Sample books, sample chapters, or free preview mock tests offered at zero cost are licensed under
          these exact same non-commercial personal study restrictions unless expressly marked otherwise on the
          product detail page.
        </p>

        <h3>7. Termination for Breach</h3>
        <p>
          This license terminates immediately without refund if you violate any restriction in Section 4.
          Upon termination, you must cease accessing the materials and purge any locally cached copies.
          Licensor reserves the right to pursue remedies available under the Copyright Act, 1957 (India) and
          the Information Technology Act, 2000.
        </p>

        <h3>8. Licensing Inquiries</h3>
        <p>
          For institutional licensing, publisher permissions, or DMCA/copyright notices, please contact{' '}
          <a href={`mailto:${BUSINESS_IDENTITY.supportEmail}`}>{BUSINESS_IDENTITY.supportEmail}</a> or write
          to {BUSINESS_IDENTITY.legalName}, {BUSINESS_IDENTITY.officeAddress}.
        </p>
      </LegalPageServerShell>
    </>
  );
}
