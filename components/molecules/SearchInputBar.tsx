'use client';

import React from 'react';
import { Search, X } from 'lucide-react';
import { ViewModeToggle } from '@/components/atoms/ViewModeToggle';
import type { ContentTypeKey, ViewMode } from '@/lib/design-system/tokens';

export type ContentFilterOption = 'all' | ContentTypeKey;

export interface SearchInputBarProps {
  readonly query: string;
  readonly onQueryChange: (next: string) => void;
  readonly activeFilter: ContentFilterOption;
  readonly onFilterChange: (next: ContentFilterOption) => void;
  readonly viewMode: ViewMode;
  readonly onViewModeChange: (next: ViewMode) => void;
  readonly booksCount: number;
  readonly examsCount: number;
}

export function SearchInputBar({
  query,
  onQueryChange,
  activeFilter,
  onFilterChange,
  viewMode,
  onViewModeChange,
  booksCount,
  examsCount,
}: SearchInputBarProps) {
  const totalCount = booksCount + examsCount;

  const filterTabs: Array<{ key: ContentFilterOption; label: string; count: number }> = [
    { key: 'all', label: 'All', count: totalCount },
    { key: 'books', label: 'Books', count: booksCount },
    { key: 'exams', label: 'Exams', count: examsCount },
  ];

  return (
    <div className="space-y-4">
      <div className="relative">
        <label htmlFor="catalog-search-input" className="sr-only">
          Search across Books and Exam Packs
        </label>
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-muted)]"
          aria-hidden="true"
        />
        <input
          id="catalog-search-input"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search books, mock test series, subjects, or publishers..."
          autoComplete="off"
          className="min-h-[52px] w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-canvas)] py-3 pl-12 pr-12 text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--brand-ink)]"
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="Clear search query"
            className="absolute right-2 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Filter by content type"
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-1"
        >
          {filterTabs.map((tab) => {
            const active = activeFilter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onFilterChange(tab.key)}
                className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 ${
                  active
                    ? 'bg-[var(--surface-canvas)] text-[var(--text-primary)] shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span>{tab.label}</span>
                <span className="font-mono-tabular text-xs text-[var(--text-muted)]">
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
      </div>
    </div>
  );
}
