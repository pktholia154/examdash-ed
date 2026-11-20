'use client';

import React from 'react';
import { ReaderErrorBoundary } from './ReaderErrorBoundary';
import { PdfReaderModal, type PdfReaderModalProps } from './PdfReaderModal';
import { MarkdownReaderModal, type MarkdownReaderModalProps } from './MarkdownReaderModal';

/**
 * Direct client-bundled reader wrappers inside ReaderErrorBoundary.
 *
 * Bundling PdfReaderModal and MarkdownReaderModal directly with the book/purchased
 * route chunks eliminates lazy chunk-hash drift (`ChunkLoadError` / `*.undefined.js`)
 * across CDN edge caches, mobile bfcache restores, flaky cellular networks, and
 * Cloud Run deployments—while keeping SSR HTML impact at 0 bytes because modals
 * mount only after user interaction.
 */
export function DynamicPdfReader(props: PdfReaderModalProps) {
  return (
    <ReaderErrorBoundary title={props.bookTitle} onClose={props.onClose}>
      <PdfReaderModal key={`${props.bookId}:${props.mode}`} {...props} />
    </ReaderErrorBoundary>
  );
}

export function DynamicMarkdownReader(props: MarkdownReaderModalProps) {
  return (
    <ReaderErrorBoundary title={props.bookTitle} onClose={props.onClose}>
      <MarkdownReaderModal key={`${props.bookId}:${props.mode}`} {...props} />
    </ReaderErrorBoundary>
  );
}
