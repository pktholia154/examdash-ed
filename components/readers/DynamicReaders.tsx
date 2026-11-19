'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { ReaderErrorBoundary } from './ReaderErrorBoundary';
import type { PdfReaderModalProps } from './PdfReaderModal';
import type { MarkdownReaderModalProps } from './MarkdownReaderModal';

const LazyPdfReader = dynamic(
  () => import('./PdfReaderModal').then((m) => m.PdfReaderModal),
  {
    ssr: false,
    loading: () => (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Loading PDF reader"
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-white text-slate-900"
      >
        <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
        <p className="text-sm font-medium">Loading PDF reader...</p>
      </div>
    ),
  }
);

const LazyMarkdownReader = dynamic(
  () => import('./MarkdownReaderModal').then((m) => m.MarkdownReaderModal),
  {
    ssr: false,
    loading: () => (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Loading Markdown reader"
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-white text-slate-900"
      >
        <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
        <p className="text-sm font-medium">Loading Markdown reader...</p>
      </div>
    ),
  }
);

export function DynamicPdfReader(props: PdfReaderModalProps) {
  return (
    <ReaderErrorBoundary title={props.bookTitle} onClose={props.onClose}>
      <LazyPdfReader {...props} />
    </ReaderErrorBoundary>
  );
}

export function DynamicMarkdownReader(props: MarkdownReaderModalProps) {
  return (
    <ReaderErrorBoundary title={props.bookTitle} onClose={props.onClose}>
      <LazyMarkdownReader {...props} />
    </ReaderErrorBoundary>
  );
}
