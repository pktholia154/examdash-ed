'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { ReaderErrorBoundary } from '@/components/readers/ReaderErrorBoundary';
import type { CbtExamWorkspaceProps } from './CbtExamWorkspace';

const LazyCbtExamWorkspace = dynamic(
  () => import('./CbtExamWorkspace').then((m) => m.CbtExamWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[var(--surface-canvas)] text-[var(--text-primary)]">
        <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
        <p className="text-sm font-medium">Loading CBT Exam Engine...</p>
      </div>
    ),
  }
);

export function DynamicExamWorkspace(
  props: CbtExamWorkspaceProps & { onExitFallback?: () => void }
) {
  const { onExitFallback, ...workspaceProps } = props;
  return (
    <ReaderErrorBoundary
      title={workspaceProps.exam.title}
      onClose={onExitFallback ?? (() => window.history.back())}
    >
      <LazyCbtExamWorkspace {...workspaceProps} />
    </ReaderErrorBoundary>
  );
}
