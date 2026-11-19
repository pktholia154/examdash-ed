'use client';

import React from 'react';
import { RotateCcw, X } from 'lucide-react';

interface ReaderErrorBoundaryProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}

interface ReaderErrorBoundaryState {
  readonly hasError: boolean;
  readonly message: string;
}

export class ReaderErrorBoundary extends React.Component<
  ReaderErrorBoundaryProps,
  ReaderErrorBoundaryState
> {
  constructor(props: ReaderErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ReaderErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected error occurred while rendering this document.',
    };
  }

  componentDidCatch(error: Error): void {
    console.error('ReaderErrorBoundary caught:', error);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${this.props.title} error`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-[var(--text-primary)]">
                  Unable to open reader
                </h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{this.state.message}</p>
              </div>
              <button
                type="button"
                onClick={this.props.onClose}
                aria-label="Close reader"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={this.props.onClose}
                className="min-h-[44px] rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
              >
                Close
              </button>
              <button
                type="button"
                onClick={this.handleRetry}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-ink)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-ink-hover)]"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                <span>Retry</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
