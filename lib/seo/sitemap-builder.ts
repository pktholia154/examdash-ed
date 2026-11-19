export const SITEMAP_SHARD_LIMIT = 5000;

export interface SitemapImageEntry {
  readonly loc: string;
  readonly title?: string;
}

export interface SitemapUrlEntry {
  readonly loc: string;
  readonly lastmod?: string | null;
  readonly images?: readonly SitemapImageEntry[];
}

export interface SitemapIndexEntry {
  readonly loc: string;
  readonly lastmod?: string | null;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Validates and normalizes a timestamp string into full W3C / ISO-8601 format with UTC timezone.
 * Returns null if missing or invalid so sitemaps never emit fabricated `Date.now()` timestamps.
 */
export function normalizeIsoTimestamp(value?: string | null): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

/**
 * Picks the most recent substantive modification timestamp across a list of records.
 */
export function getLatestTimestamp(timestamps: readonly (string | null | undefined)[]): string | null {
  let latestMs = -Infinity;
  let latestIso: string | null = null;

  for (const ts of timestamps) {
    const iso = normalizeIsoTimestamp(ts);
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (ms > latestMs) {
      latestMs = ms;
      latestIso = iso;
    }
  }

  return latestIso;
}

export function computeShardCount(totalItems: number, shardLimit = SITEMAP_SHARD_LIMIT): number {
  if (totalItems <= 0) return 0;
  return Math.ceil(totalItems / Math.max(1, shardLimit));
}

export function sliceShard<T>(
  items: readonly T[],
  shardIndex: number,
  shardLimit = SITEMAP_SHARD_LIMIT
): readonly T[] {
  if (!Number.isInteger(shardIndex) || shardIndex < 0) return [];
  const start = shardIndex * shardLimit;
  if (start >= items.length) return [];
  return items.slice(start, start + shardLimit);
}

/**
 * Generates a W3C Sitemap Index XML document (`<sitemapindex>`).
 */
export function buildSitemapIndexXml(sitemaps: readonly SitemapIndexEntry[]): string {
  const rows = sitemaps
    .map((entry) => {
      const lastmod = normalizeIsoTimestamp(entry.lastmod);
      return [
        '  <sitemap>',
        `    <loc>${escapeXml(entry.loc)}</loc>`,
        lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : null,
        '  </sitemap>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    rows,
    '</sitemapindex>',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Generates a GSC-compliant `<urlset>` XML document:
 * - Supports optional `<image:image>` tags via Google image sitemap namespace
 * - Emits `<lastmod>` strictly when a genuine substantive timestamp exists
 * - Deliberately omits `<priority>` and `<changefreq>` (ignored by Google & Bing)
 */
export function buildSitemapUrlsetXml(entries: readonly SitemapUrlEntry[]): string {
  const hasImages = entries.some((e) => e.images && e.images.length > 0);
  const imageNs = hasImages ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : '';

  const rows = entries
    .map((entry) => {
      const lastmod = normalizeIsoTimestamp(entry.lastmod);
      const imageLines = (entry.images ?? []).map((img) =>
        [
          '    <image:image>',
          `      <image:loc>${escapeXml(img.loc)}</image:loc>`,
          img.title ? `      <image:title>${escapeXml(img.title)}</image:title>` : null,
          '    </image:image>',
        ]
          .filter(Boolean)
          .join('\n')
      );

      return [
        '  <url>',
        `    <loc>${escapeXml(entry.loc)}</loc>`,
        lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : null,
        ...imageLines,
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${imageNs}>`,
    rows,
    '</urlset>',
  ]
    .filter(Boolean)
    .join('\n');
}
