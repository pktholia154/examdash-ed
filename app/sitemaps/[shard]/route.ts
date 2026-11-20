import { NextResponse } from 'next/server';
import { fetchHomeCatalog } from '@/lib/firebase/server-catalog';
import {
  BUSINESS_IDENTITY,
  COMPLIANCE_PAGE_LINKS,
} from '@/lib/compliance/business-info';
import { getCanonicalBaseUrl } from '@/lib/seo/structured-data';
import {
  buildSitemapUrlsetXml,
  getLatestTimestamp,
  SITEMAP_SHARD_LIMIT,
  sliceShard,
  type SitemapUrlEntry,
} from '@/lib/seo/sitemap-builder';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ shard: string }>;
}

function xmlResponse(xml: string) {
  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

function notFoundXml() {
  return new NextResponse('Sitemap shard not found.', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'public, max-age=0, s-maxage=60',
    },
  });
}

/**
 * Sharded Sitemap Endpoint (`/sitemaps/pages.xml`, `/sitemaps/books-0.xml`, `/sitemaps/exams-0.xml`, etc.).
 * Strictly emits canonical `200 OK` indexable URLs only, with genuine `<lastmod>` and zero `<priority>`/`<changefreq>`.
 */
export async function GET(_req: Request, context: RouteContext) {
  const { shard } = await context.params;
  const baseUrl = getCanonicalBaseUrl();
  const catalog = await fetchHomeCatalog();

  if (shard === 'pages.xml') {
    const latestBooks = getLatestTimestamp(catalog.books.map((b) => b.updatedAt ?? b.publishAt));
    const latestExams = getLatestTimestamp(catalog.exams.map((e) => e.updatedAt ?? e.publishAt));
    const latestAll = getLatestTimestamp([latestBooks, latestExams]);

    const entries: SitemapUrlEntry[] = [
      {
        loc: baseUrl,
        lastmod: latestAll,
        images: [
          {
            loc: `${baseUrl}/pwa-512x512.png`,
            title: 'ExamDash (ed)',
          },
        ],
      },
    ];

    // Only include hub URLs when they have published items (Anti-Soft-404 parity)
    if (catalog.books.length > 0) {
      entries.push({
        loc: `${baseUrl}/books`,
        lastmod: latestBooks,
      });
    }
    if (catalog.exams.length > 0) {
      entries.push({
        loc: `${baseUrl}/exams`,
        lastmod: latestExams,
      });
    }

    for (const page of COMPLIANCE_PAGE_LINKS) {
      entries.push({
        loc: `${baseUrl}${page.href}`,
        lastmod: BUSINESS_IDENTITY.policyEffectiveIso,
      });
    }

    return xmlResponse(buildSitemapUrlsetXml(entries));
  }

  const bookMatch = /^books-(\d+)\.xml$/.exec(shard);
  if (bookMatch) {
    const index = Number(bookMatch[1]);
    const slice = sliceShard(catalog.books, index, SITEMAP_SHARD_LIMIT);
    if (slice.length === 0) return notFoundXml();

    const entries: SitemapUrlEntry[] = slice.map((book) => ({
      loc: `${baseUrl}/books/${book.urlSlug}`,
      lastmod: book.updatedAt ?? book.publishAt,
      images: [
        {
          loc: `${baseUrl}/books/${book.urlSlug}/thumbnail.png`,
          title: book.title,
        },
      ],
    }));
    return xmlResponse(buildSitemapUrlsetXml(entries));
  }

  const examMatch = /^exams-(\d+)\.xml$/.exec(shard);
  if (examMatch) {
    const index = Number(examMatch[1]);
    const slice = sliceShard(catalog.exams, index, SITEMAP_SHARD_LIMIT);
    if (slice.length === 0) return notFoundXml();

    const entries: SitemapUrlEntry[] = slice.map((exam) => ({
      loc: `${baseUrl}/exams/${exam.urlSlug}`,
      lastmod: exam.updatedAt ?? exam.publishAt,
      images: [
        {
          loc: `${baseUrl}/exams/${exam.urlSlug}/thumbnail.png`,
          title: exam.title,
        },
      ],
    }));
    return xmlResponse(buildSitemapUrlsetXml(entries));
  }

  return notFoundXml();
}
