import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CANONICAL_ORIGIN,
  buildBookDetailGraph,
  buildContactPageGraph,
  buildExamDetailGraph,
  buildHomeCollectionGraph,
  buildHubCollectionGraph,
  buildLegalPageGraph,
  buildOrganizationGraph,
  filterConflictingPriceTags,
  getCanonicalBaseUrl,
  getCatalogThumbnailUrl,
  normalizeLanguageTag,
} from './structured-data';
import { selectRelatedCatalogItems } from './related-items';
import {
  BUSINESS_IDENTITY,
  COMPLIANCE_PAGE_LINKS,
} from '../compliance/business-info';
import {
  buildSitemapIndexXml,
  buildSitemapUrlsetXml,
  computeShardCount,
  getLatestTimestamp,
  sliceShard,
} from './sitemap-builder';
import { buildIndexNowPayload } from './indexnow';
import {
  buildCanonicalRedirectUrl,
  evaluateHostPolicy,
  normalizeHostname,
} from './host-policy';
import { getCapacitorPlatform, isNativeCapacitorPlatform } from '@/core/adapters/capacitor';
import type { PublicBookDTO, PublicExamPackDTO } from '@/lib/design-system/types';

const SAMPLE_BOOK: PublicBookDTO = {
  id: 'B1',
  contentType: 'books',
  title: 'Indian History MCQs (Free Sample Book)',
  urlSlug: 'indian-history-mcqs-free-sample-book-b1',
  seoDescription: 'Indian History Question Bank (Free Sample Book)',
  fullDescription: '# Indian History\\n\\n**Bold** overview text.',
  type: 'Question Bank',
  language: 'English',
  publisher: 'MT',
  authorName: 'MT',
  tags: ['Free Book', 'Indian History'],
  currency: 'INR',
  listPrice: 120,
  buyPrice: 100,
  sampleMarkdownUrl: 'https://example.com/sample.md',
  samplePdfUrl: 'https://example.com/sample.pdf',
  hasFullPdf: true,
  hasFullMarkdown: true,
  createdAt: '2026-11-18T10:35:03.412Z',
  updatedAt: '2026-11-18T10:35:03.412Z',
  publishAt: '2026-11-18T10:34:49.453925Z',
};

const SAMPLE_EXAM: PublicExamPackDTO = {
  id: 'E1',
  contentType: 'exams',
  title: 'Online exam IBPS',
  urlSlug: 'online-exam-ibps-e1',
  seoDescription: 'Online exam IBPS',
  fullDescription: 'Online exam IBPS',
  type: 'TEST_SERIES',
  language: 'English',
  publisher: 'MT',
  authorName: 'MT',
  tags: ['IBPS'],
  currency: 'INR',
  listPrice: 300,
  buyPrice: 200,
  totalMocktest: 2,
  mocktestTitles: [
    { id: 'exam_set_1', title: 'IBPS Clerk Prelims Mock Set 01', duration: 60, totalQuestions: 12, totalMarks: 12 },
  ],
  sampleJsonStoragePath: 'public/exam_samples/E1_sample.json',
  createdAt: '2026-11-18T16:40:24.066Z',
  updatedAt: '2026-11-18T16:40:24.066Z',
  publishAt: '2026-11-18T16:37:22.873506Z',
};

test('getCanonicalBaseUrl never leaks localhost or preview Cloud Run origins and defaults to https://exam-dash.com', () => {
  const saved = {
    CANONICAL_APP_URL: process.env.CANONICAL_APP_URL,
    CANONICAL_HOST: process.env.CANONICAL_HOST,
    APP_URL: process.env.APP_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };

  try {
    delete process.env.CANONICAL_APP_URL;
    delete process.env.CANONICAL_HOST;
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.equal(getCanonicalBaseUrl(), DEFAULT_CANONICAL_ORIGIN);
    assert.equal(getCanonicalBaseUrl(), 'https://exam-dash.com');

    process.env.APP_URL = 'http://localhost:3000';
    assert.equal(getCanonicalBaseUrl(), 'https://exam-dash.com');

    process.env.APP_URL = 'https://ais-dev-abc123.asia-southeast1.run.app';
    assert.equal(getCanonicalBaseUrl(), 'https://exam-dash.com');

    process.env.CANONICAL_APP_URL = 'https://exam-dash.com/';
    assert.equal(getCanonicalBaseUrl(), 'https://exam-dash.com');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('JSON-LD graphs emit Product/Book & Product/Course rich results with PNG thumbnails and omit banned/fake schemas', () => {
  const baseUrl = 'https://exam-dash.com';
  const org = buildOrganizationGraph(baseUrl);
  const home = buildHomeCollectionGraph(baseUrl, [SAMPLE_BOOK], [SAMPLE_EXAM]);
  const hub = buildHubCollectionGraph(baseUrl, {
    path: '/books',
    name: 'Books',
    description: 'Study books',
    items: [{ title: SAMPLE_BOOK.title, urlSlug: SAMPLE_BOOK.urlSlug }],
  });
  const bookGraph = buildBookDetailGraph(baseUrl, SAMPLE_BOOK);
  const examGraph = buildExamDetailGraph(baseUrl, SAMPLE_EXAM);

  const combinedJson = JSON.stringify([org, home, hub, bookGraph, examGraph]);

  // Zero localhost leaks anywhere in JSON-LD
  assert.equal(combinedJson.includes('localhost'), false, 'JSON-LD must never include localhost');

  // Strict GSC Compliance: zero deprecated/restricted/fake schemas
  for (const forbidden of ['FAQPage', 'HowTo', 'SpecialAnnouncement', 'SearchAction', 'AggregateRating', '"Review"']) {
    assert.equal(combinedJson.includes(forbidden), false, `Must not emit ${forbidden}`);
  }

  // Book breadcrumbs must use real /books URL (never /#books fragment)
  const bookBreadcrumb = bookGraph['@graph'].find((n) => n['@type'] === 'BreadcrumbList') as {
    itemListElement: Array<{ item: string }>;
  };
  assert.equal(bookBreadcrumb.itemListElement[1].item, 'https://exam-dash.com/books');

  // Exam breadcrumbs must use real /exams URL
  const examBreadcrumb = examGraph['@graph'].find((n) => n['@type'] === 'BreadcrumbList') as {
    itemListElement: Array<{ item: string }>;
  };
  assert.equal(examBreadcrumb.itemListElement[1].item, 'https://exam-dash.com/exams');

  // Book node uses ["Product", "Book"], generated PNG thumbnail, MerchantReturnPolicy & ShippingDetails
  assert.equal(normalizeLanguageTag('English'), 'en');
  assert.equal(normalizeLanguageTag('Hindi'), 'hi');
  const bookNode = bookGraph['@graph'].find(
    (n) => Array.isArray(n['@type']) && n['@type'].includes('Book')
  ) as Record<string, unknown>;
  assert.deepEqual(bookNode['@type'], ['Product', 'Book']);
  assert.equal(bookNode.sku, 'B1');
  assert.deepEqual(bookNode.image, [
    getCatalogThumbnailUrl(baseUrl, 'books', SAMPLE_BOOK.urlSlug),
  ]);
  assert.equal(bookNode.inLanguage, 'en');
  assert.equal(bookNode.dateModified, '2026-11-18T10:35:03.412Z');
  // Conflicting "Free Book" tag is stripped for paid buyPrice=100 while preserving topical tag
  assert.equal(bookNode.keywords, 'Indian History');
  assert.deepEqual(filterConflictingPriceTags(['Free Book', 'Indian History'], 100), ['Indian History']);
  assert.deepEqual(filterConflictingPriceTags(['Free Book', 'Indian History'], 0), ['Free Book', 'Indian History']);

  const bookOffer = bookNode.offers as Record<string, unknown>;
  assert.equal(bookOffer.price, '100');
  assert.equal(bookOffer.priceCurrency, 'INR');
  assert.equal(bookOffer.availability, 'https://schema.org/InStock');
  assert.ok(bookOffer.hasMerchantReturnPolicy);
  assert.ok(bookOffer.shippingDetails);

  // Exam node uses ["Product", "Course"] with generated PNG thumbnail
  const examNode = examGraph['@graph'].find(
    (n) => Array.isArray(n['@type']) && n['@type'].includes('Course')
  ) as Record<string, unknown>;
  assert.deepEqual(examNode['@type'], ['Product', 'Course']);
  assert.deepEqual(examNode.image, [
    getCatalogThumbnailUrl(baseUrl, 'exams', SAMPLE_EXAM.urlSlug),
  ]);
});

test('selectRelatedCatalogItems ranks same-category items first and backfills cross-collection up to limit', () => {
  const book2: PublicBookDTO = { ...SAMPLE_BOOK, id: 'B2', urlSlug: 'b2', title: 'Book 2', type: 'Question Bank' };
  const book3: PublicBookDTO = { ...SAMPLE_BOOK, id: 'B3', urlSlug: 'b3', title: 'Book 3', type: 'Notes' };
  const exam2: PublicExamPackDTO = { ...SAMPLE_EXAM, id: 'E2', urlSlug: 'e2', title: 'Exam 2' };

  const selected = selectRelatedCatalogItems(SAMPLE_BOOK, [SAMPLE_BOOK, book3, book2], [SAMPLE_EXAM, exam2], 6);
  assert.deepEqual(
    selected.map((x) => `${x.contentType}:${x.id}`),
    ['books:B2', 'books:B3', 'exams:E1', 'exams:E2']
  );

  // When only 1 book exists, cross-collection exams still populate internal links
  const crossOnly = selectRelatedCatalogItems(SAMPLE_BOOK, [SAMPLE_BOOK], [SAMPLE_EXAM], 6);
  assert.deepEqual(
    crossOnly.map((x) => `${x.contentType}:${x.id}`),
    ['exams:E1']
  );
});

test('Capacitor guard safely reports web runtime outside native wrapper', () => {
  assert.equal(isNativeCapacitorPlatform(), false);
  assert.equal(getCapacitorPlatform(), 'web');
});

test('Sitemap builder produces valid sharded index & urlset XML without priority/changefreq', () => {
  assert.equal(computeShardCount(0, 5000), 0);
  assert.equal(computeShardCount(1, 5000), 1);
  assert.equal(computeShardCount(5001, 5000), 2);
  assert.deepEqual(sliceShard(['a', 'b', 'c'], 1, 2), ['c']);

  const latest = getLatestTimestamp(['2026-11-18T10:00:00Z', '2026-11-18T16:40:24.066Z', null, 'invalid']);
  assert.equal(latest, '2026-11-18T16:40:24.066Z');

  const indexXml = buildSitemapIndexXml([
    { loc: 'https://exam-dash.com/sitemaps/pages.xml', lastmod: latest },
  ]);
  assert.equal(indexXml.includes('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), true);
  assert.equal(indexXml.includes('<lastmod>2026-11-18T16:40:24.066Z</lastmod>'), true);

  const urlsetXml = buildSitemapUrlsetXml([
    {
      loc: 'https://exam-dash.com/books/b1',
      lastmod: '2026-11-18T10:35:03.412Z',
      images: [{ loc: 'https://exam-dash.com/books/b1/thumbnail.png', title: 'ExamDash & Co' }],
    },
  ]);
  assert.equal(urlsetXml.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'), true);
  assert.equal(urlsetXml.includes('<image:title>ExamDash &amp; Co</image:title>'), true);
  assert.equal(urlsetXml.includes('<priority>'), false);
  assert.equal(urlsetXml.includes('<changefreq>'), false);
});

test('IndexNow payload builder filters foreign hosts and sets keyLocation', () => {
  const payload = buildIndexNowPayload('https://exam-dash.com', 'abc123456789', [
    '/books/b1',
    'https://exam-dash.com/exams/e1',
    'https://evil.example/phish',
  ]);
  assert.ok(payload);
  assert.equal(payload.host, 'exam-dash.com');
  assert.equal(payload.keyLocation, 'https://exam-dash.com/abc123456789.txt');
  assert.deepEqual(payload.urlList, [
    'https://exam-dash.com/books/b1',
    'https://exam-dash.com/exams/e1',
  ]);
});

test('Host policy redirects production mirrors cleanly without port leaks while keeping preview hosts usable and noindex', () => {
  assert.equal(normalizeHostname('https://Exam-Dash.com/'), 'exam-dash.com');
  assert.equal(normalizeHostname('www.exam-dash.com:443'), 'www.exam-dash.com');
  assert.equal(normalizeHostname('exam-dash.com, 10.0.0.1:3000'), 'exam-dash.com');

  // Canonical host & localhost pass through normally
  assert.equal(
    evaluateHostPolicy({
      requestHost: 'exam-dash.com',
      canonicalHost: 'exam-dash.com',
      enforceCanonicalHost: true,
    }),
    'canonical'
  );
  assert.equal(
    evaluateHostPolicy({
      requestHost: 'localhost:3000',
      canonicalHost: 'exam-dash.com',
      enforceCanonicalHost: true,
    }),
    'canonical'
  );

  // AI Studio dev/preview hosts stay renderable in-iframe with X-Robots-Tag: noindex, nofollow
  assert.equal(
    evaluateHostPolicy({
      requestHost: 'ais-dev-abc123.asia-southeast1.run.app',
      canonicalHost: 'exam-dash.com',
      enforceCanonicalHost: true,
    }),
    'noindex'
  );
  assert.equal(
    evaluateHostPolicy({
      requestHost: 'ais-pre-xyz789.us-west1.run.app',
      canonicalHost: 'exam-dash.com',
      enforceCanonicalHost: true,
    }),
    'noindex'
  );

  // www and raw Cloud Run production mirrors 301-redirect when ENFORCE_CANONICAL_HOST=true
  assert.equal(
    evaluateHostPolicy({
      requestHost: 'www.exam-dash.com',
      canonicalHost: 'exam-dash.com',
      enforceCanonicalHost: true,
    }),
    'redirect'
  );
  assert.equal(
    evaluateHostPolicy({
      requestHost: 'examdash-service-12345.a.run.app',
      canonicalHost: 'exam-dash.com',
      enforceCanonicalHost: true,
    }),
    'redirect'
  );

  // Single-hop redirect strips ?page=1, normalizes hub casing, and never emits :3000
  const redirectUrl = buildCanonicalRedirectUrl(
    'https://exam-dash.com/',
    '/Books',
    new URLSearchParams('page=1&utm_source=google')
  );
  assert.equal(redirectUrl, 'https://exam-dash.com/books?utm_source=google');
});

test('Compliance pages and contact graphs include verified Razorpay merchant details and clean Schema.org markup', () => {
  assert.equal(COMPLIANCE_PAGE_LINKS.length, 5);
  assert.deepEqual(
    COMPLIANCE_PAGE_LINKS.map((l) => l.href),
    ['/privacy-policy', '/terms-of-service', '/refund-policy', '/license-agreement', '/contact-us']
  );

  assert.equal(BUSINESS_IDENTITY.legalName, 'Pardeep Kumar');
  assert.equal(BUSINESS_IDENTITY.brandName, 'Exam Kart');
  assert.equal(BUSINESS_IDENTITY.supportEmail, 'support@exam-kart.com');
  assert.equal(BUSINESS_IDENTITY.officialWebsite, 'https://exam-dash.com/');
  assert.equal(
    BUSINESS_IDENTITY.officeAddress,
    '1st Floor, SCO-28, Sector 13, Bhiwani, Haryana 127021, India'
  );

  const legalGraph = buildLegalPageGraph('https://exam-dash.com', {
    path: '/refund-policy',
    name: 'Refund & Cancellation Policy',
    description: 'Refund & Cancellation Policy for Exam Kart',
    dateModified: BUSINESS_IDENTITY.policyEffectiveIso,
  });
  assert.equal(legalGraph['@graph'][0]['@type'], 'WebPage');
  assert.equal(legalGraph['@graph'][0].url, 'https://exam-dash.com/refund-policy');

  const contactGraph = buildContactPageGraph('https://exam-dash.com', {
    legalName: BUSINESS_IDENTITY.legalName,
    brandName: BUSINESS_IDENTITY.brandName,
    email: BUSINESS_IDENTITY.supportEmail,
    address: BUSINESS_IDENTITY.officeAddress,
    website: BUSINESS_IDENTITY.officialWebsite,
    dateModified: BUSINESS_IDENTITY.policyEffectiveIso,
  });
  const json = JSON.stringify(contactGraph);
  assert.equal(contactGraph['@graph'][0]['@type'], 'ContactPage');
  assert.equal(json.includes('Pardeep Kumar'), true);
  assert.equal(json.includes('Exam Kart'), true);
  assert.equal(json.includes('support@exam-kart.com'), true);
  assert.equal(json.includes('1st Floor, SCO-28, Sector 13, Bhiwani, Haryana 127021, India'), true);
  assert.equal(json.includes('FAQPage'), false);
});
