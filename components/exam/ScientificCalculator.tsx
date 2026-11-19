'use client';

import React, { useState } from 'react';
import { Calculator, X } from 'lucide-react';

export interface ScientificCalculatorProps {
  readonly mode: 'scientific' | 'basic';
  readonly onClose: () => void;
}

function safeEvalExpression(expr: string, angleUnit: 'DEG' | 'RAD'): number {
  const toRad = (x: number) => (angleUnit === 'DEG' ? (x * Math.PI) / 180 : x);
  const clean = expr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, `(${Math.PI})`)
    .replace(/\be\b/g, `(${Math.E})`)
    .replace(/\^/g, '**');

  if (!/^[0-9+\-*/().,\sA-Za-z_*]+$/.test(clean)) {
    throw new Error('Invalid characters');
  }

  const fn = new Function(
    'sin',
    'cos',
    'tan',
    'log',
    'ln',
    'sqrt',
    'abs',
    `"use strict"; return (${clean});`
  ) as (
    sin: (x: number) => number,
    cos: (x: number) => number,
    tan: (x: number) => number,
    log: (x: number) => number,
    ln: (x: number) => number,
    sqrt: (x: number) => number,
    abs: (x: number) => number
  ) => unknown;

  const result = fn(
    (x) => Math.sin(toRad(x)),
    (x) => Math.cos(toRad(x)),
    (x) => Math.tan(toRad(x)),
    (x) => Math.log10(x),
    (x) => Math.log(x),
    (x) => Math.sqrt(x),
    (x) => Math.abs(x)
  );

  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error('Math error');
  }
  return Number(result.toPrecision(12));
}

export function ScientificCalculator({ mode, onClose }: ScientificCalculatorProps) {
  const [expression, setExpression] = useState('');
  const [display, setDisplay] = useState('0');
  const [memory, setMemory] = useState(0);
  const [angleUnit, setAngleUnit] = useState<'DEG' | 'RAD'>('DEG');
  const [error, setError] = useState<string | null>(null);

  const appendToken = (token: string) => {
    setError(null);
    setExpression((prev) => {
      const next = prev + token;
      setDisplay(next);
      return next;
    });
  };

  const evaluateCurrent = () => {
    if (!expression.trim()) return;
    try {
      const val = safeEvalExpression(expression, angleUnit);
      const formatted = String(val);
      setDisplay(formatted);
      setExpression(formatted);
      setError(null);
    } catch {
      setError('Invalid expression');
    }
  };

  const applyUnary = (op: 'sq' | 'inv' | 'neg') => {
    try {
      const base = expression.trim() ? safeEvalExpression(expression, angleUnit) : 0;
      const out = op === 'sq' ? base * base : op === 'inv' ? 1 / base : -base;
      if (!Number.isFinite(out)) throw new Error('Math error');
      const formatted = String(Number(out.toPrecision(12)));
      setExpression(formatted);
      setDisplay(formatted);
      setError(null);
    } catch {
      setError('Math error');
    }
  };

  const handleClear = () => {
    setExpression('');
    setDisplay('0');
    setError(null);
  };

  const handleBackspace = () => {
    setError(null);
    setExpression((prev) => {
      const next = prev.slice(0, -1);
      setDisplay(next || '0');
      return next;
    });
  };

  const handleMemory = (action: 'MC' | 'MR' | 'M+' | 'M-') => {
    if (action === 'MC') {
      setMemory(0);
      return;
    }
    if (action === 'MR') {
      appendToken(String(memory));
      return;
    }
    try {
      const currentVal = expression.trim() ? safeEvalExpression(expression, angleUnit) : 0;
      setMemory((prev) => (action === 'M+' ? prev + currentVal : prev - currentVal));
    } catch {
      setError('Invalid value for memory');
    }
  };

  return (
    <section
      role="dialog"
      aria-label={`${mode === 'scientific' ? 'Scientific' : 'Basic'} Calculator`}
      className="fixed right-3 bottom-16 z-40 w-[312px] rounded-xl border border-[var(--border-strong)] bg-[var(--surface-canvas)] shadow-lg sm:right-6 lg:right-[316px] lg:bottom-20"
    >
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
          <Calculator className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{mode === 'scientific' ? 'Scientific Calculator' : 'Calculator'}</span>
        </div>

        <div className="flex items-center gap-2">
          {mode === 'scientific' && (
            <button
              type="button"
              onClick={() => setAngleUnit((u) => (u === 'DEG' ? 'RAD' : 'DEG'))}
              className="rounded border border-[var(--border-strong)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
            >
              {angleUnit}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close calculator"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="p-3">
        {/* Display */}
        <div className="mb-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-2 text-right">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span>{memory !== 0 ? `M: ${memory}` : ''}</span>
            <span className="text-rose-700">{error ?? ''}</span>
          </div>
          <div
            data-testid="calculator-display"
            className="font-mono-tabular truncate text-lg font-bold text-[var(--text-primary)]"
          >
            {display}
          </div>
        </div>

        {/* Memory Row */}
        <div className="mb-1.5 grid grid-cols-4 gap-1.5">
          {(['MC', 'MR', 'M+', 'M-'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleMemory(m)}
              className="h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
            >
              {m}
            </button>
          ))}
        </div>

        {/* Scientific Functions */}
        {mode === 'scientific' && (
          <div className="mb-1.5 grid grid-cols-5 gap-1.5">
            {[
              { label: 'sin', token: 'sin(' },
              { label: 'cos', token: 'cos(' },
              { label: 'tan', token: 'tan(' },
              { label: 'log', token: 'log(' },
              { label: 'ln', token: 'ln(' },
              { label: '√', token: 'sqrt(' },
              { label: 'x²', unary: 'sq' as const },
              { label: 'xʸ', token: '^' },
              { label: '1/x', unary: 'inv' as const },
              { label: 'π', token: 'π' },
            ].map((btn) => (
              <button
                key={btn.label}
                type="button"
                onClick={() => (btn.unary ? applyUnary(btn.unary) : appendToken(btn.token!))}
                className="h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-canvas)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}

        {/* Main Keypad */}
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { label: '(', action: () => appendToken('(') },
            { label: ')', action: () => appendToken(')') },
            { label: '⌫', action: handleBackspace, tone: 'danger' },
            { label: 'C', action: handleClear, tone: 'danger' },
            { label: '7', action: () => appendToken('7') },
            { label: '8', action: () => appendToken('8') },
            { label: '9', action: () => appendToken('9') },
            { label: '÷', action: () => appendToken('÷'), tone: 'op' },
            { label: '4', action: () => appendToken('4') },
            { label: '5', action: () => appendToken('5') },
            { label: '6', action: () => appendToken('6') },
            { label: '×', action: () => appendToken('×'), tone: 'op' },
            { label: '1', action: () => appendToken('1') },
            { label: '2', action: () => appendToken('2') },
            { label: '3', action: () => appendToken('3') },
            { label: '-', action: () => appendToken('-'), tone: 'op' },
            { label: '0', action: () => appendToken('0') },
            { label: '.', action: () => appendToken('.') },
            { label: '±', action: () => applyUnary('neg') },
            { label: '+', action: () => appendToken('+'), tone: 'op' },
          ].map((btn) => (
            <button
              key={btn.label}
              type="button"
              onClick={btn.action}
              className={`font-mono-tabular h-9 rounded-md border text-sm font-semibold transition-colors ${
                btn.tone === 'danger'
                  ? 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
                  : btn.tone === 'op'
                    ? 'border-[var(--border-strong)] bg-[var(--surface-subtle)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-canvas)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
              }`}
            >
              {btn.label}
            </button>
          ))}
          <button
            type="button"
            onClick={evaluateCurrent}
            className="col-span-4 mt-0.5 h-10 rounded-lg bg-[var(--brand-ink)] text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-ink-hover)]"
          >
            =
          </button>
        </div>
      </div>
    </section>
  );
}
