import type { PublicBookDTO, PublicExamPackDTO } from '@/lib/design-system/types';

export type CatalogDetailItem = PublicBookDTO | PublicExamPackDTO;

/**
 * Deterministically selects up to `limit` (default 6) published related catalog items
 * for server-side internal linking on detail pages:
 * 1. Same collection + matching category/type first
 * 2. Remaining items in the same collection
 * 3. Complementary collection items (books <-> exams) to ensure healthy internal link depth
 *    even when a single collection has only a few published editions.
 */
export function selectRelatedCatalogItems(
  current: Pick<CatalogDetailItem, 'id' | 'contentType' | 'type' | 'tags'>,
  books: readonly PublicBookDTO[],
  exams: readonly PublicExamPackDTO[],
  limit = 6
): CatalogDetailItem[] {
  const maxItems = Math.max(0, Math.floor(limit));
  if (maxItems === 0) return [];

  const primaryPool: readonly CatalogDetailItem[] =
    current.contentType === 'books' ? books : exams;
  const secondaryPool: readonly CatalogDetailItem[] =
    current.contentType === 'books' ? exams : books;

  const currentType = current.type.trim().toLowerCase();
  const currentTags = new Set(current.tags.map((t) => t.trim().toLowerCase()).filter(Boolean));

  const sameCollection = primaryPool.filter((item) => item.id !== current.id);

  // Rank same-collection candidates by category/tag affinity while preserving publish order on ties
  const rankedPrimary = [...sameCollection].sort((a, b) => {
    const score = (candidate: CatalogDetailItem): number => {
      let pts = 0;
      if (currentType && candidate.type.trim().toLowerCase() === currentType) pts += 3;
      for (const tag of candidate.tags) {
        if (currentTags.has(tag.trim().toLowerCase())) pts += 1;
      }
      return pts;
    };
    return score(b) - score(a);
  });

  const selected: CatalogDetailItem[] = [];
  const seen = new Set<string>([`${current.contentType}:${current.id}`]);

  const appendFrom = (pool: readonly CatalogDetailItem[]) => {
    for (const item of pool) {
      if (selected.length >= maxItems) break;
      const key = `${item.contentType}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(item);
    }
  };

  appendFrom(rankedPrimary);
  appendFrom(secondaryPool);

  return selected;
}
