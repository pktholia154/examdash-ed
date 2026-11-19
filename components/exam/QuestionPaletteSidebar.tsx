'use client';

import React, { memo } from 'react';
import { Check, Flag, X } from 'lucide-react';
import type { PaletteCounts, PaletteStatus, QuestionTelemetry } from '@/core/exam/engine';
import type { ExamSection } from '@/core/exam/schema';

export interface QuestionPaletteSidebarProps {
  readonly section: ExamSection;
  readonly activeQuestionIndex: number;
  readonly telemetry: Readonly<Record<string, QuestionTelemetry>>;
  readonly sectionCounts: PaletteCounts;
  readonly onSelectQuestion: (questionIndex: number) => void;
  readonly onOpenQuestionPaper: () => void;
  readonly onOpenInstructions: () => void;
  readonly onRequestSubmit: () => void;
  readonly mobileOpen: boolean;
  readonly onCloseMobile: () => void;
}

export function getPaletteStatusMeta(status: PaletteStatus): {
  label: string;
  shortCode: string;
  buttonClass: string;
  swatchClass: string;
} {
  switch (status) {
    case 'answered':
      return {
        label: 'Answered',
        shortCode: 'ANS',
        buttonClass: 'border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700',
        swatchClass: 'border-emerald-700 bg-emerald-600 text-white',
      };
    case 'not_answered':
      return {
        label: 'Not Answered',
        shortCode: 'UNANS',
        buttonClass: 'border-rose-700 bg-rose-600 text-white hover:bg-rose-700',
        swatchClass: 'border-rose-700 bg-rose-600 text-white',
      };
    case 'marked':
      return {
        label: 'Marked for Review',
        shortCode: 'REV',
        buttonClass: 'border-violet-700 bg-violet-600 text-white hover:bg-violet-700 rounded-full',
        swatchClass: 'border-violet-700 bg-violet-600 text-white rounded-full',
      };
    case 'answered_marked':
      return {
        label: 'Answered & Marked',
        shortCode: 'ANS+REV',
        buttonClass: 'border-violet-700 bg-violet-600 text-white hover:bg-violet-700 rounded-full',
        swatchClass: 'border-violet-700 bg-violet-600 text-white rounded-full',
      };
    case 'not_visited':
    default:
      return {
        label: 'Not Visited',
        shortCode: 'NEW',
        buttonClass:
          'border-[var(--border-strong)] bg-[var(--surface-subtle)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]',
        swatchClass:
          'border-[var(--border-strong)] bg-[var(--surface-subtle)] text-[var(--text-primary)]',
      };
  }
}

const PaletteBody = memo(function PaletteBody({
  section,
  activeQuestionIndex,
  telemetry,
  sectionCounts,
  onSelectQuestion,
  onOpenQuestionPaper,
  onOpenInstructions,
  onRequestSubmit,
}: Omit<QuestionPaletteSidebarProps, 'mobileOpen' | 'onCloseMobile'>) {
  const legendItems: Array<{ status: PaletteStatus; count: number; caption: string }> = [
    { status: 'answered', count: sectionCounts.answered, caption: 'Answered' },
    { status: 'not_answered', count: sectionCounts.notAnswered, caption: 'Not Answered' },
    { status: 'not_visited', count: sectionCounts.notVisited, caption: 'Not Visited' },
    { status: 'marked', count: sectionCounts.marked, caption: 'Marked for Review' },
    {
      status: 'answered_marked',
      count: sectionCounts.answeredMarked,
      caption: 'Answered & Marked (Evaluated)',
    },
  ];

  return (
    <div className="flex h-full flex-col bg-[var(--surface-canvas)]">
      {/* 5-State Indian CBT Legend with Live Counts */}
      <div className="border-b border-[var(--border-subtle)] p-3.5">
        <p className="mb-2.5 text-xs font-semibold text-[var(--text-primary)]">Question Status</p>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--text-secondary)]">
          {legendItems.map((item) => {
            const meta = getPaletteStatusMeta(item.status);
            return (
              <div
                key={item.status}
                className={`flex items-center gap-2 ${
                  item.status === 'answered_marked' ? 'col-span-2' : ''
                }`}
              >
                <span
                  className={`font-mono-tabular relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold ${meta.swatchClass}`}
                >
                  {item.count}
                  {item.status === 'answered_marked' && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-0.5 -bottom-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 ring-1 ring-white"
                    >
                      <Check className="h-2 w-2 text-white" />
                    </span>
                  )}
                </span>
                <span className="leading-tight">{item.caption}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section Header + Numbered Question Grid */}
      <div className="flex-1 overflow-y-auto p-3.5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="truncate text-xs font-semibold text-[var(--text-primary)]">
            {section.title}
          </h3>
          <span className="font-mono-tabular shrink-0 text-[11px] text-[var(--text-muted)]">
            {sectionCounts.answered + sectionCounts.answeredMarked}/{sectionCounts.total}
          </span>
        </div>

        <div
          role="group"
          aria-label={`Question palette for ${section.title}`}
          className="grid grid-cols-5 gap-2"
        >
          {section.questions.map((q, idx) => {
            const status = telemetry[q.id]?.status ?? 'not_visited';
            const meta = getPaletteStatusMeta(status);
            const isActive = idx === activeQuestionIndex;

            return (
              <button
                key={q.id}
                type="button"
                onClick={() => onSelectQuestion(idx)}
                aria-current={isActive ? 'step' : undefined}
                aria-label={`Question ${idx + 1}, ${meta.label}`}
                data-status={status}
                className={`font-mono-tabular relative flex h-10 w-full items-center justify-center rounded-lg border text-xs font-bold transition-transform active:scale-95 ${
                  meta.buttonClass
                } ${isActive ? 'ring-2 ring-[var(--brand-accent)] ring-offset-2' : ''}`}
              >
                <span>{idx + 1}</span>
                {status === 'answered_marked' && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -bottom-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 ring-1 ring-white"
                  >
                    <Check className="h-2.5 w-2.5 text-white" />
                  </span>
                )}
                {status === 'marked' && (
                  <Flag
                    aria-hidden="true"
                    className="absolute top-0.5 right-0.5 h-2.5 w-2.5 opacity-80"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Utility Actions + Primary Submit */}
      <div className="space-y-2 border-t border-[var(--border-subtle)] p-3.5">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onOpenQuestionPaper}
            className="min-h-[40px] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-2.5 text-xs font-medium text-[var(--text-primary)] whitespace-nowrap hover:bg-[var(--surface-subtle)]"
          >
            Question Paper
          </button>
          <button
            type="button"
            onClick={onOpenInstructions}
            className="min-h-[40px] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-2.5 text-xs font-medium text-[var(--text-primary)] whitespace-nowrap hover:bg-[var(--surface-subtle)]"
          >
            Instructions
          </button>
        </div>

        <button
          type="button"
          onClick={onRequestSubmit}
          className="min-h-[44px] w-full rounded-lg bg-[var(--brand-ink)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-ink-hover)]"
        >
          Submit Test
        </button>
      </div>
    </div>
  );
});

export const QuestionPaletteSidebar = memo(function QuestionPaletteSidebar(
  props: QuestionPaletteSidebarProps
) {
  return (
    <>
      {/* Desktop Sticky Sidebar */}
      <aside
        aria-label="Question Palette"
        className="hidden w-72 shrink-0 border-l border-[var(--border-subtle)] bg-[var(--surface-canvas)] lg:block"
      >
        <PaletteBody {...props} />
      </aside>

      {/* Mobile Slide-Over Drawer */}
      {props.mobileOpen && (
        <div className="fixed inset-0 z-50 flex justify-end lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/35"
            aria-hidden="true"
            onClick={props.onCloseMobile}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Question Palette Drawer"
            className="relative z-10 flex h-full w-full max-w-xs flex-col border-l border-[var(--border-strong)] bg-[var(--surface-canvas)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
              <span className="text-sm font-bold text-[var(--text-primary)]">Question Palette</span>
              <button
                type="button"
                onClick={props.onCloseMobile}
                aria-label="Close question palette"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <PaletteBody
                {...props}
                onSelectQuestion={(idx) => {
                  props.onSelectQuestion(idx);
                  props.onCloseMobile();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
});
