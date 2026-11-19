import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBookDetailGraph,
  buildExamDetailGraph,
  buildHomeCollectionGraph,
  buildHubCollectionGraph,
  buildOrganizationGraph,
  normalizeLanguageTag,
} from './structured-data';
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
import { getCanonicalBaseUrl } from './structured-data';
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
  tags: ['Indian History'],
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

test('JSON-LD graphs link via @id, use real hub breadcrumbs, and omit banned/fake schemas', () => {
  const baseUrl = 'https://examdash.example';
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

  // Strict GSC Compliance: zero deprecated/restricted/fake schemas
  for (const forbidden of ['FAQPage', 'HowTo', 'SpecialAnnouncement', 'SearchAction', 'AggregateRating', '"Review"']) {
    assert.equal(combinedJson.includes(forbidden), false, `Must not emit ${forbidden}`);
  }

  // Book breadcrumbs must use real /books URL (never /#books fragment)
  const bookBreadcrumb = bookGraph['@graph'].find((n) => n['@type'] === 'BreadcrumbList') as {
    itemListElement: Array<{ item: string }>;
  };
  assert.equal(bookBreadcrumb.itemListElement[1].item, 'https://examdash.example/books');

  // Exam breadcrumbs must use real /exams URL (never /#exams fragment)
  const examBreadcrumb = examGraph['@graph'].find((n) => n['@type'] === 'BreadcrumbList') as {
    itemListElement: Array<{ item: string }>;
  };
  assert.equal(examBreadcrumb.itemListElement[1].item, 'https://examdash.example/exams');

  // Book node uses clean BCP-47 language & ISO-8601 date
  assert.equal(normalizeLanguageTag('English'), 'en');
  assert.equal(normalizeLanguageTag('Hindi'), 'hi');
  const bookNode = bookGraph['@graph'].find((n) => n['@type'] === 'Book') as Record<string, unknown>;
  assert.equal(bookNode.inLanguage, 'en');
  assert.equal(bookNode.dateModified, '2026-11-18T10:35:03.412Z');
});

test('Sitemap builder produces valid sharded index & urlset XML without priority/changefreq', () => {
  assert.equal(computeShardCount(0, 5000), 0);
  assert.equal(computeShardCount(1, 5000), 1);
  assert.equal(computeShardCount(5001, 5000), 2);
  assert.deepEqual(sliceShard(['a', 'b', 'c'], 1, 2), ['c']);

  const latest = getLatestTimestamp(['2026-11-18T10:00:00Z', '2026-11-18T16:40:24.066Z', null, 'invalid']);
  assert.equal(latest, '2026-11-18T16:40:24.066Z');

  const indexXml = buildSitemapIndexXml([
    { loc: 'https://examdash.example/sitemaps/pages.xml', lastmod: latest },
  ]);
  assert.equal(indexXml.includes('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), true);
  assert.equal(indexXml.includes('<lastmod>2026-11-18T16:40:24.066Z</lastmod>'), true);

  const urlsetXml = buildSitemapUrlsetXml([
    {
      loc: 'https://examdash.example/books/b1',
      lastmod: '2026-11-18T10:35:03.412Z',
      images: [{ loc: 'https://examdash.example/pwa-512x512.png', title: 'ExamDash & Co' }],
    },
  ]);
  assert.equal(urlsetXml.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'), true);
  assert.equal(urlsetXml.includes('<image:title>ExamDash &amp; Co</image:title>'), true);
  assert.equal(urlsetXml.includes('<priority>'), false);
  assert.equal(urlsetXml.includes('<changefreq>'), false);
});

test('IndexNow payload builder filters foreign hosts and sets keyLocation', () => {
  const payload = buildIndexNowPayload('https://examdash.example', 'abc123456789', [
    '/books/b1',
    'https://examdash.example/exams/e1',
    'https://evil.example/phish',
  ]);
  assert.ok(payload);
  assert.equal(payload.host, 'examdash.example');
  assert.equal(payload.keyLocation, 'https://examdash.example/abc123456789.txt');
  assert.deepEqual(payload.urlList, [
    'https://examdash.example/books/b1',
    'https://examdash.example/exams/e1',
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

  // getCanonicalBaseUrl normalizes trailing slashes cleanly
  const prev = process.env.CANONICAL_APP_URL;
  process.env.CANONICAL_APP_URL = 'https://exam-dash.com/';
  try {
    assert.equal(getCanonicalBaseUrl(), 'https://exam-dash.com');
  } finally {
    if (prev === undefined) delete process.env.CANONICAL_APP_URL;
    else process.env.CANONICAL_APP_URL = prev;
  }
});
