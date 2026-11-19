import type { CartItem, PublicCatalogBaseDTO } from './types';

/**
 * Extracts the first letter from each of the first two meaningful words in a title.
 * - "Indian History MCQs (Free Sample Book)" -> "IH"
 * - "Online exam IBPS" -> "OE"
 * - "Physics" -> "PH"
 * - "" -> "ED"
 */
export function extractThumbnailMonogram(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return 'ED';
  }

  const words = cleaned.split(' ').filter((w) => w.length > 0);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  const single = words[0];
  if (single.length >= 2) {
    return single.slice(0, 2).toUpperCase();
  }
  return `${single[0]}E`.toUpperCase();
}

export function calculateDiscountPercent(listPrice: number, buyPrice: number): number {
  if (!Number.isFinite(listPrice) || !Number.isFinite(buyPrice) || listPrice <= 0) {
    return 0;
  }
  if (buyPrice >= listPrice) {
    return 0;
  }
  const raw = ((listPrice - buyPrice) / listPrice) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export function formatPrice(amount: number, currency = 'INR'): string {
  const safeAmount = Number.isFinite(amount) && amount >= 0 ? amount : 0;
  const code = (currency || 'INR').toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
  const formatted = Number.isInteger(safeAmount)
    ? safeAmount.toLocaleString('en-IN')
    : safeAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol}${formatted}`;
}

export function filterCatalogItems<T extends PublicCatalogBaseDTO>(
  items: readonly T[],
  rawQuery: string
): T[] {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) {
    return [...items];
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const haystack = [
      item.title,
      item.type,
      item.authorName,
      item.publisher,
      item.language,
      item.seoDescription,
      ...item.tags,
    ]
      .join(' ')
      .toLowerCase();

    return tokens.every((token) => haystack.includes(token));
  });
}

export interface CartTotals {
  readonly itemCount: number;
  readonly subtotal: number;
  readonly totalListPrice: number;
  readonly totalSavings: number;
  readonly currency: string;
}

export function computeCartTotals(items: readonly CartItem[]): CartTotals {
  if (items.length === 0) {
    return {
      itemCount: 0,
      subtotal: 0,
      totalListPrice: 0,
      totalSavings: 0,
      currency: 'INR',
    };
  }

  let itemCount = 0;
  let subtotal = 0;
  let totalListPrice = 0;

  for (const item of items) {
    const qty = Math.max(1, Math.min(20, Math.floor(item.quantity)));
    itemCount += qty;
    subtotal += item.buyPrice * qty;
    totalListPrice += Math.max(item.listPrice, item.buyPrice) * qty;
  }

  return {
    itemCount,
    subtotal,
    totalListPrice,
    totalSavings: Math.max(0, totalListPrice - subtotal),
    currency: items[0].currency || 'INR',
  };
}

export function escapeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
