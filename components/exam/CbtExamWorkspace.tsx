'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eraser,
  FileText,
  Flag,
  HelpCircle,
  LayoutGrid,
  Lock,
  Play,
  Send,
  X,
} from 'lucide-react';
import {
  advanceToNextTimedSection,
  buildAttemptSummary,
  buildExamSessionId,
  clearQuestionResponse,
  computeDriftFreeTimer,
  createInitialExamSession,
  flushActiveQuestionTime,
  formatDurationClock,
  formatTimeSpentShort,
  getPaletteCounts,
  getSectionAttemptedCount,
  goToPreviousQuestion,
  markForReviewAndNext,
  saveAndNextQuestion,
  startExamSession,
  submitExamSession,
  updateResponse,
  visitQuestion,
  type ExamAnswerValue,
  type ExamSessionState,
} from '@/core/exam/engine';
import {
  deleteExamSessionLocal,
  loadExamSessionLocal,
  saveExamSessionLocal,
} from '@/core/exam/storage';
import type { ExamContext, NormalizedExamSet } from '@/core/exam/schema';
import { MultiVisualContentBlock, QuestionResponseBlock } from './UniversalExamRenderer';
import { QuestionPaletteSidebar, getPaletteStatusMeta } from './QuestionPaletteSidebar';
import { ScientificCalculator } from './ScientificCalculator';
import { PostExamAnalyticsDashboard } from './PostExamAnalyticsDashboard';

export interface CbtExamWorkspaceProps {
  readonly exam: NormalizedExamSet;
  readonly examPackId: string;
  readonly examPackSlug: string;
  readonly packTitle: string;
  readonly mode: 'sample' | 'full';
  readonly userId: string;
  readonly autostart?: boolean;
  readonly sourceNotice?: string | null;
}

export function CbtExamWorkspace({
  exam,
  examPackId,
  examPackSlug,
  packTitle,
  mode,
  userId,
  autostart = false,
  sourceNotice = null,
}: CbtExamWorkspaceProps) {
  const sessionId = useMemo(
    () => buildExamSessionId(userId, examPackId, exam.id, mode),
    [userId, examPackId, exam.id, mode]
  );

  const [session, setSession] = useState<ExamSessionState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [mobilePaletteOpen, setMobilePaletteOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [showQuestionPaper, setShowQuestionPaper] = useState(false);
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showRetakeConfirm, setShowRetakeConfirm] = useState(false);

  const sessionRef = useRef<ExamSessionState | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const sessionPhase = session?.phase;

  const backHref = mode === 'full' ? '/purchased' : `/exams/${examPackSlug}`;
  const backLabel = mode === 'full' ? 'Purchased Library' : 'Exam Details';

  // Persist helper (write-ahead IndexedDB + localStorage)
  const persistState = useCallback(
    (next: ExamSessionState) => {
      const summary = buildAttemptSummary(next, exam, next.updatedAtMs);
      void saveExamSessionLocal(next, summary);
    },
    [exam]
  );

  // Hydrate existing session from IndexedDB / localStorage on mount
  useEffect(() => {
    let active = true;
    void loadExamSessionLocal(sessionId).then((saved) => {
      if (!active) return;
      const now = Date.now();
      if (saved && saved.examSetId === exam.id) {
        // Reconcile wall-clock expiry cleanly if user closed tab and returned after timer ended
        const timer = computeDriftFreeTimer(saved, exam, now);
        if (saved.phase === 'in_progress' && timer.isExamExpired) {
          const autoSubmitted = submitExamSession(saved, exam, now);
          setSession(autoSubmitted);
          persistState(autoSubmitted);
        } else {
          setSession(saved);
        }
      } else {
        const fresh = createInitialExamSession({
          userId,
          examPackId,
          examPackSlug,
          exam,
          mode,
          nowMs: now,
          startImmediately: autostart,
        });
        setSession(fresh);
        if (autostart) {
          persistState(fresh);
        }
      }
      setNowMs(now);
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, [autostart, exam, examPackId, examPackSlug, mode, persistState, sessionId, userId]);

  // Drift-free 500ms display ticker (purely derives from wall-clock Date.now(), never decrements)
  useEffect(() => {
    if (sessionPhase !== 'in_progress') return;

    const tick = () => {
      const current = sessionRef.current;
      if (!current || current.phase !== 'in_progress') return;
      const t = Date.now();
      setNowMs(t);

      const snapshot = computeDriftFreeTimer(current, exam, t);
      if (snapshot.isExamExpired) {
        const submitted = submitExamSession(current, exam, t);
        setSession(submitted);
        persistState(submitted);
      } else if (current.sectionalTiming && snapshot.isActiveSectionExpired) {
        const nextSec = advanceToNextTimedSection(current, exam, t);
        setSession(nextSec);
        persistState(nextSec);
      }
    };

    const intervalId = window.setInterval(tick, 500);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && sessionRef.current?.phase === 'in_progress') {
        const flushed = flushActiveQuestionTime(sessionRef.current, exam, Date.now());
        setSession(flushed);
        persistState(flushed);
      } else if (document.visibilityState === 'visible') {
        tick();
      }
    };
    const onBeforeUnload = () => {
      if (sessionRef.current?.phase === 'in_progress') {
        const flushed = flushActiveQuestionTime(sessionRef.current, exam, Date.now());
        const summary = buildAttemptSummary(flushed, exam, flushed.updatedAtMs);
        void saveExamSessionLocal(flushed, summary);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [exam, persistState, sessionPhase]);

  // Periodic background checkpoint every 10 seconds so active question time is saved even on hard crash
  useEffect(() => {
    if (sessionPhase !== 'in_progress') return;
    const checkpointId = window.setInterval(() => {
      if (!sessionRef.current || sessionRef.current.phase !== 'in_progress') return;
      const flushed = flushActiveQuestionTime(sessionRef.current, exam, Date.now());
      setSession(flushed);
      persistState(flushed);
    }, 10_000);
    return () => window.clearInterval(checkpointId);
  }, [exam, persistState, sessionPhase]);

  const applyTransition = useCallback(
    (updater: (prev: ExamSessionState, now: number) => ExamSessionState) => {
      const now = Date.now();
      setNowMs(now);
      setSession((prev) => {
        if (!prev) return prev;
        const next = updater(prev, now);
        if (next !== prev) {
          persistState(next);
        }
        return next;
      });
    },
    [persistState]
  );

  const handleStartExam = useCallback(() => {
    applyTransition((prev, now) => startExamSession(prev, exam, now));
  }, [applyTransition, exam]);

  const handleSelectSection = useCallback(
    (secIdx: number) => {
      applyTransition((prev, now) => visitQuestion(prev, exam, secIdx, 0, now));
    },
    [applyTransition, exam]
  );

  const handleSelectQuestion = useCallback(
    (qIdx: number) => {
      applyTransition((prev, now) => visitQuestion(prev, exam, prev.activeSectionIndex, qIdx, now));
    },
    [applyTransition, exam]
  );

  const handleResponseChange = useCallback(
    (questionId: string, val: ExamAnswerValue) => {
      applyTransition((prev, now) => updateResponse(prev, exam, questionId, val, now));
    },
    [applyTransition, exam]
  );

  const handleClearResponse = useCallback(
    (questionId: string) => {
      applyTransition((prev, now) => clearQuestionResponse(prev, exam, questionId, now));
    },
    [applyTransition, exam]
  );

  const handleSaveAndNext = useCallback(() => {
    applyTransition((prev, now) => saveAndNextQuestion(prev, exam, now));
  }, [applyTransition, exam]);

  const handleMarkAndNext = useCallback(() => {
    applyTransition((prev, now) => markForReviewAndNext(prev, exam, now));
  }, [applyTransition, exam]);

  const handlePrevQuestion = useCallback(() => {
    applyTransition((prev, now) => goToPreviousQuestion(prev, exam, now));
  }, [applyTransition, exam]);

  const handleFinishTimedSection = useCallback(() => {
    applyTransition((prev, now) => advanceToNextTimedSection(prev, exam, now));
  }, [applyTransition, exam]);

  const handleConfirmSubmit = useCallback(() => {
    setShowSubmitConfirm(false);
    setCalcOpen(false);
    applyTransition((prev, now) => submitExamSession(prev, exam, now));
  }, [applyTransition, exam]);

  const handleConfirmRetake = useCallback(() => {
    setShowRetakeConfirm(false);
    const now = Date.now();
    void deleteExamSessionLocal(sessionId);
    const fresh = createInitialExamSession({
      userId,
      examPackId,
      examPackSlug,
      exam,
      mode,
      nowMs: now,
      startImmediately: true,
    });
    setNowMs(now);
    setSession(fresh);
    persistState(fresh);
  }, [exam, examPackId, examPackSlug, mode, persistState, sessionId, userId]);

  const activeSection = session ? exam.sections[session.activeSectionIndex] : exam.sections[0];
  const activeQuestion =
    session && activeSection ? activeSection.questions[session.activeQuestionIndex] : null;

  const contextMap = useMemo(() => {
    const map = new Map<string, ExamContext>();
    for (const sec of exam.sections) {
      for (const ctx of sec.contexts) {
        map.set(ctx.id, ctx);
      }
    }
    return map;
  }, [exam.sections]);

  const activeContext =
    activeQuestion?.contextId ? contextMap.get(activeQuestion.contextId) ?? null : null;

  // Keyboard Shortcuts (disabled while typing inside NAT input or when modals are open)
  useEffect(() => {
    if (!session || session.phase !== 'in_progress' || !activeQuestion) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        setShowSubmitConfirm(false);
        setShowQuestionPaper(false);
        setShowInstructionsModal(false);
        setMobilePaletteOpen(false);
        setCalcOpen(false);
        return;
      }

      if (isInputFocused || showSubmitConfirm || showQuestionPaper || showInstructionsModal) return;

      const key = e.key.toLowerCase();
      if (key === 'arrowright' || key === 'n') {
        e.preventDefault();
        handleSaveAndNext();
      } else if (key === 'arrowleft' || key === 'p') {
        e.preventDefault();
        handlePrevQuestion();
      } else if (key === 'm') {
        e.preventDefault();
        handleMarkAndNext();
      } else if (key === 'c') {
        e.preventDefault();
        handleClearResponse(activeQuestion.id);
      } else if (key === 'k' && exam.calculator) {
        e.preventDefault();
        setCalcOpen((v) => !v);
      } else if (e.key === '?') {
        e.preventDefault();
        setShowInstructionsModal((v) => !v);
      } else if (
        activeQuestion.type !== 'NAT' &&
        Array.isArray(activeQuestion.options) &&
        activeQuestion.options.length > 0
      ) {
        // Map 1..5 or A..E to option selection
        const opts = activeQuestion.options;
        const numIdx = Number(key) - 1;
        const opt =
          Number.isInteger(numIdx) && numIdx >= 0 && numIdx < opts.length
            ? opts[numIdx]
            : opts.find((o) => o.id.toLowerCase() === key);

        if (opt) {
          e.preventDefault();
          const cur = session.responses[activeQuestion.id];
          if (activeQuestion.type === 'MCQ') {
            handleResponseChange(activeQuestion.id, cur === opt.id ? null : opt.id);
          } else {
            const arr = Array.isArray(cur) ? cur : [];
            const next = arr.includes(opt.id)
              ? arr.filter((id) => id !== opt!.id)
              : Array.from(new Set([...arr, opt.id])).sort();
            handleResponseChange(activeQuestion.id, next);
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeQuestion,
    exam.calculator,
    handleClearResponse,
    handleMarkAndNext,
    handlePrevQuestion,
    handleResponseChange,
    handleSaveAndNext,
    session,
    showInstructionsModal,
    showQuestionPaper,
    showSubmitConfirm,
  ]);

  if (!hydrated || !session) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--surface-canvas)] text-sm text-[var(--text-secondary)]">
        Preparing CBT Exam Engine...
      </div>
    );
  }

  // --- PHASE 3: POST-EXAM ANALYTICS & SOLUTION REVIEW ---
  if (session.phase === 'submitted') {
    return (
      <>
        <PostExamAnalyticsDashboard
          exam={exam}
          session={session}
          packTitle={packTitle}
          backHref={backHref}
          backLabel={backLabel}
          onRetake={() => setShowRetakeConfirm(true)}
        />

        {showRetakeConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="retake-modal-title"
              className="w-full max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--surface-canvas)] p-6 shadow-xl"
            >
              <h2 id="retake-modal-title" className="text-base font-bold text-[var(--text-primary)]">
                Retake {exam.title}?
              </h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                This will reset your saved responses and start a fresh timed attempt from zero.
              </p>
              <div className="mt-5 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowRetakeConfirm(false)}
                  className="min-h-[40px] rounded-lg border border-[var(--border-strong)] px-4 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRetake}
                  className="min-h-[40px] rounded-lg bg-[var(--brand-ink)] px-4 text-xs font-semibold text-white hover:bg-[var(--brand-ink-hover)]"
                >
                  Start Fresh Attempt
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // --- PHASE 1: PRE-EXAM INSTRUCTIONS SCREEN ---
  if (session.phase === 'instructions') {
    return (
      <div className="min-h-dvh bg-[var(--surface-canvas)] text-[var(--text-primary)]">
        <header className="border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)]">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
            <Link
              href={backHref}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to {backLabel}</span>
            </Link>
            <span className="text-xs font-medium text-[var(--text-muted)]">
              {mode === 'sample' ? 'Free Sample Test' : 'Full Exam Edition'}
            </span>
          </div>
        </header>

        <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-[var(--text-muted)]">{packTitle}</p>
            <h1 className="text-balance text-2xl font-bold text-[var(--text-primary)] sm:text-3xl">
              {exam.title}
            </h1>
            <p className="font-mono-tabular text-xs text-[var(--text-secondary)]">
              {exam.totalQuestions} Questions · {exam.totalMarks} Marks · {exam.duration} Minutes
              {exam.sectionalTiming ? ' · Sectional Timing Enabled' : ' · Free Section Switching'}
              {exam.calculator ? ` · On-screen ${exam.calculator} calculator` : ''}
            </p>
          </div>

          {sourceNotice && (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-4 py-2.5 text-xs text-[var(--text-secondary)]">
              {sourceNotice}
            </div>
          )}

          {/* Section Breakdown Preview */}
          <section className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
            <table className="w-full border-collapse text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-subtle)]">
                  <th className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">Section</th>
                  <th className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">Questions</th>
                  <th className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">Duration</th>
                  <th className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">Attempt Cap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {exam.sections.map((sec, idx) => (
                  <tr key={sec.id}>
                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                      {idx + 1}. {sec.title}
                    </td>
                    <td className="font-mono-tabular px-4 py-3 text-[var(--text-secondary)]">
                      {sec.questions.length}
                    </td>
                    <td className="font-mono-tabular px-4 py-3 text-[var(--text-secondary)]">
                      {sec.duration > 0 ? `${sec.duration} min` : 'Shared'}
                    </td>
                    <td className="font-mono-tabular px-4 py-3 text-[var(--text-secondary)]">
                      {sec.maxAttempts ? `Max ${sec.maxAttempts}` : 'All'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Indian CBT Palette Legend + Keyboard Shortcuts */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <section className="rounded-xl border border-[var(--border-subtle)] p-4">
              <h2 className="text-sm font-bold text-[var(--text-primary)]">Question Palette Guide</h2>
              <ul className="mt-3 space-y-2 text-xs text-[var(--text-secondary)]">
                {(
                  [
                    ['not_visited', 'You have not visited the question yet.'],
                    ['not_answered', 'Visited but left unanswered.'],
                    ['answered', 'Answered and saved for evaluation.'],
                    ['marked', 'Marked for review without an answer.'],
                    ['answered_marked', 'Answered & marked for review (considered for evaluation).'],
                  ] as const
                ).map(([status, desc]) => {
                  const meta = getPaletteStatusMeta(status);
                  return (
                    <li key={status} className="flex items-center gap-2.5">
                      <span
                        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold ${meta.swatchClass}`}
                      >
                        1
                      </span>
                      <span>{desc}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="rounded-xl border border-[var(--border-subtle)] p-4">
              <h2 className="text-sm font-bold text-[var(--text-primary)]">
                Keyboard Shortcuts & Crash Safety
              </h2>
              <ul className="mt-3 space-y-1.5 text-xs text-[var(--text-secondary)]">
                <li>
                  <strong className="font-mono-tabular text-[var(--text-primary)]">A–E / 1–5</strong>{' '}
                  — Select or toggle MCQ/MSQ option
                </li>
                <li>
                  <strong className="font-mono-tabular text-[var(--text-primary)]">N / →</strong> —
                  Save & Next question
                </li>
                <li>
                  <strong className="font-mono-tabular text-[var(--text-primary)]">P / ←</strong> —
                  Previous question
                </li>
                <li>
                  <strong className="font-mono-tabular text-[var(--text-primary)]">M</strong> — Mark
                  for Review & Next
                </li>
                <li>
                  <strong className="font-mono-tabular text-[var(--text-primary)]">C</strong> — Clear
                  current response
                </li>
                {exam.calculator && (
                  <li>
                    <strong className="font-mono-tabular text-[var(--text-primary)]">K</strong> —
                    Toggle on-screen calculator
                  </li>
                )}
              </ul>
              <p className="mt-3 border-t border-[var(--border-subtle)] pt-2.5 text-[11px] text-[var(--text-muted)]">
                All answers, palette statuses, and exact timer timestamps persist locally in
                IndexedDB on every click—accidental refreshes never lose progress.
              </p>
            </section>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border-subtle)] pt-5">
            <Link
              href={backHref}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--border-strong)] px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={handleStartExam}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-ink)] px-6 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-ink-hover)]"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              <span>Start Examination</span>
            </button>
          </div>
        </main>
      </div>
    );
  }

  // --- PHASE 2: ACTIVE LIVE CBT EXAM WORKSPACE ---
  const timer = computeDriftFreeTimer(session, exam, nowMs);
  const displayRemainingMs = session.sectionalTiming
    ? timer.activeSectionRemainingMs
    : timer.totalRemainingMs;
  const isCriticalTime = displayRemainingMs <= 60_000;
  const isWarningTime = !isCriticalTime && displayRemainingMs <= 5 * 60_000;

  const sectionCounts = getPaletteCounts(session, exam, session.activeSectionIndex);
  const overallCounts = getPaletteCounts(session, exam);
  const currentSecAttempted = getSectionAttemptedCount(
    exam,
    session.activeSectionIndex,
    session.responses
  );
  const isAttemptCapReached = Boolean(
    activeSection.maxAttempts && currentSecAttempted >= activeSection.maxAttempts
  );

  const activeTel = activeQuestion ? session.telemetry[activeQuestion.id] : null;
  const liveQuestionElapsedMs =
    (activeTel?.timeSpentMs ?? 0) +
    (session.lastActiveAtMs ? Math.max(0, nowMs - session.lastActiveAtMs) : 0);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--surface-canvas)] text-[var(--text-primary)]">
      {/* 1. Compact Sticky CBT Header */}
      <header className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)]">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-5">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-[var(--text-primary)] sm:text-base">
              {exam.title}
            </h1>
            <p className="hidden truncate text-[11px] text-[var(--text-muted)] sm:block">
              {packTitle} · {mode === 'sample' ? 'Free Sample Test' : 'Full Edition'}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Drift-free Wall-Clock Countdown Timer */}
            <div
              role="timer"
              aria-live="off"
              aria-label={`Time remaining ${formatDurationClock(displayRemainingMs)}`}
              data-testid="cbt-timer"
              className={`font-mono-tabular inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 text-sm font-bold ${
                isCriticalTime
                  ? 'border-rose-300 bg-rose-50 text-rose-800'
                  : isWarningTime
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-[var(--border-strong)] bg-[var(--surface-subtle)] text-[var(--text-primary)]'
              }`}
            >
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{formatDurationClock(displayRemainingMs)}</span>
            </div>

            {exam.calculator && (
              <button
                type="button"
                onClick={() => setCalcOpen((v) => !v)}
                aria-pressed={calcOpen}
                aria-label="Toggle Calculator"
                className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  calcOpen
                    ? 'border-[var(--brand-ink)] bg-[var(--brand-ink)] text-white'
                    : 'border-[var(--border-strong)] bg-[var(--surface-canvas)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                }`}
              >
                <Calculator className="h-4 w-4" aria-hidden="true" />
                <span className="hidden md:inline">Calculator</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowInstructionsModal(true)}
              aria-label="Exam instructions and shortcuts"
              className="hidden min-h-[38px] items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] sm:inline-flex"
            >
              <HelpCircle className="h-4 w-4" aria-hidden="true" />
              <span className="hidden xl:inline">Shortcuts</span>
            </button>

            <button
              type="button"
              onClick={() => setMobilePaletteOpen(true)}
              aria-label={`Open Question Palette (${sectionCounts.answered + sectionCounts.answeredMarked} of ${sectionCounts.total} answered)`}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-2.5 text-xs font-semibold text-[var(--text-primary)] lg:hidden"
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              <span className="font-mono-tabular">
                {sectionCounts.answered + sectionCounts.answeredMarked}/{sectionCounts.total}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowSubmitConfirm(true)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[var(--brand-ink)] px-3 text-xs font-semibold text-white whitespace-nowrap hover:bg-[var(--brand-ink-hover)] lg:hidden"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Submit</span>
            </button>
          </div>
        </div>

        {/* 2. Sectional Tabs Row */}
        <div className="flex items-center justify-between gap-2 overflow-x-auto border-t border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-1.5 sm:px-5">
          <div role="tablist" aria-label="Exam sections" className="flex items-center gap-1.5">
            {exam.sections.map((sec, idx) => {
              const isActive = idx === session.activeSectionIndex;
              const isLocked = session.sectionalTiming && !isActive;
              const secCounts = getPaletteCounts(session, exam, idx);
              return (
                <button
                  key={sec.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  disabled={isLocked}
                  onClick={() => handleSelectSection(idx)}
                  className={`inline-flex min-h-[34px] items-center gap-2 rounded-md px-3 text-xs font-semibold whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-[var(--surface-canvas)] text-[var(--text-primary)] shadow-xs'
                      : isLocked
                        ? 'cursor-not-allowed text-[var(--text-muted)] opacity-60'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {isLocked && <Lock className="h-3 w-3" aria-hidden="true" />}
                  <span>{sec.title}</span>
                  <span className="font-mono-tabular text-[11px] font-medium text-[var(--text-muted)]">
                    {secCounts.answered + secCounts.answeredMarked}/{secCounts.total}
                  </span>
                </button>
              );
            })}
          </div>

          {session.sectionalTiming &&
            session.activeSectionIndex + 1 < exam.sections.length && (
              <button
                type="button"
                onClick={handleFinishTimedSection}
                className="min-h-[32px] shrink-0 rounded-md border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-2.5 text-xs font-semibold text-[var(--text-primary)] whitespace-nowrap hover:bg-[var(--surface-hover)]"
              >
                Next Section →
              </button>
            )}
        </div>
      </header>

      {/* 3. Main Workspace: Split-Pane Content + Right Question Palette */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {activeQuestion && (
            <>
              {/* Question Metadata Strip */}
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-4 py-2.5 text-xs sm:px-6">
                <div className="flex flex-wrap items-center gap-2 font-medium text-[var(--text-secondary)]">
                  <span className="font-mono-tabular text-sm font-bold text-[var(--text-primary)]">
                    Question {session.activeQuestionIndex + 1} of {activeSection.questions.length}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {activeQuestion.type === 'MCQ'
                      ? 'Single Choice (MCQ)'
                      : activeQuestion.type === 'MSQ'
                        ? 'Multiple Select (MSQ)'
                        : 'Numerical Answer (NAT)'}
                  </span>
                  {activeSection.maxAttempts && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular font-semibold text-[var(--text-primary)]">
                        Section Attempts: {currentSecAttempted}/{activeSection.maxAttempts}
                      </span>
                    </>
                  )}
                </div>

                <div className="font-mono-tabular flex flex-wrap items-center gap-3 text-[var(--text-secondary)]">
                  <span>
                    Marks: <strong className="text-emerald-700">+{activeQuestion.marks.correct}</strong>
                    {activeQuestion.marks.wrong !== 0 && (
                      <>
                        {' / '}
                        <strong className="text-rose-700">
                          -{Math.abs(activeQuestion.marks.wrong)}
                        </strong>
                      </>
                    )}
                    {activeQuestion.marks.partial && activeQuestion.marks.partial > 0 ? (
                      <> · Partial +{activeQuestion.marks.partial}</>
                    ) : null}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Time: {formatTimeSpentShort(liveQuestionElapsedMs)}</span>
                </div>
              </div>

              {/* Scrollable Question Stage (Desktop 50/50 split when shared Context exists) */}
              <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
                {activeContext ? (
                  <div className="grid h-full grid-cols-1 divide-y divide-[var(--border-subtle)] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                    {/* Left Pane: Shared Context / Directions / Charts / Tables */}
                    <section
                      aria-label="Directions and reference visuals"
                      className="p-4 sm:p-6 lg:h-full lg:overflow-y-auto"
                    >
                      <MultiVisualContentBlock
                        text={activeContext.text}
                        visuals={activeContext.visuals}
                      />
                    </section>

                    {/* Right Pane: Question Prompt + Response Input */}
                    <section
                      aria-label="Question and answer choices"
                      className="p-4 sm:p-6 lg:h-full lg:overflow-y-auto"
                    >
                      <MultiVisualContentBlock
                        text={activeQuestion.prompt}
                        visuals={activeQuestion.visuals}
                      />
                      <QuestionResponseBlock
                        question={activeQuestion}
                        userAnswer={session.responses[activeQuestion.id]}
                        onChange={(val) => handleResponseChange(activeQuestion.id, val)}
                        isAttemptCapReached={isAttemptCapReached}
                        showVirtualKeypad
                      />
                    </section>
                  </div>
                ) : (
                  <div className="h-full overflow-y-auto p-4 sm:p-6">
                    <div className="mx-auto max-w-3xl">
                      <MultiVisualContentBlock
                        text={activeQuestion.prompt}
                        visuals={activeQuestion.visuals}
                      />
                      <QuestionResponseBlock
                        question={activeQuestion}
                        userAnswer={session.responses[activeQuestion.id]}
                        onChange={(val) => handleResponseChange(activeQuestion.id, val)}
                        isAttemptCapReached={isAttemptCapReached}
                        showVirtualKeypad
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Sticky Bottom Indian CBT Action Bar */}
              <footer className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-2.5 py-2 sm:px-5 sm:py-2.5">
                <div className="flex items-center justify-between gap-1.5 sm:gap-2">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <button
                      type="button"
                      onClick={handleMarkAndNext}
                      aria-label="Mark for Review & Next"
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-2.5 text-xs font-semibold text-[var(--text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--surface-subtle)] sm:min-h-[42px] sm:px-3.5"
                    >
                      <Flag className="h-3.5 w-3.5 text-violet-700" aria-hidden="true" />
                      <span className="sm:hidden">Review</span>
                      <span className="hidden sm:inline">Mark for Review & Next</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleClearResponse(activeQuestion.id)}
                      aria-label="Clear Response"
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-2.5 text-xs font-medium text-[var(--text-secondary)] whitespace-nowrap transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] sm:min-h-[42px] sm:px-3"
                    >
                      <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sm:hidden">Clear</span>
                      <span className="hidden sm:inline">Clear Response</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <button
                      type="button"
                      onClick={handlePrevQuestion}
                      aria-label="Previous"
                      disabled={session.activeQuestionIndex === 0 && (session.sectionalTiming || session.activeSectionIndex === 0)}
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-2.5 text-xs font-semibold text-[var(--text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--surface-subtle)] disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-[42px] sm:px-3"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      <span className="sm:hidden">Prev</span>
                      <span className="hidden sm:inline">Previous</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveAndNext}
                      aria-label="Save & Next"
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-[var(--brand-ink)] px-3 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[var(--brand-ink-hover)] sm:min-h-[42px] sm:gap-1.5 sm:px-4"
                    >
                      <span className="sm:hidden">Save</span>
                      <span className="hidden sm:inline">Save & Next</span>
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </footer>
            </>
          )}
        </main>

        {/* Right Question Palette Sidebar (Desktop + Mobile Drawer) */}
        <QuestionPaletteSidebar
          section={activeSection}
          activeQuestionIndex={session.activeQuestionIndex}
          telemetry={session.telemetry}
          sectionCounts={sectionCounts}
          onSelectQuestion={handleSelectQuestion}
          onOpenQuestionPaper={() => setShowQuestionPaper(true)}
          onOpenInstructions={() => setShowInstructionsModal(true)}
          onRequestSubmit={() => setShowSubmitConfirm(true)}
          mobileOpen={mobilePaletteOpen}
          onCloseMobile={() => setMobilePaletteOpen(false)}
        />
      </div>

      {/* Floating Scientific / Basic Calculator */}
      {calcOpen && exam.calculator && (
        <ScientificCalculator mode={exam.calculator} onClose={() => setCalcOpen(false)} />
      )}

      {/* Question Paper Overview Modal */}
      {showQuestionPaper && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="qpaper-title"
            className="flex max-h-[85dvh] w-full max-w-3xl flex-col rounded-xl border border-[var(--border-strong)] bg-[var(--surface-canvas)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-[var(--text-primary)]" aria-hidden="true" />
                <h2 id="qpaper-title" className="text-sm font-bold text-[var(--text-primary)]">
                  Question Paper — {activeSection.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowQuestionPaper(false)}
                aria-label="Close question paper"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 divide-y divide-[var(--border-subtle)] overflow-y-auto px-5 py-2">
              {activeSection.questions.map((q, idx) => (
                <div key={q.id} className="space-y-2 py-4">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono-tabular font-bold text-[var(--text-primary)]">
                      Q{idx + 1} · {q.type} (+{q.marks.correct} / {q.marks.wrong})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        handleSelectQuestion(idx);
                        setShowQuestionPaper(false);
                      }}
                      className="text-xs font-semibold text-[var(--brand-accent)] hover:underline"
                    >
                      Jump to Q{idx + 1}
                    </button>
                  </div>
                  <MultiVisualContentBlock text={q.prompt} visuals={[]} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Instructions & Keyboard Shortcuts Modal */}
      {showInstructionsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="instr-modal-title"
            className="w-full max-w-lg rounded-xl border border-[var(--border-strong)] bg-[var(--surface-canvas)] p-5 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h2 id="instr-modal-title" className="text-sm font-bold text-[var(--text-primary)]">
                Instructions & Keyboard Shortcuts
              </h2>
              <button
                type="button"
                onClick={() => setShowInstructionsModal(false)}
                aria-label="Close instructions"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-4 space-y-3 text-xs text-[var(--text-secondary)]">
              <p>
                <strong>Answered & Marked for Review</strong> responses are automatically considered
                for evaluation upon submission.
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3 font-mono-tabular">
                <span>A–E / 1–5 : Pick option</span>
                <span>N / → : Save & Next</span>
                <span>P / ← : Previous</span>
                <span>M : Mark & Next</span>
                <span>C : Clear response</span>
                <span>K : Toggle Calculator</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Progress and exact wall-clock countdown are saved instantly to IndexedDB on every
                interaction.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Submit Exam Summary Confirmation Modal */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-modal-title"
            className="w-full max-w-xl rounded-xl border border-[var(--border-strong)] bg-[var(--surface-canvas)] p-5 shadow-xl sm:p-6"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
              <div>
                <h2 id="submit-modal-title" className="text-base font-bold text-[var(--text-primary)]">
                  Submit Examination?
                </h2>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Review your section-wise attempt summary below. Once submitted, your Post-Exam
                  Analytics & Solution Review will be generated immediately.
                </p>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-subtle)]">
                    <th className="px-3 py-2 font-semibold">Section</th>
                    <th className="px-3 py-2 font-semibold">Answered</th>
                    <th className="px-3 py-2 font-semibold">Not Ans</th>
                    <th className="px-3 py-2 font-semibold">Marked</th>
                    <th className="px-3 py-2 font-semibold">Not Visited</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] font-mono-tabular">
                  {exam.sections.map((sec, idx) => {
                    const c = getPaletteCounts(session, exam, idx);
                    return (
                      <tr key={sec.id}>
                        <td className="px-3 py-2 font-sans font-medium text-[var(--text-primary)]">
                          {sec.title}
                        </td>
                        <td className="px-3 py-2 text-emerald-700">
                          {c.answered + c.answeredMarked}
                        </td>
                        <td className="px-3 py-2 text-rose-700">{c.notAnswered}</td>
                        <td className="px-3 py-2 text-violet-700">
                          {c.marked + c.answeredMarked}
                        </td>
                        <td className="px-3 py-2 text-[var(--text-muted)]">{c.notVisited}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="font-mono-tabular mt-3 text-xs text-[var(--text-secondary)]">
              Total Answered (Evaluated):{' '}
              <strong className="text-[var(--text-primary)]">
                {overallCounts.answered + overallCounts.answeredMarked} / {overallCounts.total}
              </strong>{' '}
              · Time Left:{' '}
              <strong className="text-[var(--text-primary)]">
                {formatDurationClock(timer.totalRemainingMs)}
              </strong>
            </p>

            <div className="mt-5 flex flex-wrap justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(false)}
                className="min-h-[42px] rounded-lg border border-[var(--border-strong)] px-4 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
              >
                Return to Exam
              </button>
              <button
                type="button"
                onClick={handleConfirmSubmit}
                className="min-h-[42px] rounded-lg bg-[var(--brand-ink)] px-5 text-xs font-semibold text-white hover:bg-[var(--brand-ink-hover)]"
              >
                Confirm & Submit Test
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
