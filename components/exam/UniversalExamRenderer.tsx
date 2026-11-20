'use client';

import React, { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  Scatter,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from 'recharts';
import { Check, Delete, X } from 'lucide-react';
import katex from 'katex';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';
import type { ExamAnswerValue } from '@/core/exam/engine';
import { isQuestionAttempted } from '@/core/exam/engine';
import type { ExamOption, ExamQuestion, ExamVisual } from '@/core/exam/schema';

const CHART_COLORS = ['#0f172a', '#0284c7', '#047857', '#d97706', '#7c3aed', '#be123c'];

// LRU-bounded KaTeX render cache for zero-lag question switching
const KATEX_CACHE = new Map<string, string>();
const MAX_KATEX_CACHE = 800;

function renderKatexCached(expression: string, displayMode: boolean): string {
  const key = `${displayMode ? 'D' : 'I'}:${expression}`;
  const cached = KATEX_CACHE.get(key);
  if (cached !== undefined) return cached;

  const html = katex.renderToString(expression, {
    displayMode,
    throwOnError: false,
    strict: 'ignore',
  });

  if (KATEX_CACHE.size >= MAX_KATEX_CACHE) {
    const firstKey = KATEX_CACHE.keys().next().value;
    if (firstKey !== undefined) KATEX_CACHE.delete(firstKey);
  }
  KATEX_CACHE.set(key, html);
  return html;
}

// ============================================================================
// 1. SVG SANITIZER & DEFENSIVE LATEX + CHEMISTRY (\ce) + MARKDOWN RENDERER
// ============================================================================
export function sanitizeSvg(raw: string): string {
  return String(raw || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?>[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '');
}

/**
 * Mermaid v11 uses DOMPurify internally under securityLevel: 'strict' and
 * places state/flowchart labels inside <foreignObject>. Keep those labels intact
 * while still stripping scripts, iframes, event handlers, and javascript: URIs.
 */
function sanitizeMermaidSvg(raw: string): string {
  return String(raw || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '');
}

export function defaultRenderLatex(input: unknown): React.ReactNode {
  if (input === null || input === undefined || input === '') return null;
  const text = String(input);

  const tokens = text.split(/(\$\$[\s\S]+?\$\$|\$(?!\s)(?:[^$\n]*?[^\s$\n])?\$)/g);

  return tokens.map((token, idx) => {
    if (token.startsWith('$$') && token.endsWith('$$') && token.length > 4) {
      const html = renderKatexCached(token.slice(2, -2), true);
      return (
        <span
          key={idx}
          className="my-2 block overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }
    if (token.startsWith('$') && token.endsWith('$') && token.length > 2) {
      const html = renderKatexCached(token.slice(1, -1), false);
      return <span key={idx} dangerouslySetInnerHTML={{ __html: html }} />;
    }

    return (
      <React.Fragment key={idx}>
        {token.split(/(\*\*[^*]+?\*\*)/g).map((part, bIdx) => {
          if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
            return (
              <strong key={bIdx} className="font-semibold text-[var(--text-primary)]">
                {part.slice(2, -2)}
              </strong>
            );
          }
          return part.split('\n').map((line, lIdx, arr) => (
            <React.Fragment key={`${bIdx}-${lIdx}`}>
              {line}
              {lIdx < arr.length - 1 && <br />}
            </React.Fragment>
          ));
        })}
      </React.Fragment>
    );
  });
}

// ============================================================================
// 2. CLIENT DIAGRAM MOUNT FOR MERMAID.JS & SMILES MOLECULAR STRUCTURES
// ============================================================================
const DeclarativeDiagramMount = memo(function DeclarativeDiagramMount({
  type,
  data,
}: {
  type: 'smiles' | 'mermaid';
  data: string;
}) {
  const safeId = useId().replace(/[^a-zA-Z0-9_-]/g, '_');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [mermaidSvg, setMermaidSvg] = useState<string>('');
  const [smilesError, setSmilesError] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    if (type === 'mermaid' && data) {
      import('mermaid')
        .then(async (m) => {
          const mermaid = m.default;
          mermaid.initialize({
            startOnLoad: false,
            theme: 'base',
            securityLevel: 'strict',
            htmlLabels: false,
            flowchart: { htmlLabels: false },
            themeVariables: {
              primaryColor: '#f8fafc',
              primaryTextColor: '#0f172a',
              primaryBorderColor: '#334155',
              lineColor: '#334155',
              secondaryColor: '#f1f5f9',
              tertiaryColor: '#ffffff',
              textColor: '#0f172a',
              edgeLabelBackground: '#ffffff',
              fontSize: '13px',
            },
          });
          try {
            const { svg } = await mermaid.render(`mermaid_${safeId}`, String(data));
            if (isMounted) setMermaidSvg(sanitizeMermaidSvg(svg));
          } catch {
            if (isMounted) setMermaidSvg('');
          }
        })
        .catch(() => {
          if (isMounted) setMermaidSvg('');
        });
    } else if (type === 'smiles' && data && svgRef.current) {
      setSmilesError(false);
      svgRef.current.innerHTML = '';
      import('smiles-drawer')
        .then((mod: unknown) => {
          const SmilesDrawerModule = mod as { default?: unknown };
          const SmilesDrawer = (SmilesDrawerModule.default || SmilesDrawerModule) as {
            SvgDrawer: new (opts: { width: number; height: number }) => {
              draw: (tree: unknown, el: SVGSVGElement, theme: string) => void;
            };
            parse: (
              smiles: string,
              onSuccess: (tree: unknown) => void,
              onError: () => void
            ) => void;
          };
          const drawer = new SmilesDrawer.SvgDrawer({ width: 280, height: 180 });
          SmilesDrawer.parse(
            String(data),
            (tree: unknown) => {
              if (isMounted && svgRef.current) {
                svgRef.current.innerHTML = '';
                drawer.draw(tree, svgRef.current, 'light');
              }
            },
            () => {
              if (isMounted) setSmilesError(true);
            }
          );
        })
        .catch(() => {
          if (isMounted) setSmilesError(true);
        });
    }

    return () => {
      isMounted = false;
    };
  }, [type, data, safeId]);

  if (type === 'mermaid') {
    return mermaidSvg ? (
      <div
        className="flex justify-center overflow-x-auto py-2 [&>svg]:max-h-72 [&>svg]:w-auto"
        dangerouslySetInnerHTML={{ __html: mermaidSvg }}
      />
    ) : (
      <pre className="overflow-x-auto rounded-lg bg-[var(--surface-subtle)] p-3 text-xs text-[var(--text-secondary)]">
        {data}
      </pre>
    );
  }

  if (smilesError) {
    return (
      <code className="block rounded-lg bg-[var(--surface-subtle)] p-2.5 text-xs text-[var(--text-secondary)]">
        {data}
      </code>
    );
  }

  return (
    <div className="flex justify-center overflow-x-auto py-2">
      <svg ref={svgRef} viewBox="0 0 280 180" className="max-h-48 w-auto" />
    </div>
  );
});

// ============================================================================
// 3. SINGLE VISUAL CARD (Chart, Table, SVG, SMILES, Mermaid, Image)
// ============================================================================
export const SingleVisualCard = memo(function SingleVisualCard({
  visual,
  renderLatex = defaultRenderLatex,
}: {
  visual: ExamVisual;
  renderLatex?: (txt: unknown) => React.ReactNode;
}) {
  if (!visual || typeof visual !== 'object') return null;

  const chartData = Array.isArray(visual.data)
    ? (visual.data as Array<Record<string, unknown>>)
    : [];

  const isNumericScatterX =
    visual.type === 'chart' &&
    visual.chartType === 'scatter' &&
    typeof chartData[0]?.[visual.xAxisKey ?? ''] === 'number';

  return (
    <div className="my-3 min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-4">
      {visual.title && (
        <h4 className="mb-3 border-b border-[var(--border-subtle)] pb-2 text-xs font-semibold text-[var(--text-primary)] sm:text-sm">
          {renderLatex(visual.title)}
        </h4>
      )}

      {visual.type === 'chart' && chartData.length > 0 && (
        <div className="h-64 w-full min-w-0 sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            {visual.chartType === 'pie' ? (
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey={visual.series?.[0]?.key || 'value'}
                  nameKey={visual.xAxisKey || 'name'}
                  cx="50%"
                  cy="48%"
                  outerRadius="68%"
                  isAnimationActive={false}
                  label={({ value }) => `${String(value)}%`}
                  labelLine={{ stroke: '#64748b', strokeWidth: 1 }}
                >
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: unknown, name: unknown) => [`${String(value)}%`, String(name)]} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
              </PieChart>
            ) : visual.chartType === 'radar' ? (
              <RadarChart data={chartData}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey={visual.xAxisKey} tick={{ fontSize: 12 }} />
                <PolarRadiusAxis tick={{ fontSize: 11 }} />
                {(visual.series || []).map((s, i) => (
                  <Radar
                    key={s.key || i}
                    name={s.label || s.key}
                    dataKey={s.key}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    fillOpacity={0.25}
                    isAnimationActive={false}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Tooltip />
              </RadarChart>
            ) : (
              <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey={visual.xAxisKey}
                  type={isNumericScatterX ? 'number' : 'category'}
                  tick={{ fontSize: 12 }}
                />
                <YAxis yAxisId="left" orientation="left" tick={{ fontSize: 12 }} />
                {(visual.series || []).some((s) => s.yAxis === 'right') && (
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                )}
                <Tooltip cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                {(visual.series || []).map((s, i) => {
                  const yAxisId = s.yAxis || 'left';
                  const color = CHART_COLORS[i % CHART_COLORS.length];
                  const isScatter = visual.chartType === 'scatter' || s.type === 'scatter';
                  const isLine = visual.chartType === 'line' || s.type === 'line';

                  if (isScatter) {
                    return (
                      <Scatter
                        key={s.key || i}
                        yAxisId={yAxisId}
                        name={s.label || s.key}
                        dataKey={s.key}
                        fill={color}
                        isAnimationActive={false}
                      />
                    );
                  }
                  if (isLine) {
                    return (
                      <Line
                        key={s.key || i}
                        yAxisId={yAxisId}
                        type="monotone"
                        dataKey={s.key}
                        name={s.label || s.key}
                        stroke={color}
                        strokeWidth={2.25}
                        dot={{ r: 3.5 }}
                        isAnimationActive={false}
                      />
                    );
                  }
                  return (
                    <Bar
                      key={s.key || i}
                      yAxisId={yAxisId}
                      dataKey={s.key}
                      name={s.label || s.key}
                      stackId={visual.chartType === 'stacked_bar' ? 'stack' : undefined}
                      fill={color}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={56}
                      isAnimationActive={false}
                    />
                  );
                })}
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {visual.type === 'table' && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            {Array.isArray(visual.headers) && visual.headers.length > 0 && (
              <thead>
                <tr className="bg-[var(--surface-subtle)]">
                  {visual.headers.map((h, i) => (
                    <th
                      key={i}
                      className="border border-[var(--border-strong)] px-3 py-2 font-semibold text-[var(--text-primary)]"
                    >
                      {renderLatex(h)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {(visual.rows || []).map((row, rIdx) => (
                <tr key={rIdx} className="even:bg-[var(--surface-subtle)]/50">
                  {(row || []).map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="border border-[var(--border-subtle)] px-3 py-2 text-[var(--text-secondary)] tabular-nums"
                    >
                      {renderLatex(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {visual.type === 'svg' && typeof visual.data === 'string' && visual.data && (
        <div
          className="flex justify-center overflow-x-auto py-2 [&>svg]:max-h-72 [&>svg]:w-auto"
          dangerouslySetInnerHTML={{ __html: sanitizeSvg(visual.data) }}
        />
      )}

      {(visual.type === 'smiles' || visual.type === 'mermaid') &&
        typeof visual.data === 'string' &&
        visual.data && <DeclarativeDiagramMount type={visual.type} data={visual.data} />}

      {visual.type === 'image' && (visual.url || typeof visual.data === 'string') && (
        <div className="flex justify-center py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={visual.url || String(visual.data)}
            alt={visual.alt || visual.title || 'Question visual'}
            referrerPolicy="no-referrer"
            className="max-h-80 w-auto rounded-lg border border-[var(--border-subtle)] object-contain"
          />
        </div>
      )}

      {visual.note && (
        <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          {renderLatex(visual.note)}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// 4. MULTI-VISUAL CONTENT BLOCK (Supports Sequential or Interleaved {{v1}})
// ============================================================================
export const MultiVisualContentBlock = memo(function MultiVisualContentBlock({
  text,
  visuals = [],
  renderLatex = defaultRenderLatex,
}: {
  text?: string | null;
  visuals?: readonly ExamVisual[] | null;
  renderLatex?: (txt: unknown) => React.ReactNode;
}) {
  const safeVisuals = useMemo(
    () => (Array.isArray(visuals) ? visuals.filter((v): v is ExamVisual => Boolean(v)) : []),
    [visuals]
  );

  const renderedIds = new Set<string>();
  const parts = text ? String(text).split(/(\{\{[a-zA-Z0-9_-]+\}\})/g) : [];

  return (
    <div className="space-y-3">
      {parts.map((part, idx) => {
        const match = part.match(/^\{\{([a-zA-Z0-9_-]+)\}\}$/);
        if (match) {
          const target = safeVisuals.find((v) => v.id === match[1]);
          if (target) {
            if (target.id) renderedIds.add(target.id);
            return <SingleVisualCard key={idx} visual={target} renderLatex={renderLatex} />;
          }
        }
        return part ? (
          <div key={idx} className="text-sm leading-relaxed text-[var(--text-primary)] sm:text-[15px]">
            {renderLatex(part)}
          </div>
        ) : null;
      })}

      {safeVisuals
        .filter((v) => !v.id || !renderedIds.has(v.id))
        .map((v, idx) => (
          <SingleVisualCard key={v.id || idx} visual={v} renderLatex={renderLatex} />
        ))}
    </div>
  );
});

// ============================================================================
// 5. QUESTION RESPONSE BLOCK (MCQ 4/5/N, MSQ, NAT + Virtual Keypad + Review Mode)
// ============================================================================
export interface QuestionResponseBlockProps {
  readonly question: ExamQuestion;
  readonly userAnswer: ExamAnswerValue | undefined;
  readonly onChange?: (val: ExamAnswerValue) => void;
  readonly isAttemptCapReached?: boolean;
  readonly showVirtualKeypad?: boolean;
  readonly readOnlyReview?: boolean;
  readonly renderLatex?: (txt: unknown) => React.ReactNode;
}

export const QuestionResponseBlock = memo(function QuestionResponseBlock({
  question,
  userAnswer,
  onChange,
  isAttemptCapReached = false,
  showVirtualKeypad = true,
  readOnlyReview = false,
  renderLatex = defaultRenderLatex,
}: QuestionResponseBlockProps) {
  const hasExistingAnswer =
    isQuestionAttempted(question, userAnswer) ||
    (userAnswer !== null &&
      userAnswer !== undefined &&
      String(userAnswer) !== '' &&
      !Array.isArray(userAnswer));

  const isLockedByCap = !readOnlyReview && isAttemptCapReached && !hasExistingAnswer;

  if (question.type === 'NAT') {
    const valStr = userAnswer !== null && userAnswer !== undefined ? String(userAnswer) : '';

    const handleNumericInput = (next: string) => {
      if (readOnlyReview || isLockedByCap || !onChange) return;
      if (next === '' || /^-?\d*\.?\d*$/.test(next)) {
        onChange(next);
      }
    };

    const handleKeyPress = (key: string) => {
      if (readOnlyReview || isLockedByCap || !onChange) return;
      if (key === 'CLEAR') return onChange('');
      if (key === 'BACKSPACE') return onChange(valStr.slice(0, -1));
      if (key === '-') {
        return onChange(valStr.startsWith('-') ? valStr.slice(1) : `-${valStr}`);
      }
      if (key === '.' && valStr.includes('.')) return;
      handleNumericInput(valStr + key);
    };

    const natCorrectRange = Array.isArray(question.answer)
      ? question.answer.length >= 2 && Number(question.answer[0]) !== Number(question.answer[1])
        ? `${question.answer[0]} to ${question.answer[1]}`
        : String(question.answer[0] ?? '')
      : String(question.answer ?? '');

    return (
      <div className="mt-4 space-y-3">
        {isLockedByCap && (
          <div
            role="alert"
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
          >
            Maximum attempt limit reached for this section. Clear an existing response in this section first.
          </div>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor={`nat-input-${question.id}`}
            className="block text-xs font-medium text-[var(--text-muted)]"
          >
            Numerical Answer (NAT)
          </label>
          <input
            id={`nat-input-${question.id}`}
            type="text"
            inputMode="decimal"
            disabled={readOnlyReview || isLockedByCap}
            value={valStr}
            onChange={(e) => handleNumericInput(e.target.value)}
            placeholder={readOnlyReview ? 'Not attempted' : 'Type or use virtual keypad'}
            className="font-mono-tabular h-11 w-full max-w-xs rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-3.5 text-base font-semibold text-[var(--text-primary)] focus:border-[var(--brand-accent)] focus:outline-none disabled:bg-[var(--surface-subtle)]"
          />
        </div>

        {readOnlyReview && (
          <p className="font-mono-tabular text-xs font-medium text-emerald-800">
            Official Answer: {natCorrectRange}
          </p>
        )}

        {showVirtualKeypad && !readOnlyReview && !isLockedByCap && (
          <div
            aria-label="Numerical Answer Virtual Keypad"
            className="inline-grid grid-cols-4 gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-2.5"
          >
            {['7', '8', '9', 'BACKSPACE', '4', '5', '6', '-', '1', '2', '3', '.', '0', 'CLEAR'].map(
              (k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleKeyPress(k)}
                  aria-label={k === 'BACKSPACE' ? 'Backspace' : k === 'CLEAR' ? 'Clear keypad' : `Keypad ${k}`}
                  className={`font-mono-tabular inline-flex min-h-[42px] min-w-[46px] items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-3 text-sm font-semibold transition-colors hover:bg-[var(--surface-hover)] ${
                    k === 'CLEAR'
                      ? 'col-span-3 text-rose-700'
                      : k === 'BACKSPACE'
                        ? 'text-rose-700'
                        : 'text-[var(--text-primary)]'
                  }`}
                >
                  {k === 'BACKSPACE' ? <Delete className="h-4 w-4" aria-hidden="true" /> : k}
                </button>
              )
            )}
          </div>
        )}
      </div>
    );
  }

  const isMSQ = question.type === 'MSQ';
  const selectedArray: string[] = Array.isArray(userAnswer) ? userAnswer : [];
  const optionsList: ExamOption[] = Array.isArray(question.options) ? question.options : [];
  const correctSet = new Set(
    Array.isArray(question.answer)
      ? question.answer.map((a) => String(a).trim())
      : [String(question.answer).trim()]
  );

  return (
    <div className="mt-4 space-y-2.5">
      {isMSQ && !readOnlyReview && (
        <p className="text-xs font-medium text-[var(--text-muted)]">
          Multiple Select Question — choose one or more correct options.
        </p>
      )}

      {isLockedByCap && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
        >
          Maximum attempt limit reached for this section. Clear an existing response in this section first.
        </div>
      )}

      {optionsList.map((opt) => {
        const isSelected = isMSQ ? selectedArray.includes(opt.id) : userAnswer === opt.id;
        const isCorrectOption = correctSet.has(opt.id);

        const handleSelect = () => {
          if (readOnlyReview || isLockedByCap || !onChange) return;
          if (!isMSQ) {
            onChange(isSelected ? null : opt.id);
          } else {
            const next = isSelected
              ? selectedArray.filter((id) => id !== opt.id)
              : Array.from(new Set([...selectedArray, opt.id])).sort();
            onChange(next);
          }
        };

        let optionClasses =
          'border-[var(--border-subtle)] bg-[var(--surface-canvas)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-subtle)]';
        let keyClasses = 'border-[var(--border-strong)] bg-[var(--surface-canvas)] text-[var(--text-secondary)]';

        if (readOnlyReview) {
          if (isCorrectOption && isSelected) {
            optionClasses = 'border-emerald-600 bg-emerald-50/70';
            keyClasses = 'border-emerald-600 bg-emerald-600 text-white';
          } else if (isCorrectOption) {
            optionClasses = 'border-emerald-500 bg-emerald-50/40';
            keyClasses = 'border-emerald-600 bg-white text-emerald-700';
          } else if (isSelected) {
            optionClasses = 'border-rose-500 bg-rose-50/60';
            keyClasses = 'border-rose-600 bg-rose-600 text-white';
          } else {
            optionClasses = 'border-[var(--border-subtle)] bg-[var(--surface-canvas)] opacity-75';
          }
        } else if (isSelected) {
          optionClasses = 'border-[var(--brand-ink)] bg-[var(--surface-subtle)] ring-1 ring-[var(--brand-ink)]';
          keyClasses = 'border-[var(--brand-ink)] bg-[var(--brand-ink)] text-white';
        }

        return (
          <button
            key={opt.id}
            type="button"
            data-option-id={opt.id}
            disabled={readOnlyReview || isLockedByCap}
            onClick={handleSelect}
            aria-pressed={isSelected}
            className={`flex min-h-[48px] w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors disabled:cursor-default ${optionClasses}`}
          >
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border text-xs font-bold ${
                isMSQ ? 'rounded-md' : 'rounded-full'
              } ${keyClasses}`}
            >
              {opt.id}
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              {opt.text && (
                <div className="text-sm leading-relaxed text-[var(--text-primary)]">
                  {renderLatex(opt.text)}
                </div>
              )}
              {opt.visual && <SingleVisualCard visual={opt.visual} renderLatex={renderLatex} />}
            </div>

            {readOnlyReview && (isCorrectOption || isSelected) && (
              <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-semibold">
                {isCorrectOption ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                    <span className="text-emerald-800">{isSelected ? 'Your Correct Pick' : 'Correct'}</span>
                  </>
                ) : (
                  <>
                    <X className="h-3.5 w-3.5 text-rose-700" aria-hidden="true" />
                    <span className="text-rose-800">Your Pick</span>
                  </>
                )}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
});
