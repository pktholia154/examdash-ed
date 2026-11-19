import React from 'react';
import { getContentTypeConfig } from '@/lib/design-system/content-types';
import { extractThumbnailMonogram } from '@/lib/design-system/formatters';
import type { ContentTypeKey } from '@/lib/design-system/tokens';

export interface MonogramThumbnailProps {
  readonly title: string;
  readonly contentType: ContentTypeKey;
  readonly size: 'grid' | 'list' | 'compact' | 'hero';
}

const SIZE_CLASSES: Record<MonogramThumbnailProps['size'], string> = {
  grid: 'w-full aspect-square rounded-xl text-4xl sm:text-5xl',
  list: 'w-24 h-24 sm:w-28 sm:h-28 shrink-0 aspect-square rounded-xl text-2xl sm:text-3xl',
  compact: 'w-12 h-12 shrink-0 aspect-square rounded-lg text-base',
  hero: 'w-36 h-36 sm:w-44 sm:h-44 shrink-0 aspect-square rounded-2xl text-5xl sm:text-6xl',
};

const BG_CLASSES: Record<ContentTypeKey, string> = {
  books: 'bg-[var(--ct-books-bg)] text-[var(--ct-books-ink)]',
  exams: 'bg-[var(--ct-exams-bg)] text-[var(--ct-exams-ink)]',
  quizbooks: 'bg-[var(--ct-quizbooks-bg)] text-[var(--ct-quizbooks-ink)]',
};

/**
 * Pure typographic single-color square thumbnail (zero raster images).
 * Displays the first 2 letters from the first 2 words of the item title.
 */
export function MonogramThumbnail({ title, contentType, size }: MonogramThumbnailProps) {
  const config = getContentTypeConfig(contentType);
  const monogram = extractThumbnailMonogram(title);

  return (
    <div
      role="img"
      aria-label={`${config.singularLabel} thumbnail ${monogram} for ${title}`}
      className={`relative flex select-none items-center justify-center font-display font-bold tracking-tight ${SIZE_CLASSES[size]} ${BG_CLASSES[contentType]}`}
    >
      <span aria-hidden="true">{monogram}</span>
    </div>
  );
}
