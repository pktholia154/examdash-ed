'use client';

import React from 'react';
import { Check, ShoppingCart } from 'lucide-react';
import { useAppSession } from '@/components/providers/AppSessionProvider';
import type { ContentTypeKey } from '@/lib/design-system/tokens';

export interface AddToCartButtonLeafProps {
  readonly id: string;
  readonly contentType: ContentTypeKey;
  readonly title: string;
  readonly urlSlug: string;
  readonly currency: string;
  readonly buyPrice: number;
  readonly listPrice: number;
}

/**
 * Minimal client leaf button accepting only primitive props so hub pages
 * stay 100% server-rendered with zero description double-serialization.
 */
export function AddToCartButtonLeaf({
  id,
  contentType,
  title,
  urlSlug,
  currency,
  buyPrice,
  listPrice,
}: AddToCartButtonLeafProps) {
  const { isInCart, isPurchased, addToCart, setCartOpen } = useAppSession();
  const inCart = isInCart(contentType, id);
  const owned = isPurchased(contentType, id);

  const handleClick = () => {
    if (owned) return;
    if (inCart) {
      setCartOpen(true);
      return;
    }
    void addToCart({
      id,
      contentType,
      title,
      urlSlug,
      seoDescription: '',
      fullDescription: '',
      type: '',
      language: '',
      publisher: '',
      authorName: '',
      tags: [],
      currency,
      listPrice,
      buyPrice,
      createdAt: null,
      updatedAt: null,
      publishAt: null,
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={owned}
      data-nosnippet=""
      aria-label={
        owned
          ? `${title} is already purchased`
          : inCart
            ? `${title} is in cart — open cart`
            : `Add ${title} to cart`
      }
      title={owned ? 'Purchased' : inCart ? 'In cart — open checkout' : 'Add to cart'}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors duration-150 ${
        owned
          ? 'border-[var(--border-subtle)] bg-[var(--surface-subtle)] text-[var(--semantic-discount)] cursor-default'
          : inCart
            ? 'border-[var(--brand-ink)] bg-[var(--brand-ink)] text-white hover:bg-[var(--brand-ink-hover)]'
            : 'border-[var(--border-strong)] bg-[var(--surface-canvas)] text-[var(--text-primary)] hover:border-[var(--brand-ink)] hover:bg-[var(--surface-hover)]'
      }`}
    >
      {owned || inCart ? (
        <Check className="h-4 w-4" aria-hidden="true" />
      ) : (
        <ShoppingCart className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
