'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2, Lock, LogIn, RefreshCw } from 'lucide-react';
import { useAppSession } from '@/components/providers/AppSessionProvider';
import { DynamicExamWorkspace } from '@/components/exam/DynamicExamWorkspace';
import type { NormalizedExamSet } from '@/core/exam/schema';
import type { PublicExamPackDTO } from '@/lib/design-system/types';

export interface ExamAttemptPageClientProps {
  readonly examPack: PublicExamPackDTO;
}

interface SetsApiResponse {
  examPackId: string;
  title: string;
  mode: 'sample' | 'full';
  source: string;
  storageNotice?: string | null;
  sets: NormalizedExamSet[];
  error?: string;
}

export function ExamAttemptPageClient({ examPack }: ExamAttemptPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') === 'full' ? 'full' : 'sample';
  const requestedSetId = searchParams.get('set') ?? '';
  const autostart = searchParams.get('autostart') === '1';

  const { user, authReady, authBusy, signIn, getPurchase } = useAppSession();
  const purchaseRecord = getPurchase('exams', examPack.id);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSet, setSelectedSet] = useState<NormalizedExamSet | null>(null);
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const purchaseProof = purchaseRecord?.entitlementProof ?? null;
  const userUid = user?.uid ?? null;

  useEffect(() => {
    if (!authReady) return;
    if (mode === 'full' && (!user || !purchaseProof)) return;

    let cancelled = false;

    async function loadExamSet() {
      try {
        const headers: Record<string, string> = {};
        if (user) {
          const token = await user.getIdToken();
          headers.Authorization = `Bearer ${token}`;
        }
        if (mode === 'full' && purchaseProof) {
          headers['x-entitlement-proof'] = purchaseProof;
        }

        const res = await fetch(
          `/api/exams/${encodeURIComponent(examPack.id)}/sets?mode=${mode}`,
          {
            headers,
            cache: 'no-store',
          }
        );

        const data = (await res.json().catch(() => ({}))) as SetsApiResponse;
        if (!res.ok) {
          throw new Error(data.error || `Unable to load exam set (HTTP ${res.status}).`);
        }

        const sets = Array.isArray(data.sets) ? data.sets : [];
        if (sets.length === 0) {
          throw new Error('No exam sets were found in this exam pack.');
        }

        const matched =
          (requestedSetId ? sets.find((s) => s.id === requestedSetId) : null) ?? sets[0];

        if (!cancelled) {
          setSelectedSet(matched);
          setSourceNotice(data.storageNotice ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load exam set.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadExamSet();
    return () => {
      cancelled = true;
    };
  }, [authReady, examPack.id, mode, purchaseProof, reloadTick, requestedSetId, user, userUid]);

  // Gate: Full Mode requires Google Sign-In
  if (mode === 'full' && authReady && !user) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--surface-canvas)] px-4 text-center">
        <div className="w-full max-w-md rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-6">
          <Lock className="mx-auto h-7 w-7 text-[var(--text-primary)]" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-bold text-[var(--text-primary)]">
            Sign in to access purchased exam sets
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Sign in with Google to verify your entitlement for {examPack.title}.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            <button
              type="button"
              onClick={() => void signIn()}
              disabled={authBusy}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-ink)] px-5 text-sm font-semibold text-white hover:bg-[var(--brand-ink-hover)]"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              <span>{authBusy ? 'Signing in...' : 'Sign in with Google'}</span>
            </button>
            <Link
              href={`/exams/${examPack.urlSlug}`}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-4 text-sm font-medium text-[var(--text-primary)]"
            >
              Back to Exam Pack
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Gate: Full Mode requires verified purchase
  if (mode === 'full' && authReady && user && (!purchaseRecord || !purchaseProof)) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--surface-canvas)] px-4 text-center">
        <div className="w-full max-w-md rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-6">
          <Lock className="mx-auto h-7 w-7 text-[var(--text-primary)]" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-bold text-[var(--text-primary)]">
            Full Exam Pack Locked
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Purchase {examPack.title} to unlock all {examPack.totalMocktest} mock test sets, or try
            the free sample mock test first.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            <Link
              href={`/exams/${examPack.urlSlug}`}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-[var(--brand-ink)] px-5 text-sm font-semibold text-white hover:bg-[var(--brand-ink-hover)]"
            >
              View Exam Pack & Buy
            </Link>
            <Link
              href={`/exams/${examPack.urlSlug}/attempt?mode=sample`}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-4 text-sm font-medium text-[var(--text-primary)]"
            >
              Try Free Sample
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !authReady) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[var(--surface-canvas)] text-[var(--text-primary)]">
        <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
        <p className="text-sm font-medium">Loading {examPack.title}...</p>
      </div>
    );
  }

  if (error || !selectedSet) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--surface-canvas)] px-4 text-center">
        <div className="w-full max-w-md rounded-xl border border-rose-200 bg-rose-50/70 p-6">
          <AlertCircle className="mx-auto h-7 w-7 text-rose-700" aria-hidden="true" />
          <h1 className="mt-3 text-base font-bold text-rose-900">Unable to load exam set</h1>
          <p className="mt-1.5 text-xs text-rose-800">
            {error || 'The exam JSON could not be loaded.'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError(null);
                setReloadTick((n) => n + 1);
              }}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-[var(--brand-ink)] px-4 text-xs font-semibold text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Retry</span>
            </button>
            <Link
              href={mode === 'full' ? '/purchased' : `/exams/${examPack.urlSlug}`}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-white px-4 text-xs font-medium text-[var(--text-primary)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Go Back</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DynamicExamWorkspace
      exam={selectedSet}
      examPackId={examPack.id}
      examPackSlug={examPack.urlSlug}
      packTitle={examPack.title}
      mode={mode}
      userId={user?.uid ?? 'guest'}
      autostart={autostart}
      sourceNotice={sourceNotice}
      onExitFallback={() =>
        router.push(mode === 'full' ? '/purchased' : `/exams/${examPack.urlSlug}`)
      }
    />
  );
}
