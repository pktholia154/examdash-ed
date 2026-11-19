'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  MinusCircle,
  RotateCcw,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  evaluateFullExam,
  formatTimeSpentShort,
  type ExamSessionState,
  type NegativeMarkingConfig,
} from '@/core/exam/engine';
import type { ExamContext, NormalizedExamSet } from '@/core/exam/schema';
import {
  MultiVisualContentBlock,
  QuestionResponseBlock,
} from './UniversalExamRenderer';

export interface PostExamAnalyticsDashboardProps {
  readonly exam: NormalizedExamSet;
  readonly session: ExamSessionState;
  readonly packTitle: string;
  readonly backHref: string;
  readonly backLabel: string;
  readonly onRetake: () => void;
}

type ReviewFilter = 'all' | 'correct' | 'partial' | 'wrong' | 'unattempted' | 'marked';

const NEGATIVE_PRESETS: Array<{ label: string; config: NegativeMarkingConfig }> = [
  { label: 'Exam Default', config: { mode: 'default' } },
  { label: 'No Negative (0)', config: { mode: 'override', wrongPenaltyAbs: 0 } },
  { label: '-0.25', config: { mode: 'override', wrongPenaltyAbs: 0.25 } },
  { label: '-0.33', config: { mode: 'override', wrongPenaltyAbs: 0.33 } },
  { label: '-0.50', config: { mode: 'override', wrongPenaltyAbs: 0.5 } },
  { label: '-1.00', config: { mode: 'override', wrongPenaltyAbs: 1 } },
];

export function PostExamAnalyticsDashboard({
  exam,
  session,
  packTitle,
  backHref,
  backLabel,
  onRetake,
}: PostExamAnalyticsDashboardProps) {
  const [negConfig, setNegConfig] = useState<NegativeMarkingConfig>({ mode: 'default' });
  const [customPenalty, setCustomPenalty] = useState('');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [selectedSectionId, setSelectedSectionId] = useState<string>('all');

  const defaultReport = useMemo(
    () => evaluateFullExam(exam, session.responses, session.telemetry, { mode: 'default' }),
    [exam, session.responses, session.telemetry]
  );

  const report = useMemo(
    () => evaluateFullExam(exam, session.responses, session.telemetry, negConfig),
    [exam, negConfig, session.responses, session.telemetry]
  );

  const scoreDelta = Number((report.totalScore - defaultReport.totalScore).toFixed(2));

  const sectionChartData = useMemo(
    () =>
      Object.values(report.sectionResults).map((sec) => ({
        name: sec.title.length > 22 ? `${sec.title.slice(0, 20)}...` : sec.title,
        Score: sec.score,
        'Max Marks': sec.maxMarks,
        Accuracy: sec.accuracy,
      })),
    [report.sectionResults]
  );

  const contextMap = useMemo(() => {
    const map = new Map<string, ExamContext>();
    for (const sec of exam.sections) {
      for (const ctx of sec.contexts) {
        map.set(ctx.id, ctx);
      }
    }
    return map;
  }, [exam.sections]);

  const flatQuestions = useMemo(() => {
    const list: Array<{
      globalIndex: number;
      sectionId: string;
      sectionTitle: string;
      question: NormalizedExamSet['sections'][number]['questions'][number];
    }> = [];
    let idx = 1;
    for (const sec of exam.sections) {
      for (const q of sec.questions) {
        list.push({ globalIndex: idx++, sectionId: sec.id, sectionTitle: sec.title, question: q });
      }
    }
    return list;
  }, [exam.sections]);

  const filteredQuestions = useMemo(() => {
    return flatQuestions.filter(({ sectionId, question }) => {
      if (selectedSectionId !== 'all' && sectionId !== selectedSectionId) return false;
      const res = report.questionResults[question.id];
      if (!res) return false;
      if (reviewFilter === 'correct') return res.status === 'CORRECT';
      if (reviewFilter === 'partial') return res.status === 'PARTIAL';
      if (reviewFilter === 'wrong') return res.status === 'WRONG';
      if (reviewFilter === 'unattempted') return res.status === 'UNATTEMPTED';
      if (reviewFilter === 'marked') {
        return res.paletteStatus === 'marked' || res.paletteStatus === 'answered_marked';
      }
      return true;
    });
  }, [flatQuestions, report.questionResults, reviewFilter, selectedSectionId]);

  const avgTimeMs =
    report.attemptedCount > 0
      ? Math.round(report.totalTimeSpentMs / report.attemptedCount)
      : 0;

  return (
    <div className="min-h-dvh bg-[var(--surface-canvas)] text-[var(--text-primary)]">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-xs text-[var(--text-muted)]">
              Post-Exam Analytics & Solution Review · {packTitle}
            </p>
            <h1 className="truncate text-base font-bold text-[var(--text-primary)] sm:text-lg">
              {exam.title}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onRetake}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-3.5 text-xs font-semibold text-[var(--text-primary)] whitespace-nowrap hover:bg-[var(--surface-subtle)]"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Retake Test</span>
            </button>
            <Link
              href={backHref}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[var(--brand-ink)] px-3.5 text-xs font-semibold text-white whitespace-nowrap hover:bg-[var(--brand-ink-hover)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{backLabel}</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        {/* 1. Primary 4-Column KPI Summary Strip */}
        <section
          aria-label="Score summary metrics"
          className="grid grid-cols-2 divide-x divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] lg:grid-cols-4 lg:divide-y-0"
        >
          <div className="p-4 sm:p-5">
            <p className="text-xs font-medium text-[var(--text-muted)]">Net Score</p>
            <p className="font-mono-tabular mt-1 text-2xl font-bold text-[var(--text-primary)]">
              {report.totalScore} / {report.maxMarks}
            </p>
            <p className="font-mono-tabular mt-1 text-xs text-[var(--text-secondary)]">
              {report.percentage}% overall
              {scoreDelta !== 0 && (
                <span className={scoreDelta > 0 ? ' text-emerald-700' : ' text-rose-700'}>
                  {' '}
                  ({scoreDelta > 0 ? '+' : ''}
                  {scoreDelta} vs default)
                </span>
              )}
            </p>
          </div>

          <div className="p-4 sm:p-5">
            <p className="text-xs font-medium text-[var(--text-muted)]">Attempt Accuracy</p>
            <p className="font-mono-tabular mt-1 text-2xl font-bold text-[var(--text-primary)]">
              {report.accuracy}%
            </p>
            <p className="font-mono-tabular mt-1 text-xs text-[var(--text-secondary)]">
              {report.correctCount} Correct · {report.partialCount > 0 ? `${report.partialCount} Partial · ` : ''}
              {report.wrongCount} Wrong
            </p>
          </div>

          <div className="p-4 sm:p-5">
            <p className="text-xs font-medium text-[var(--text-muted)]">Questions Attempted</p>
            <p className="font-mono-tabular mt-1 text-2xl font-bold text-[var(--text-primary)]">
              {report.attemptedCount} / {report.totalQuestions}
            </p>
            <p className="font-mono-tabular mt-1 text-xs text-[var(--text-secondary)]">
              {report.unattemptedCount} Unattempted · {report.totalRevisits} Revisits
            </p>
          </div>

          <div className="p-4 sm:p-5">
            <p className="text-xs font-medium text-[var(--text-muted)]">Total Time Spent</p>
            <p className="font-mono-tabular mt-1 text-2xl font-bold text-[var(--text-primary)]">
              {formatTimeSpentShort(report.totalTimeSpentMs)}
            </p>
            <p className="font-mono-tabular mt-1 text-xs text-[var(--text-secondary)]">
              Avg {formatTimeSpentShort(avgTimeMs)} / attempted Q
            </p>
          </div>
        </section>

        {/* 2. Configurable Negative Marking What-If Simulator */}
        <section
          aria-labelledby="neg-marking-heading"
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-4 sm:p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                <h2 id="neg-marking-heading">Negative Marking Simulator</h2>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Recalculate net score and section totals under custom negative marking penalties.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {NEGATIVE_PRESETS.map((preset) => {
                const isSelected =
                  negConfig.mode === preset.config.mode &&
                  (negConfig.mode === 'default' ||
                    negConfig.wrongPenaltyAbs === preset.config.wrongPenaltyAbs);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setNegConfig(preset.config);
                      setCustomPenalty('');
                    }}
                    className={`min-h-[36px] rounded-md px-3 text-xs font-medium whitespace-nowrap transition-colors ${
                      isSelected
                        ? 'bg-[var(--brand-ink)] text-white'
                        : 'border border-[var(--border-subtle)] bg-[var(--surface-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}

              <div className="flex items-center gap-1.5 pl-1">
                <label htmlFor="custom-neg-penalty" className="sr-only">
                  Custom negative penalty
                </label>
                <input
                  id="custom-neg-penalty"
                  type="number"
                  step="0.05"
                  min="0"
                  max="10"
                  value={customPenalty}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCustomPenalty(val);
                    const num = Number(val);
                    if (val !== '' && Number.isFinite(num) && num >= 0) {
                      setNegConfig({ mode: 'override', wrongPenaltyAbs: num });
                    }
                  }}
                  placeholder="Custom"
                  className="font-mono-tabular h-9 w-20 rounded-md border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-2 text-xs text-[var(--text-primary)]"
                />
              </div>
            </div>
          </div>
        </section>

        {/* 3. Section-Wise Breakdown Table & Chart */}
        <section aria-labelledby="section-breakdown-heading" className="space-y-4">
          <h2 id="section-breakdown-heading" className="text-base font-bold text-[var(--text-primary)]">
            Section-Wise Breakdown
          </h2>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
              <table className="w-full border-collapse text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-subtle)] text-[var(--text-secondary)]">
                    <th className="px-3.5 py-2.5 font-semibold">Section</th>
                    <th className="px-3 py-2.5 font-semibold">Score</th>
                    <th className="px-3 py-2.5 font-semibold">Correct</th>
                    <th className="px-3 py-2.5 font-semibold">Wrong</th>
                    <th className="px-3 py-2.5 font-semibold">Skipped</th>
                    <th className="px-3 py-2.5 font-semibold">Accuracy</th>
                    <th className="px-3 py-2.5 font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {Object.values(report.sectionResults).map((sec) => (
                    <tr key={sec.sectionId}>
                      <td className="px-3.5 py-3 font-medium text-[var(--text-primary)]">
                        {sec.title}
                      </td>
                      <td className="font-mono-tabular px-3 py-3 font-semibold text-[var(--text-primary)]">
                        {sec.score} / {sec.maxMarks}
                      </td>
                      <td className="font-mono-tabular px-3 py-3 text-emerald-700">
                        {sec.correct}
                        {sec.partial > 0 ? ` (+${sec.partial}P)` : ''}
                      </td>
                      <td className="font-mono-tabular px-3 py-3 text-rose-700">{sec.wrong}</td>
                      <td className="font-mono-tabular px-3 py-3 text-[var(--text-muted)]">
                        {sec.unattempted}
                      </td>
                      <td className="font-mono-tabular px-3 py-3 text-[var(--text-secondary)]">
                        {sec.accuracy}%
                      </td>
                      <td className="font-mono-tabular px-3 py-3 text-[var(--text-secondary)]">
                        {formatTimeSpentShort(sec.timeSpentMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-4">
              <p className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">
                Score vs Maximum Marks
              </p>
              <div className="h-52 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sectionChartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar
                      dataKey="Score"
                      fill="#0f172a"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={48}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="Max Marks"
                      fill="#94a3b8"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={48}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </section>

        {/* 4. Question-by-Question Detailed Solution Review */}
        <section aria-labelledby="question-review-heading" className="space-y-4">
          <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="question-review-heading" className="text-base font-bold text-[var(--text-primary)]">
              Detailed Question Review ({filteredQuestions.length})
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              {exam.sections.length > 1 && (
                <select
                  aria-label="Filter review by section"
                  value={selectedSectionId}
                  onChange={(e) => setSelectedSectionId(e.target.value)}
                  className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-2.5 text-xs font-medium text-[var(--text-primary)]"
                >
                  <option value="all">All Sections</option>
                  {exam.sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              )}

              <div
                role="tablist"
                aria-label="Filter questions by result"
                className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-[var(--surface-subtle)] p-1"
              >
                {(
                  [
                    { key: 'all', label: `All (${report.totalQuestions})` },
                    { key: 'correct', label: `Correct (${report.correctCount})` },
                    ...(report.partialCount > 0
                      ? [{ key: 'partial' as const, label: `Partial (${report.partialCount})` }]
                      : []),
                    { key: 'wrong', label: `Wrong (${report.wrongCount})` },
                    { key: 'unattempted', label: `Skipped (${report.unattemptedCount})` },
                    { key: 'marked', label: 'Marked' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={reviewFilter === tab.key}
                    onClick={() => setReviewFilter(tab.key)}
                    className={`min-h-[32px] rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
                      reviewFilter === tab.key
                        ? 'bg-[var(--surface-canvas)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredQuestions.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-8 text-center text-sm text-[var(--text-secondary)]">
              No questions match this filter.
            </div>
          ) : (
            <div className="space-y-5">
              {filteredQuestions.map(({ globalIndex, sectionTitle, question }) => {
                const res = report.questionResults[question.id];
                const ctx = question.contextId ? contextMap.get(question.contextId) : null;
                const userAnswer = session.responses[question.id];

                return (
                  <article
                    key={question.id}
                    className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-4 sm:p-5"
                  >
                    {/* Header metadata row (unboxed, dual-coded status) */}
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2 font-medium text-[var(--text-secondary)]">
                        <span className="font-mono-tabular font-bold text-[var(--text-primary)]">
                          Q{globalIndex}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{sectionTitle}</span>
                        <span aria-hidden="true">·</span>
                        <span>{question.type}</span>
                      </div>

                      <div className="font-mono-tabular flex flex-wrap items-center gap-3">
                        <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                          {formatTimeSpentShort(res.timeSpentMs)}
                        </span>
                        <span className="text-[var(--text-muted)]">
                          Revisits: {res.revisitCount}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            res.status === 'CORRECT'
                              ? 'text-emerald-700'
                              : res.status === 'PARTIAL'
                                ? 'text-amber-700'
                                : res.status === 'WRONG'
                                  ? 'text-rose-700'
                                  : 'text-[var(--text-muted)]'
                          }`}
                        >
                          {res.status === 'CORRECT' && (
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {res.status === 'WRONG' && (
                            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {(res.status === 'UNATTEMPTED' || res.status === 'PARTIAL') && (
                            <MinusCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          <span>
                            {res.status === 'CORRECT'
                              ? 'Correct'
                              : res.status === 'PARTIAL'
                                ? 'Partial'
                                : res.status === 'WRONG'
                                  ? 'Wrong'
                                  : 'Unattempted'}{' '}
                            ({res.marksAwarded > 0 ? `+${res.marksAwarded}` : res.marksAwarded})
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Optional collapsible Context for directions/visuals */}
                    {ctx && (
                      <details className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3.5 py-2.5">
                        <summary className="cursor-pointer text-xs font-semibold text-[var(--text-primary)]">
                          View Shared Directions & Reference Visuals
                        </summary>
                        <div className="mt-3">
                          <MultiVisualContentBlock text={ctx.text} visuals={ctx.visuals} />
                        </div>
                      </details>
                    )}

                    {/* Prompt & Question Visuals */}
                    <MultiVisualContentBlock text={question.prompt} visuals={question.visuals} />

                    {/* Read-only Response Comparison */}
                    <QuestionResponseBlock
                      question={question}
                      userAnswer={userAnswer}
                      readOnlyReview
                      showVirtualKeypad={false}
                    />

                    {/* Step-by-Step Solution & Explanation */}
                    {(question.explanation ||
                      (question.explanationVisuals && question.explanationVisuals.length > 0)) && (
                      <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-4">
                        <p className="mb-2 text-xs font-bold text-[var(--text-primary)]">
                          Solution & Explanation
                        </p>
                        <MultiVisualContentBlock
                          text={question.explanation}
                          visuals={question.explanationVisuals}
                        />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
