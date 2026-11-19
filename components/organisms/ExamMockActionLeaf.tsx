'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Lock, Play } from 'lucide-react';
import { useAppSession } from '@/components/providers/AppSessionProvider';
import { loadAllExamAttemptSummaries } from '@/core/exam/storage';
import type { ExamAttemptSummary } from '@/core/exam/engine';

export interface ExamMockActionLeafProps {
  readonly examPackId: string;
  readonly examSlug: string;
  readonly mockId: string;
  readonly isFirstSample: boolean;
}

/**
 * Atomic client leaf for each server-rendered mock test list row.
 * Hydrates personal purchase & attempt status strictly post-mount.
 */
export function ExamMockActionLeaf({
  examPackId,
  examSlug,
  mockId,
  isFirstSample,
}: ExamMockActionLeafProps) {
  const { isPurchased } = useAppSession();
  const owned = isPurchased('exams', examPackId);
  const launchMode = owned ? 'full' : 'sample';

  const [summary, setSummary] = useState<ExamAttemptSummary | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void loadAllExamAttemptSummaries().then((list) => {
        if (!active) return;
        const match =
          list.find(
            (s) =>
              s.examPackId === examPackId &&
              s.mode === launchMode &&
              (s.examSetId === mockId || (isFirstSample && s.examSetId === 'exam_set_1'))
          ) ?? null;
        setSummary(match);
      });
    };
    refresh();
    window.addEventListener('examdash:attempt-updated', refresh);
    return () => {
      active = false;
      window.removeEventListener('examdash:attempt-updated', refresh);
    };
  }, [examPackId, isFirstSample, launchMode, mockId]);

  if (!owned && !isFirstSample) {
    return (
      <span data-nosnippet="" className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Buy Pack to Unlock</span>
      </span>
    );
  }

  return (
    <div data-nosnippet="" className="flex flex-wrap items-center gap-2">
      {summary?.phase === 'submitted' && summary.score !== null && (
        <span className="font-mono-tabular text-xs font-medium text-[var(--semantic-discount)]">
          Score {summary.score}/{summary.maxMarks} ({summary.accuracy ?? 0}%)
        </span>
      )}
      {summary?.phase === 'in_progress' && (
        <span className="font-mono-tabular text-xs font-medium text-[var(--brand-accent)]">
          {summary.answeredCount}/{summary.totalQuestions} answered
        </span>
      )}
      <Link
        href={`/exams/${examSlug}/attempt?mode=${launchMode}&set=${encodeURIComponent(mockId)}`}
        rel="nofollow"
        className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold whitespace-nowrap transition-colors ${
          isFirstSample && !owned
            ? 'bg-[var(--brand-ink)] text-white hover:bg-[var(--brand-ink-hover)]'
            : 'border border-[var(--border-strong)] bg-[var(--surface-canvas)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
        }`}
      >
        {summary?.phase === 'submitted' ? (
          <>
            <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>View Report</span>
          </>
        ) : summary?.phase === 'in_progress' ? (
          <>
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Resume Test</span>
          </>
        ) : (
          <>
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isFirstSample && !owned ? 'Start Sample' : 'Start Test'}</span>
          </>
        )}
      </Link>
    </div>
  );
}
