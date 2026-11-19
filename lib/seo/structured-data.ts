import type { PublicBookDTO, PublicExamPackDTO } from '@/lib/design-system/types';

export function getCanonicalBaseUrl(): string {
  const raw = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return raw.replace(/\/+$/, '');
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
        '@id': `${baseUrl}/#home`,
        url: baseUrl,
        name: 'ExamDash (ed) — Study Books & Online Exam Packs',
        description:
          'Browse published study books, MCQ question banks, and timed online exam test series on ExamDash (ed).',
        isPartOf: { '@id': `${baseUrl}/#website` },
        mainEntity: {
          '@type': 'ItemList',
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

export function buildBookDetailGraph(baseUrl: string, book: PublicBookDTO) {
  const canonicalUrl = `${baseUrl}/books/${book.urlSlug}`;
  const productNode: Record<string, unknown> = {
    '@type': 'Book',
    '@id': `${canonicalUrl}#book`,
    name: book.title,
    url: canonicalUrl,
    description: book.seoDescription || book.fullDescription || book.title,
    inLanguage: book.language || 'English',
    offers: {
      '@type': 'Offer',
      price: String(book.buyPrice),
      priceCurrency: book.currency || 'INR',
      availability: 'https://schema.org/InStock',
      url: canonicalUrl,
    },
  };
  if (book.authorName) {
    productNode.author = { '@type': 'Person', name: book.authorName };
  }
  if (book.publisher) {
    productNode.publisher = { '@type': 'Organization', name: book.publisher };
  }
  if (book.publishAt) {
    productNode.datePublished = book.publishAt;
  }
  if (book.updatedAt) {
    productNode.dateModified = book.updatedAt;
  }

  return {
    '@context': 'https://schema.org',
    '@graph': [
      productNode,
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonicalUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
          { '@type': 'ListItem', position: 2, name: 'Books', item: `${baseUrl}/#books` },
          { '@type': 'ListItem', position: 3, name: book.title, item: canonicalUrl },
        ],
      },
    ],
  };
}

export function buildExamDetailGraph(baseUrl: string, exam: PublicExamPackDTO) {
  const canonicalUrl = `${baseUrl}/exams/${exam.urlSlug}`;
  const courseNode: Record<string, unknown> = {
    '@type': 'Course',
    '@id': `${canonicalUrl}#exam`,
    name: exam.title,
    url: canonicalUrl,
    description: exam.seoDescription || exam.fullDescription || exam.title,
    inLanguage: exam.language || 'English',
    provider: {
      '@type': 'Organization',
      name: exam.publisher || 'ExamDash (ed)',
    },
    offers: {
      '@type': 'Offer',
      price: String(exam.buyPrice),
      priceCurrency: exam.currency || 'INR',
      availability: 'https://schema.org/InStock',
      url: canonicalUrl,
    },
  };
  if (exam.publishAt) {
    courseNode.datePublished = exam.publishAt;
  }
  if (exam.updatedAt) {
    courseNode.dateModified = exam.updatedAt;
  }

  return {
    '@context': 'https://schema.org',
    '@graph': [
      courseNode,
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonicalUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
          { '@type': 'ListItem', position: 2, name: 'Exams', item: `${baseUrl}/#exams` },
          { '@type': 'ListItem', position: 3, name: exam.title, item: canonicalUrl },
        ],
      },
    ],
  };
}
