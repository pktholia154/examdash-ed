import { NextResponse } from 'next/server';
import { lookupBookBySlug } from '@/lib/firebase/server-catalog';
import { buildCatalogThumbnailImage } from '@/lib/seo/og-thumbnail';

export const runtime = 'nodejs';
export const revalidate = 3600;

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  const { slug } = await context.params;
  const lookup = await lookupBookBySlug(slug);

  if (lookup.status !== 'found') {
    return new NextResponse('Book thumbnail not found.', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'public, max-age=60, s-maxage=60',
      },
    });
  }

  const book = lookup.item;
  return buildCatalogThumbnailImage({
    title: book.title,
    contentType: 'books',
    categoryLabel: book.type,
    language: book.language,
    buyPrice: book.buyPrice,
    currency: book.currency,
    hasSample: Boolean(book.samplePdfUrl || book.sampleMarkdownUrl),
  });
}
