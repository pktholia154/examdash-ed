import React from 'react';

export interface AnalyticsMetricTileProps {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}

export function AnalyticsMetricTile({ label, value, detail }: AnalyticsMetricTileProps) {
  return (
    <div className="flex flex-col justify-between px-4 py-3 sm:px-5 sm:py-3.5">
      <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      <span className="font-mono-tabular mt-1 text-xl font-bold tracking-tight text-[var(--text-primary)] sm:text-2xl">
        {value}
      </span>
      <span className="mt-0.5 text-xs text-[var(--text-secondary)]">{detail}</span>
    </div>
  );
}
