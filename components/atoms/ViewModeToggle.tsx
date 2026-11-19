'use client';

import React from 'react';
import { LayoutGrid, List } from 'lucide-react';
import type { ViewMode } from '@/lib/design-system/tokens';

export interface ViewModeToggleProps {
  readonly value: ViewMode;
  readonly onChange: (mode: ViewMode) => void;
}

export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Catalog layout view"
      className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-1"
    >
      <button
        type="button"
        onClick={() => onChange('grid')}
        aria-pressed={value === 'grid'}
        aria-label="Grid view"
        className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 ${
          value === 'grid'
            ? 'bg-[var(--surface-canvas)] text-[var(--text-primary)] shadow-xs'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
      >
        <LayoutGrid className="h-4 w-4" aria-hidden="true" />
        <span>Grid</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        aria-pressed={value === 'list'}
        aria-label="List view"
        className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 ${
          value === 'list'
            ? 'bg-[var(--surface-canvas)] text-[var(--text-primary)] shadow-xs'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
      >
        <List className="h-4 w-4" aria-hidden="true" />
        <span>List</span>
      </button>
    </div>
  );
}
