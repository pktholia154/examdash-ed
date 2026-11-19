import type { PublicBookDTO, PublicExamPackDTO } from '@/lib/design-system/types';
import { buildCleanMetaDescription, stripMarkdownToPlainText } from './overview-markdown';
import { normalizeIsoTimestamp } from './sitemap-builder';

export function getCanonicalBaseUrl(): string {
  const raw = (
    process.env.CANONICAL_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000'
  ).trim();

  if (!raw) return 'http://localhost:3000';

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).origin;
  } catch {
    return withProtocol.replace(/\/+$/, '');
  }
}

/**
 * Maps human-readable language labels from Firestore into BCP-47 tags for Schema.org `inLanguage`.
 */
export function normalizeLanguageTag(language?: string | null): string {
  const clean = (language || '').trim();
  if (!clean) return 'en';
  const lower = clean.toLowerCase();
  if (lower === 'english' || lower === 'en' || lower === 'en-in' || lower === 'en-us') return 'en';
  if (lower === 'hindi' || lower === 'hi') return 'hi';
  if (lower === 'bilingual' || lower === 'english / hindi' || lower === 'hindi / english') {
    return 'en';
  }
  return clean;
}

export function buildOrganizationGraph(baseUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${baseUrl}/#organization`,
        name: 'ExamDash (ed)',
        url: baseUrl,
        logo: {
          '@type': 'ImageObject',
          '@id': `${baseUrl}/#logo`,
          url: `${baseUrl}/pwa-512x512.png`,
          width: 512,
          height: 512,
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${baseUrl}/#website`,
        url: baseUrl,
        name: 'ExamDash (ed)',
        publisher: {
          '@id': `${baseUrl}/#organization`,
        },
        inLanguage: 'en',
      },
    ],
  };
}

export function buildHomeCollectionGraph(
  baseUrl: string,
  books: readonly PublicBookDTO[],
  exams: readonly PublicExamPackDTO[]
) {
  const itemListElements = [
    ...books.map((book, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      url: `${baseUrl}/books/${book.urlSlug}`,
      name: book.title,
    })),
    ...exams.map((exam, idx) => ({
      '@type': 'ListItem',
      position: books.length + idx + 1,
      url: `${baseUrl}/exams/${exam.urlSlug}`,
      name: exam.title,
    })),
  ];

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${baseUrl}/#webpage`,
        url: baseUrl,
        name: 'ExamDash (ed) — Study Books & Online Exam Packs',
        description:
          'Browse published study books, MCQ question banks, and timed online exam test series on ExamDash (ed).',
        isPartOf: { '@id': `${baseUrl}/#website` },
        about: { '@id': `${baseUrl}/#organization` },
        inLanguage: 'en',
        mainEntity: {
          '@type': 'ItemList',
          '@id': `${baseUrl}/#catalog`,
          numberOfItems: itemListElements.length,
          itemListElement: itemListElements,
        },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${baseUrl}/#breadcrumb`,
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Home',
            item: baseUrl,
          },
        ],
      },
    ],
  };
}

export function buildHubCollectionGraph(
  baseUrl: string,
  hub: {
    readonly path: '/books' | '/exams';
    readonly name: string;
    readonly description: string;
    readonly items: readonly { readonly title: string; readonly urlSlug: string }[];
  }
) {
  const hubUrl = `${baseUrl}${hub.path}`;
  const itemListElements = hub.items.map((item, idx) => ({
    '@type': 'ListItem',
    position: idx + 1,
    url: `${hubUrl}/${item.urlSlug}`,
    name: item.title,
  }));

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${hubUrl}#webpage`,
        url: hubUrl,
        name: hub.name,
        description: hub.description,
        isPartOf: { '@id': `${baseUrl}/#website` },
        breadcrumb: { '@id': `${hubUrl}#breadcrumb` },
        inLanguage: 'en',
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: itemListElements.length,
          itemListElement: itemListElements,
        },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${hubUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
          { '@type': 'ListItem', position: 2, name: hub.name, item: hubUrl },
        ],
      },
    ],
  };
}

/**
 * 1:1 Verified JSON-LD `@graph` for Book Detail Pages.
 * Strictly derived from visible database fields — zero fabricated reviews, ratings, or FAQs.
 */
export function buildBookDetailGraph(baseUrl: string, book: PublicBookDTO) {
  const canonicalUrl = `${baseUrl}/books/${book.urlSlug}`;
  const description = buildCleanMetaDescription(
    book.seoDescription,
    book.fullDescription,
    book.title,
    300
  );
  const datePublished = normalizeIsoTimestamp(book.publishAt);
  const dateModified = normalizeIsoTimestamp(book.updatedAt);

  const bookNode: Record<string, unknown> = {
    '@type': 'Book',
    '@id': `${canonicalUrl}#book`,
    name: book.title,
    url: canonicalUrl,
    description,
    bookFormat: 'https://schema.org/EBook',
    inLanguage: normalizeLanguageTag(book.language),
    mainEntityOfPage: { '@id': `${canonicalUrl}#webpage` },
    offers: {
      '@type': 'Offer',
      price: String(book.buyPrice),
      priceCurrency: book.currency || 'INR',
      availability: 'https://schema.org/InStock',
      url: canonicalUrl,
      seller: { '@id': `${baseUrl}/#organization` },
    },
  };

  if (book.authorName.trim()) {
    bookNode.author = { '@type': 'Person', name: book.authorName.trim() };
  }
  if (book.publisher.trim()) {
    bookNode.publisher = { '@type': 'Organization', name: book.publisher.trim() };
  }
  if (book.type.trim()) {
    bookNode.genre = book.type.trim();
  }
  if (book.tags.length > 0) {
    bookNode.keywords = book.tags.join(', ');
  }
  if (datePublished) {
    bookNode.datePublished = datePublished;
  }
  if (dateModified) {
    bookNode.dateModified = dateModified;
  }

  const webPageNode: Record<string, unknown> = {
    '@type': 'ItemPage',
    '@id': `${canonicalUrl}#webpage`,
    url: canonicalUrl,
    name: book.title,
    description,
    isPartOf: { '@id': `${baseUrl}/#website` },
    breadcrumb: { '@id': `${canonicalUrl}#breadcrumb` },
    mainEntity: { '@id': `${canonicalUrl}#book` },
    inLanguage: normalizeLanguageTag(book.language),
  };
  if (datePublished) webPageNode.datePublished = datePublished;
  if (dateModified) webPageNode.dateModified = dateModified;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      webPageNode,
      bookNode,
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonicalUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
          { '@type': 'ListItem', position: 2, name: 'Books', item: `${baseUrl}/books` },
          { '@type': 'ListItem', position: 3, name: book.title, item: canonicalUrl },
        ],
      },
    ],
  };
}

/**
 * 1:1 Verified JSON-LD `@graph` for Exam Pack Detail Pages.
 * Strictly derived from visible database fields — zero fabricated reviews, ratings, or FAQs.
 */
export function buildExamDetailGraph(baseUrl: string, exam: PublicExamPackDTO) {
  const canonicalUrl = `${baseUrl}/exams/${exam.urlSlug}`;
  const description = buildCleanMetaDescription(
    exam.seoDescription,
    exam.fullDescription,
    exam.title,
    300
  );
  const datePublished = normalizeIsoTimestamp(exam.publishAt);
  const dateModified = normalizeIsoTimestamp(exam.updatedAt);

  const courseNode: Record<string, unknown> = {
    '@type': 'Course',
    '@id': `${canonicalUrl}#exam`,
    name: exam.title,
    url: canonicalUrl,
    description,
    inLanguage: normalizeLanguageTag(exam.language),
    mainEntityOfPage: { '@id': `${canonicalUrl}#webpage` },
    provider: exam.publisher.trim()
      ? { '@type': 'Organization', name: exam.publisher.trim() }
      : { '@id': `${baseUrl}/#organization` },
    offers: {
      '@type': 'Offer',
      price: String(exam.buyPrice),
      priceCurrency: exam.currency || 'INR',
      availability: 'https://schema.org/InStock',
      url: canonicalUrl,
      seller: { '@id': `${baseUrl}/#organization` },
    },
  };

  if (exam.authorName.trim()) {
    courseNode.creator = { '@type': 'Person', name: exam.authorName.trim() };
  }
  if (exam.tags.length > 0) {
    courseNode.keywords = exam.tags.join(', ');
  }
  if (exam.mocktestTitles.length > 0) {
    courseNode.hasPart = exam.mocktestTitles.map((mock) => ({
      '@type': 'LearningResource',
      name: stripMarkdownToPlainText(mock.title) || mock.title,
      learningResourceType: 'Practice Test',
      ...(mock.duration > 0 ? { timeRequired: `PT${Math.round(mock.duration)}M` } : {}),
    }));
  }
  if (datePublished) {
    courseNode.datePublished = datePublished;
  }
  if (dateModified) {
    courseNode.dateModified = dateModified;
  }

  const webPageNode: Record<string, unknown> = {
    '@type': 'ItemPage',
    '@id': `${canonicalUrl}#webpage`,
    url: canonicalUrl,
    name: exam.title,
    description,
    isPartOf: { '@id': `${baseUrl}/#website` },
    breadcrumb: { '@id': `${canonicalUrl}#breadcrumb` },
    mainEntity: { '@id': `${canonicalUrl}#exam` },
    inLanguage: normalizeLanguageTag(exam.language),
  };
  if (datePublished) webPageNode.datePublished = datePublished;
  if (dateModified) webPageNode.dateModified = dateModified;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      webPageNode,
      courseNode,
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonicalUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
          { '@type': 'ListItem', position: 2, name: 'Exams', item: `${baseUrl}/exams` },
          { '@type': 'ListItem', position: 3, name: exam.title, item: canonicalUrl },
        ],
      },
    ],
  };
}
