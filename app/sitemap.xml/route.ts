import { NextResponse } from 'next/server';
import { fetchHomeCatalog } from '@/lib/firebase/server-catalog';
import { getCanonicalBaseUrl } from '@/lib/seo/structured-data';
import {
  buildSitemapIndexXml,
  computeShardCount,
  getLatestTimestamp,
  SITEMAP_SHARD_LIMIT,
  type SitemapIndexEntry,
} from '@/lib/seo/sitemap-builder';

export const dynamic = 'force-dynamic';

/**
 * Root Sitemap Index (`/sitemap.xml`) referencing sharded sitemaps (`<= 5,000` URLs/shard).
 * Derives `<lastmod>` deterministically from genuine item update timestamps (never `Date.now()`).
 */
export async function GET() {
  const baseUrl = getCanonicalBaseUrl();
  const catalog = await fetchHomeCatalog();

  const bookTimestamps = catalog.books.map((b) => b.updatedAt ?? b.publishAt);
  const examTimestamps = catalog.exams.map((e) => e.updatedAt ?? e.publishAt);
  const latestAll = getLatestTimestamp([...bookTimestamps, ...examTimestamps]);
  const latestBooks = getLatestTimestamp(bookTimestamps);
  const latestExams = getLatestTimestamp(examTimestamps);

  const indexEntries: SitemapIndexEntry[] = [
    {
      loc: `${baseUrl}/sitemaps/pages.xml`,
      lastmod: latestAll,
    },
  ];

  const bookShardCount = computeShardCount(catalog.books.length, SITEMAP_SHARD_LIMIT);
  for (let i = 0; i < bookShardCount; i++) {
    indexEntries.push({
      loc: `${baseUrl}/sitemaps/books-${i}.xml`,
      lastmod: latestBooks,
    });
  }

  const examShardCount = computeShardCount(catalog.exams.length, SITEMAP_SHARD_LIMIT);
  for (let i = 0; i < examShardCount; i++) {
    indexEntries.push({
      loc: `${baseUrl}/sitemaps/exams-${i}.xml`,
      lastmod: latestExams,
    });
  }

  const xml = buildSitemapIndexXml(indexEntries);

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
