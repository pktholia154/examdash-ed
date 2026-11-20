import { NextResponse } from 'next/server';
import { lookupExamBySlug } from '@/lib/firebase/server-catalog';
import { buildCatalogThumbnailImage } from '@/lib/seo/og-thumbnail';

export const runtime = 'nodejs';
export const revalidate = 3600;

interface RouteContext {
  params: Promise<{ slug: string }>;
}

function formatCategoryLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^[A-Z0-9_]+$/.test(trimmed) && trimmed.includes('_')) {
    return trimmed
      .toLowerCase()
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  return trimmed;
}

export async function GET(_req: Request, context: RouteContext) {
  const { slug } = await context.params;
  const lookup = await lookupExamBySlug(slug);

  if (lookup.status !== 'found') {
    return new NextResponse('Exam pack thumbnail not found.', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'public, max-age=60, s-maxage=60',
      },
    });
  }

  const exam = lookup.item;
  return buildCatalogThumbnailImage({
    title: exam.title,
    contentType: 'exams',
    categoryLabel: formatCategoryLabel(exam.type),
    language: exam.language,
    buyPrice: exam.buyPrice,
    currency: exam.currency,
    hasSample: Boolean(exam.sampleJsonStoragePath || exam.mocktestTitles.length > 0),
  });
}
