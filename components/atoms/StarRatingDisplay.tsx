import React from 'react';
import { Star } from 'lucide-react';

export interface StarRatingDisplayProps {
  readonly rating: number;
  readonly size?: 'xs' | 'sm' | 'md';
  readonly showNumeric?: boolean;
  readonly count?: number;
  readonly className?: string;
}

const SIZE_CLASSES = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
} as const;

/**
 * Monochrome editorial 5-star rating readout.
 * Uses crisp ink fill for earned stars and subtle neutral outline for remaining stars.
 */
export function StarRatingDisplay({
  rating,
  size = 'sm',
  showNumeric = false,
  count,
  className = '',
}: StarRatingDisplayProps) {
  const clamped = Math.max(0, Math.min(5, rating));
  const roundedStars = Math.round(clamped);
  const iconClass = SIZE_CLASSES[size];

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      aria-label={`${clamped.toFixed(1)} out of 5 stars${typeof count === 'number' ? ` from ${count} review${count === 1 ? '' : 's'}` : ''}`}
    >
      <span className="inline-flex items-center gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = star <= roundedStars;
          return (
            <Star
              key={star}
              className={`${iconClass} ${
                filled
                  ? 'fill-[var(--text-primary)] text-[var(--text-primary)]'
                  : 'fill-transparent text-[var(--border-strong)]'
              }`}
            />
          );
        })}
      </span>

      {showNumeric && (
        <span className="font-mono-tabular text-xs font-semibold text-[var(--text-primary)]">
          {clamped.toFixed(1)}
        </span>
      )}

      {typeof count === 'number' && (
        <span className="font-mono-tabular text-xs text-[var(--text-muted)]">
          ({count})
        </span>
      )}
    </span>
  );
}
