import React from 'react';
import { ImageResponse } from 'next/og';
import { getContentTypeConfig } from '@/lib/design-system/content-types';
import { extractThumbnailMonogram } from '@/lib/design-system/formatters';
import type { ContentTypeKey } from '@/lib/design-system/tokens';

export const OG_THUMBNAIL_WIDTH = 1200;
export const OG_THUMBNAIL_HEIGHT = 630;

export interface OgThumbnailInput {
  readonly title: string;
  readonly contentType: ContentTypeKey;
  readonly categoryLabel: string;
  readonly language: string;
  readonly buyPrice: number;
  readonly currency: string;
  readonly hasSample: boolean;
}

function truncateText(text: string, maxLen: number): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 3).trimEnd()}...`;
}

function formatOgAsciiPrice(amount: number, currency: string): string {
  const iso = (currency || 'INR').trim().toUpperCase();
  const formattedNumber = Number.isInteger(amount)
    ? amount.toLocaleString('en-US')
    : amount.toFixed(2);
  return `${iso} ${formattedNumber}`;
}

/**
 * Programmatically renders a cached 1200x630 (>= 500x500) PNG thumbnail
 * matching the exact brand monogram swatch and editorial typography.
 * Served identically to Googlebot and users (zero cloaking).
 */
export function buildCatalogThumbnailImage(input: OgThumbnailInput): ImageResponse {
  const config = getContentTypeConfig(input.contentType);
  const monogram = extractThumbnailMonogram(input.title);
  const displayTitle = truncateText(input.title, 76);
  const metaLine = [config.singularLabel, input.categoryLabel.trim(), input.language.trim()]
    .filter(Boolean)
    .join('  ·  ');
  const priceText =
    input.buyPrice > 0
      ? `Full Edition · ${formatOgAsciiPrice(input.buyPrice, input.currency)}`
      : 'Free Digital Edition';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#ffffff',
          padding: '64px 72px',
          fontFamily: 'sans-serif',
          border: '1px solid #e2e8f0',
        }}
      >
        {/* Left: Brand-Colored Monogram Square Tile (matches UI MonogramThumbnail 1:1) */}
        <div
          style={{
            width: '380px',
            height: '380px',
            borderRadius: '36px',
            backgroundColor: config.thumbnailBg,
            color: config.thumbnailInk,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '164px',
            fontWeight: 800,
            letterSpacing: '-0.04em',
            flexShrink: 0,
          }}
        >
          {monogram}
        </div>

        {/* Right: Clean Monochrome Editorial Metadata */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '620px',
            height: '380px',
            paddingLeft: '48px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div
              style={{
                fontSize: '22px',
                fontWeight: 600,
                color: '#64748b',
                letterSpacing: '0.01em',
              }}
            >
              {metaLine}
            </div>

            <div
              style={{
                fontSize: '46px',
                fontWeight: 800,
                lineHeight: 1.18,
                color: '#0f172a',
                letterSpacing: '-0.02em',
              }}
            >
              {displayTitle}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              borderTop: '2px solid #e2e8f0',
              paddingTop: '24px',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div
                style={{
                  fontSize: '30px',
                  fontWeight: 700,
                  color: '#0f172a',
                }}
              >
                {priceText}
              </div>
              {input.hasSample && (
                <div
                  style={{
                    fontSize: '20px',
                    fontWeight: 600,
                    color: '#0f172a',
                    backgroundColor: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    padding: '8px 16px',
                    borderRadius: '10px',
                  }}
                >
                  Free Sample Preview
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '22px',
                color: '#475569',
              }}
            >
              <span style={{ fontWeight: 700, color: '#0f172a' }}>ExamDash (ed)</span>
              <span>exam-dash.com</span>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: OG_THUMBNAIL_WIDTH,
      height: OG_THUMBNAIL_HEIGHT,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
      },
    }
  );
}
