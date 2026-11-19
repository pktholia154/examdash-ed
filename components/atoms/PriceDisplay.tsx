import React from 'react';
import { calculateDiscountPercent, formatPrice } from '@/lib/design-system/formatters';

export interface PriceDisplayProps {
  readonly buyPrice: number;
  readonly listPrice: number;
  readonly currency: string;
  readonly size?: 'sm' | 'md' | 'lg';
}

export function PriceDisplay({
  buyPrice,
  listPrice,
  currency,
  size = 'md',
}: PriceDisplayProps) {
  const discount = calculateDiscountPercent(listPrice, buyPrice);
  const buyFormatted = buyPrice === 0 ? 'Free' : formatPrice(buyPrice, currency);
  const listFormatted = formatPrice(listPrice, currency);

  const buyClass =
    size === 'lg'
      ? 'text-2xl font-bold text-[var(--text-primary)]'
      : size === 'sm'
      ? 'text-sm font-semibold text-[var(--text-primary)]'
      : 'text-base font-bold text-[var(--text-primary)]';

  const metaClass = size === 'lg' ? 'text-sm' : 'text-xs';

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
      <span className={`font-mono-tabular ${buyClass}`}>{buyFormatted}</span>
      {listPrice > buyPrice && (
        <span className={`font-mono-tabular text-[var(--text-muted)] line-through ${metaClass}`}>
          {listFormatted}
        </span>
      )}
      {discount > 0 && (
        <span className={`font-medium text-[var(--semantic-discount)] ${metaClass}`}>
          {discount}% off
        </span>
      )}
    </div>
  );
}
