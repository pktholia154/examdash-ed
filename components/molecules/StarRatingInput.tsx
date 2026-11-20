'use client';

import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { RATING_LABELS, type StarRatingValue } from '@/core/reviews/schema';

export interface StarRatingInputProps {
  readonly value: StarRatingValue | 0;
  readonly onChange: (rating: StarRatingValue) => void;
  readonly disabled?: boolean;
  readonly id?: string;
}

const STARS: readonly StarRatingValue[] = [1, 2, 3, 4, 5];

/**
 * Accessible 1–5 star radiogroup input with 44x44px touch targets and hover preview.
 */
export function StarRatingInput({
  value,
  onChange,
  disabled = false,
  id = 'review-star-rating',
}: StarRatingInputProps) {
  const [hovered, setHovered] = useState<StarRatingValue | 0>(0);
  const activeRating = hovered || value;

  return (
    <div className="space-y-1.5">
      <div
        id={id}
        role="radiogroup"
        aria-label="Select star rating from 1 to 5"
        className="flex flex-wrap items-center gap-1"
        onMouseLeave={() => setHovered(0)}
      >
        {STARS.map((star) => {
          const isFilled = star <= activeRating;
          const isSelected = value === star;
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${star} star${star === 1 ? '' : 's'} — ${RATING_LABELS[star]}`}
              disabled={disabled}
              onMouseEnter={() => setHovered(star)}
              onFocus={() => setHovered(star)}
              onBlur={() => setHovered(0)}
              onClick={() => onChange(star)}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-lg border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-ink)] disabled:cursor-not-allowed disabled:opacity-50 ${
                isSelected
                  ? 'border-[var(--brand-ink)] bg-[var(--surface-hover)]'
                  : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              <Star
                className={`h-6 w-6 transition-colors ${
                  isFilled
                    ? 'fill-[var(--text-primary)] text-[var(--text-primary)]'
                    : 'fill-transparent text-[var(--border-strong)]'
                }`}
                aria-hidden="true"
              />
            </button>
          );
        })}

        <span className="ml-2 text-xs font-medium text-[var(--text-secondary)]">
          {activeRating > 0
            ? `${activeRating} / 5 · ${RATING_LABELS[activeRating as StarRatingValue]}`
            : 'Select a rating'}
        </span>
      </div>
    </div>
  );
}
