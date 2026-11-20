'use client';

import type { PdfDocument, PdfEngine } from 'clawpdf/browser';
import type { PdfWorkerRequest, PdfWorkerResponse } from './pdf-render.worker';

export interface PdfBridge {
  postMessage: (msg: PdfWorkerRequest, transfer?: Transferable[]) => void;
  terminate: () => void;
  onmessage: ((event: { data: PdfWorkerResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

interface QueuedRenderTask {
  requestId: number;
  pageNumber: number;
  targetWidth: number;
  priority: number;
}

/**
 * Automatic main-thread PDFium WASM fallback bridge.
 * Activates ONLY when a browser/WebView blocks or fails Web Worker startup
 * (e.g. strict mobile WebView CSP, older iOS Safari, or stale worker chunk).
 * Yields to the browser between page renders to keep scrolling responsive.
 */
export function createMainThreadPdfBridge(): PdfBridge {
  let engine: PdfEngine | null = null;
  let currentDoc: PdfDocument | null = null;
  let openAbortController: AbortController | null = null;
  let renderQueue: QueuedRenderTask[] = [];
  let processingQueue = false;
  let destroyed = false;

  const bridge: PdfBridge = {
    onmessage: null,
    onerror: null,
    postMessage(msg: PdfWorkerRequest) {
      if (destroyed) return;
      void handleMessage(msg);
    },
    terminate() {
      destroyed = true;
      closeCurrentDoc();
      if (engine) {
        const toDestroy = engine;
        engine = null;
        void toDestroy.destroy().catch(() => undefined);
      }
    },
  };

  function emit(data: PdfWorkerResponse) {
    if (destroyed) return;
    bridge.onmessage?.({ data });
  }

  function closeCurrentDoc() {
    renderQueue = [];
    if (openAbortController) {
      openAbortController.abort();
      openAbortController = null;
    }
    if (currentDoc) {
      try {
        currentDoc.destroy();
      } catch {
        // Ignore already-destroyed doc
      }
      currentDoc = null;
    }
  }

  async function ensureEngine(wasmUrl: string, maxRenderPixels: number): Promise<PdfEngine> {
    if (engine) return engine;
    const mod = await import('clawpdf/browser');
    if (destroyed) {
      throw new Error('PDF reader was closed before initialization completed.');
    }
    engine = await mod.createEngine({
      wasmUrl,
      maxRenderPixels,
    });
    return engine;
  }

  function collectPageMetrics(
    doc: PdfDocument
  ): Array<{ pageNumber: number; rawWidth: number; rawHeight: number }> {
    const count = doc.pageCount;
    const pages: Array<{ pageNumber: number; rawWidth: number; rawHeight: number }> = [];
    for (let i = 1; i <= count; i += 1) {
      const page = doc.page(i);
      pages.push({
        pageNumber: i,
        rawWidth: page.width || 595,
        rawHeight: page.height || 842,
      });
    }
    return pages;
  }

  async function processNextRender(): Promise<void> {
    if (processingQueue || destroyed) return;
    processingQueue = true;

    try {
      while (renderQueue.length > 0 && currentDoc && !destroyed) {
        renderQueue.sort((a, b) => a.priority - b.priority);
        const task = renderQueue.shift();
        if (!task || !currentDoc || destroyed) break;

        try {
          const page = currentDoc.page(task.pageNumber);
          const clampedWidth = Math.max(120, Math.min(2200, Math.round(task.targetWidth)));
          const rendered = page.render({
            width: clampedWidth,
            background: 'white',
          });

          const clampedRgba = new Uint8ClampedArray(
            rendered.rgba.buffer,
            rendered.rgba.byteOffset,
            rendered.rgba.byteLength
          );
          const standaloneCopy = new Uint8ClampedArray(clampedRgba.length);
          standaloneCopy.set(clampedRgba);

          emit({
            type: 'RENDERED_RGBA',
            requestId: task.requestId,
            pageNumber: task.pageNumber,
            width: rendered.width,
            height: rendered.height,
            rgbaBuffer: standaloneCopy.buffer,
          });
        } catch (err) {
          emit({
            type: 'RENDER_ERROR',
            requestId: task.requestId,
            pageNumber: task.pageNumber,
            message: err instanceof Error ? err.message : 'Page render failed',
          });
        }

        // Yield to main thread between pages so touch scrolling remains smooth
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
    } finally {
      processingQueue = false;
    }
  }

  async function handleMessage(msg: PdfWorkerRequest): Promise<void> {
    if (msg.type === 'OPEN_URL') {
      closeCurrentDoc();
      openAbortController = new AbortController();
      const timeoutMs = msg.fetchTimeoutMs ?? 30_000;
      const maxBytes = msg.fetchMaxBytes ?? 60 * 1024 * 1024;
      const timeoutId = setTimeout(() => openAbortController?.abort(), timeoutMs);

      try {
        const response = await fetch(msg.url, {
          headers: msg.headers,
          credentials: 'same-origin',
          signal: openAbortController.signal,
        });

        if (!response.ok) {
          clearTimeout(timeoutId);
          emit({
            type: 'OPEN_ERROR',
            requestId: msg.requestId,
            message: `PDF request failed (${response.status})`,
            statusCode: response.status,
          });
          return;
        }

        const buffer = await response.arrayBuffer();
        clearTimeout(timeoutId);

        if (buffer.byteLength > maxBytes) {
          emit({
            type: 'OPEN_ERROR',
            requestId: msg.requestId,
            message: 'PDF exceeds allowed memory budget.',
          });
          return;
        }

        const activeEngine = await ensureEngine(msg.wasmUrl, msg.maxRenderPixels);
        if (destroyed) return;
        currentDoc = await activeEngine.open(new Uint8Array(buffer));
        const pages = collectPageMetrics(currentDoc);

        emit({
          type: 'OPENED',
          requestId: msg.requestId,
          pageCount: currentDoc.pageCount,
          pages,
          byteLength: buffer.byteLength,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        emit({
          type: 'OPEN_ERROR',
          requestId: msg.requestId,
          message: err instanceof Error ? err.message : 'Unable to load PDF document.',
        });
      }
      return;
    }

    if (msg.type === 'OPEN_BUFFER') {
      closeCurrentDoc();
      try {
        const activeEngine = await ensureEngine(msg.wasmUrl, msg.maxRenderPixels);
        if (destroyed) return;
        currentDoc = await activeEngine.open(new Uint8Array(msg.buffer));
        const pages = collectPageMetrics(currentDoc);

        emit({
          type: 'OPENED',
          requestId: msg.requestId,
          pageCount: currentDoc.pageCount,
          pages,
          byteLength: msg.buffer.byteLength,
        });
      } catch (err) {
        emit({
          type: 'OPEN_ERROR',
          requestId: msg.requestId,
          message: err instanceof Error ? err.message : 'Unable to open offline PDF.',
        });
      }
      return;
    }

    if (msg.type === 'RENDER_PAGE') {
      renderQueue = renderQueue.filter((t) => t.pageNumber !== msg.pageNumber);
      renderQueue.push({
        requestId: msg.requestId,
        pageNumber: msg.pageNumber,
        targetWidth: msg.targetWidth,
        priority: msg.priority,
      });
      void processNextRender();
      return;
    }

    if (msg.type === 'CANCEL_PAGES') {
      const cancelSet = new Set(msg.pageNumbers);
      renderQueue = renderQueue.filter((t) => !cancelSet.has(t.pageNumber));
      return;
    }

    if (msg.type === 'CANCEL_ALL') {
      renderQueue = [];
      return;
    }

    if (msg.type === 'CLOSE_DOC') {
      closeCurrentDoc();
      return;
    }

    if (msg.type === 'DESTROY') {
      bridge.terminate();
    }
  }

  return bridge;
}
