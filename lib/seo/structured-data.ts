import type { PublicBookDTO, PublicExamPackDTO } from '@/lib/design-system/types';
import { BUSINESS_IDENTITY } from '@/lib/compliance/business-info';
import { isLocalHostname, isPreviewHostname, normalizeHostname } from './host-policy';
import { buildCleanMetaDescription, stripMarkdownToPlainText } from './overview-markdown';
import { normalizeIsoTimestamp } from './sitemap-builder';

export const DEFAULT_CANONICAL_ORIGIN = 'https://exam-dash.com';

function isNonProductionCanonicalHost(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (!host) return true;
  if (isLocalHostname(host) || isPreviewHostname(host)) return true;
  // Never emit ephemeral raw Cloud Run mirror URLs as canonical SEO origins
  if (host.endsWith('.run.app')) return true;
  return false;
}

function parseProductionOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (isNonProductionCanonicalHost(parsed.hostname)) {
      return null;
    }
    return `https://${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * Returns the authoritative production HTTPS canonical origin for `<link rel="canonical">`,
 * OpenGraph URLs, JSON-LD `@id`/URLs, sitemaps, and `robots.txt`.
 *
 * Guarantees zero `http://localhost:3000` or ephemeral `.run.app` leaks in SSR HTML
 * even when runtime environment variables are omitted.
 */
export function getCanonicalBaseUrl(): string {
  const explicitCanonical = parseProductionOrigin(process.env.CANONICAL_APP_URL);
  if (explicitCanonical) return explicitCanonical;

  const canonicalHost = normalizeHostname(process.env.CANONICAL_HOST);
  if (canonicalHost && !isNonProductionCanonicalHost(canonicalHost)) {
    return `https://${canonicalHost}`;
  }

  const appOrigin =
    parseProductionOrigin(process.env.APP_URL) ||
    parseProductionOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (appOrigin) return appOrigin;

  return DEFAULT_CANONICAL_ORIGIN;
}

/**
 * Returns the canonical, crawlable PNG thumbnail URL (1200x630 >= 500x500)
 * shared identically across `og:image`, `twitter:image`, JSON-LD `image`, and Image Sitemaps.
 */
export function getCatalogThumbnailUrl(
  baseUrl: string,
  contentType: 'books' | 'exams',
  urlSlug: string
): string {
  const origin = baseUrl.replace(/\/+$/, '');
  return `${origin}/${contentType}/${urlSlug}/thumbnail.png`;
}

/**
 * Filters standalone "Free" / "Free Book" / "Free Sample" tags when the full edition
 * has a positive buyPrice so Product snippets never trigger paid-vs-free policy conflicts.
 */
export function filterConflictingPriceTags(
  tags: readonly string[],
  buyPrice: number
): string[] {
  const cleaned = tags.map((t) => t.trim()).filter(Boolean);
  if (buyPrice <= 0) return cleaned;
  return cleaned.filter((tag) => !/^free(?:\s+(?:book|sample|ebook|pdf|exam|test))?$/i.test(tag));
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

function buildDigitalOffer(
  baseUrl: string,
  canonicalUrl: string,
  buyPrice: number,
  currency: string
) {
  const resolvedCurrency = (currency || 'INR').trim().toUpperCase();
  return {
    '@type': 'Offer',
    price: String(Math.max(0, buyPrice)),
    priceCurrency: resolvedCurrency,
    availability: 'https://schema.org/InStock',
    itemCondition: 'https://schema.org/NewCondition',
    url: canonicalUrl,
    seller: { '@id': `${baseUrl}/#organization` },
    hasMerchantReturnPolicy: {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'IN',
      returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
      merchantReturnLink: `${baseUrl}/refund-policy`,
    },
    shippingDetails: {
      '@type': 'OfferShippingDetails',
      shippingRate: {
        '@type': 'MonetaryAmount',
        value: '0',
        currency: resolvedCurrency,
      },
      shippingDestination: {
        '@type': 'DefinedRegion',
        addressCountry: 'IN',
      },
      deliveryTime: {
        '@type': 'ShippingDeliveryTime',
        handlingTime: {
          '@type': 'QuantitativeValue',
          minValue: 0,
          maxValue: 0,
          unitCode: 'DAY',
        },
        transitTime: {
          '@type': 'QuantitativeValue',
          minValue: 0,
          maxValue: 0,
          unitCode: 'DAY',
        },
      },
    },
  };
}

export function buildOrganizationGraph(baseUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${baseUrl}/#organization`,
        name: BUSINESS_IDENTITY.platformName,
        alternateName: BUSINESS_IDENTITY.brandName,
        legalName: BUSINESS_IDENTITY.legalName,
        url: baseUrl,
        email: BUSINESS_IDENTITY.supportEmail,
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
        name: BUSINESS_IDENTITY.platformName,
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

export interface StructuredReviewBundle {
  readonly summary: {
    readonly ratingValue: number;
    readonly ratingCount: number;
    readonly reviewCount: number;
  };
  readonly reviews: readonly {
    readonly id: string;
    readonly rating: number;
    readonly title: string;
    readonly body: string;
    readonly authorName: string;
    readonly createdAt: string;
  }[];
}

function attachGenuineReviewMarkup(
  targetNode: Record<string, unknown>,
  canonicalUrl: string,
  reviewData?: StructuredReviewBundle
): void {
  if (!reviewData) return;

  const { summary, reviews } = reviewData;
  const publishedReviews = reviews.filter(
    (r) =>
      Number.isInteger(r.rating) &&
      r.rating >= 1 &&
      r.rating <= 5 &&
      r.body.trim().length >= 10 &&
      r.authorName.trim().length >= 2
  );

  if (
    summary.ratingCount > 0 &&
    summary.ratingValue >= 1 &&
    summary.ratingValue <= 5 &&
    publishedReviews.length > 0
  ) {
    targetNode.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(summary.ratingValue.toFixed(1)),
      reviewCount: summary.reviewCount,
      ratingCount: summary.ratingCount,
      bestRating: 5,
      worstRating: 1,
    };

    targetNode.review = publishedReviews.slice(0, 10).map((r) => {
      const datePublished = normalizeIsoTimestamp(r.createdAt);
      const reviewNode: Record<string, unknown> = {
        '@type': 'Review',
        '@id': `${canonicalUrl}#review-${r.id}`,
        author: {
          '@type': 'Person',
          name: r.authorName.trim(),
        },
        reviewBody: r.body.trim(),
        reviewRating: {
          '@type': 'Rating',
          ratingValue: r.rating,
          bestRating: 5,
          worstRating: 1,
        },
      };
      if (r.title.trim()) {
        reviewNode.name = r.title.trim();
      }
      if (datePublished) {
        reviewNode.datePublished = datePublished;
      }
      return reviewNode;
    });
  }
}

/**
 * 1:1 Verified JSON-LD `@graph` for Book Detail Pages (`["Product", "Book"]`).
 * Strictly derived from visible database fields — emits `aggregateRating` and `review`
 * ONLY when genuine published user reviews exist (never fabricates demo/placeholder ratings).
 */
export function buildBookDetailGraph(
  baseUrl: string,
  book: PublicBookDTO,
  reviewData?: StructuredReviewBundle
) {
  const canonicalUrl = `${baseUrl}/books/${book.urlSlug}`;
  const thumbnailUrl = getCatalogThumbnailUrl(baseUrl, 'books', book.urlSlug);
  const description = buildCleanMetaDescription(
    book.seoDescription,
    book.fullDescription,
    book.title,
    300
  );
  const datePublished = normalizeIsoTimestamp(book.publishAt);
  const dateModified = normalizeIsoTimestamp(book.updatedAt);
  const alignedTags = filterConflictingPriceTags(book.tags, book.buyPrice);

  const bookNode: Record<string, unknown> = {
    '@type': ['Product', 'Book'],
    '@id': `${canonicalUrl}#book`,
    sku: book.id,
    name: book.title,
    url: canonicalUrl,
    description,
    image: [thumbnailUrl],
    brand: {
      '@type': 'Brand',
      name: book.publisher.trim() || BUSINESS_IDENTITY.platformName,
    },
    bookFormat: 'https://schema.org/EBook',
    inLanguage: normalizeLanguageTag(book.language),
    mainEntityOfPage: { '@id': `${canonicalUrl}#webpage` },
    offers: buildDigitalOffer(baseUrl, canonicalUrl, book.buyPrice, book.currency || 'INR'),
  };

  if (book.authorName.trim()) {
    bookNode.author = { '@type': 'Person', name: book.authorName.trim() };
  }
  if (book.publisher.trim()) {
    bookNode.publisher = { '@type': 'Organization', name: book.publisher.trim() };
  }
  if (book.type.trim()) {
    bookNode.genre = book.type.trim();
    bookNode.category = book.type.trim();
  }
  if (alignedTags.length > 0) {
    bookNode.keywords = alignedTags.join(', ');
  }
  if (datePublished) {
    bookNode.datePublished = datePublished;
  }
  if (dateModified) {
    bookNode.dateModified = dateModified;
  }

  attachGenuineReviewMarkup(bookNode, canonicalUrl, reviewData);

  const webPageNode: Record<string, unknown> = {
    '@type': 'ItemPage',
    '@id': `${canonicalUrl}#webpage`,
    url: canonicalUrl,
    name: book.title,
    description,
    primaryImageOfPage: {
      '@type': 'ImageObject',
      url: thumbnailUrl,
      width: 1200,
      height: 630,
    },
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
 * 1:1 Verified JSON-LD `@graph` for Exam Pack Detail Pages (`["Product", "Course"]`).
 * Strictly derived from visible database fields — emits `aggregateRating` and `review`
 * ONLY when genuine published user reviews exist (never fabricates demo/placeholder ratings).
 */
export function buildExamDetailGraph(
  baseUrl: string,
  exam: PublicExamPackDTO,
  reviewData?: StructuredReviewBundle
) {
  const canonicalUrl = `${baseUrl}/exams/${exam.urlSlug}`;
  const thumbnailUrl = getCatalogThumbnailUrl(baseUrl, 'exams', exam.urlSlug);
  const description = buildCleanMetaDescription(
    exam.seoDescription,
    exam.fullDescription,
    exam.title,
    300
  );
  const datePublished = normalizeIsoTimestamp(exam.publishAt);
  const dateModified = normalizeIsoTimestamp(exam.updatedAt);
  const alignedTags = filterConflictingPriceTags(exam.tags, exam.buyPrice);

  const courseNode: Record<string, unknown> = {
    '@type': ['Product', 'Course'],
    '@id': `${canonicalUrl}#exam`,
    sku: exam.id,
    name: exam.title,
    url: canonicalUrl,
    description,
    image: [thumbnailUrl],
    brand: {
      '@type': 'Brand',
      name: exam.publisher.trim() || BUSINESS_IDENTITY.platformName,
    },
    inLanguage: normalizeLanguageTag(exam.language),
    mainEntityOfPage: { '@id': `${canonicalUrl}#webpage` },
    provider: exam.publisher.trim()
      ? { '@type': 'Organization', name: exam.publisher.trim() }
      : { '@id': `${baseUrl}/#organization` },
    offers: buildDigitalOffer(baseUrl, canonicalUrl, exam.buyPrice, exam.currency || 'INR'),
  };

  if (exam.authorName.trim()) {
    courseNode.creator = { '@type': 'Person', name: exam.authorName.trim() };
  }
  if (exam.type.trim()) {
    courseNode.category = exam.type.trim();
  }
  if (alignedTags.length > 0) {
    courseNode.keywords = alignedTags.join(', ');
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

  attachGenuineReviewMarkup(courseNode, canonicalUrl, reviewData);

  const webPageNode: Record<string, unknown> = {
    '@type': 'ItemPage',
    '@id': `${canonicalUrl}#webpage`,
    url: canonicalUrl,
    name: exam.title,
    description,
    primaryImageOfPage: {
      '@type': 'ImageObject',
      url: thumbnailUrl,
      width: 1200,
      height: 630,
    },
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

export function buildLegalPageGraph(
  baseUrl: string,
  page: {
    readonly path: string;
    readonly name: string;
    readonly description: string;
    readonly dateModified: string;
  }
) {
  const canonicalUrl = `${baseUrl}${page.path}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: page.name,
        description: page.description,
        isPartOf: { '@id': `${baseUrl}/#website` },
        about: { '@id': `${baseUrl}/#organization` },
        breadcrumb: { '@id': `${canonicalUrl}#breadcrumb` },
        dateModified: page.dateModified,
        inLanguage: 'en',
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonicalUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
          { '@type': 'ListItem', position: 2, name: page.name, item: canonicalUrl },
        ],
      },
    ],
  };
}

export function buildContactPageGraph(
  baseUrl: string,
  contact: {
    readonly legalName: string;
    readonly brandName: string;
    readonly email: string;
    readonly address: string;
    readonly website: string;
    readonly dateModified: string;
  }
) {
  const canonicalUrl = `${baseUrl}/contact-us`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ContactPage',
        '@id': `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: `Contact Us — ${contact.brandName}`,
        description: `Official contact, customer support, and grievance redressal details for ${contact.brandName} (${contact.legalName}).`,
        isPartOf: { '@id': `${baseUrl}/#website` },
        breadcrumb: { '@id': `${canonicalUrl}#breadcrumb` },
        dateModified: contact.dateModified,
        inLanguage: 'en',
        mainEntity: {
          '@type': 'Organization',
          '@id': `${baseUrl}/#organization`,
          name: contact.brandName,
          legalName: contact.legalName,
          url: contact.website,
          email: contact.email,
          address: {
            '@type': 'PostalAddress',
            streetAddress: contact.address,
            addressLocality: 'Bhiwani',
            addressRegion: 'Haryana',
            postalCode: '127021',
            addressCountry: 'IN',
          },
          contactPoint: {
            '@type': 'ContactPoint',
            contactType: 'customer support',
            email: contact.email,
            availableLanguage: ['English', 'Hindi'],
          },
        },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonicalUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
          { '@type': 'ListItem', position: 2, name: 'Contact Us', item: canonicalUrl },
        ],
      },
    ],
  };
}
