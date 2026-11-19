import type { MetadataRoute } from 'next';
import { fetchHomeCatalog } from '@/lib/firebase/server-catalog';
import { getCanonicalBaseUrl } from '@/lib/seo/structured-data';

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getCanonicalBaseUrl();
  const catalog = await fetchHomeCatalog();

  const entries: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(catalog.fetchedAt),
    },
  ];

  for (const book of catalog.books) {
    entries.push({
      url: `${baseUrl}/books/${book.urlSlug}`,
      lastModified: book.updatedAt ? new Date(book.updatedAt) : undefined,
    });
  }

  for (const exam of catalog.exams) {
    entries.push({
      url: `${baseUrl}/exams/${exam.urlSlug}`,
      lastModified: exam.updatedAt ? new Date(exam.updatedAt) : undefined,
    });
  }

  return entries;
}
