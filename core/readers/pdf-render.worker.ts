/// <reference lib="webworker" />

import { createEngine, type PdfDocument, type PdfEngine } from 'clawpdf/browser';

/**
 * Off-main-thread PDFium WASM Web Worker
 * - Uses locally bundled `/wasm/pdfium.esm.wasm` (works offline & Capacitor-safe)
 * - Maintains single reusable engine instance per session
 * - Sequential priority render queue with instant cancellation on flick-scroll
 * - Transfers rendered frames via ImageBitmap (or Transferable ArrayBuffer fallback)
 * - Strictly closes document & destroys engine on unmount to prevent WASM heap leaks
 */

export type PdfWorkerRequest =
  | {
      type: 'OPEN_URL';
      requestId: number;
      url: string;
      headers?: Record<string, string>;
      wasmUrl: string;
      maxRenderPixels: number;
      fetchTimeoutMs?: number;
      fetchMaxBytes?: number;
    }
  | {
      type: 'OPEN_BUFFER';
      requestId: number;
      buffer: ArrayBuffer;
      wasmUrl: string;
      maxRenderPixels: number;
    }
  | {
      type: 'RENDER_PAGE';
      requestId: number;
      pageNumber: number;
      targetWidth: number;
      priority: number;
    }
  | {
      type: 'CANCEL_PAGES';
      pageNumbers: number[];
    }
  | {
      type: 'CANCEL_ALL';
    }
  | {
      type: 'CLOSE_DOC';
    }
  | {
      type: 'DESTROY';
    };

export type PdfWorkerResponse =
  | {
      type: 'OPENED';
      requestId: number;
      pageCount: number;
      pages: Array<{ pageNumber: number; rawWidth: number; rawHeight: number }>;
      byteLength: number;
    }
  | {
      type: 'OPEN_ERROR';
      requestId: number;
      message: string;
      statusCode?: number;
    }
  | {
      type: 'RENDERED_BITMAP';
      requestId: number;
      pageNumber: number;
      width: number;
      height: number;
      bitmap: ImageBitmap;
    }
  | {
      type: 'RENDERED_RGBA';
      requestId: number;
      pageNumber: number;
      width: number;
      height: number;
      rgbaBuffer: ArrayBuffer;
    }
  | {
      type: 'RENDER_ERROR';
      requestId: number;
      pageNumber: number;
      message: string;
    };

interface QueuedRenderTask {
  requestId: number;
  pageNumber: number;
  targetWidth: number;
  priority: number;
}

let engine: PdfEngine | null = null;
let currentDoc: PdfDocument | null = null;
let openAbortController: AbortController | null = null;
let renderQueue: QueuedRenderTask[] = [];
let processingQueue = false;

async function ensureEngine(wasmUrl: string, maxRenderPixels: number): Promise<PdfEngine> {
  if (engine) return engine;
  engine = await createEngine({
    wasmUrl,
    maxRenderPixels,
  });
  return engine;
}

function closeCurrentDoc(): void {
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

function collectPageMetrics(doc: PdfDocument): Array<{ pageNumber: number; rawWidth: number; rawHeight: number }> {
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
  if (processingQueue) return;
  processingQueue = true;

  try {
    while (renderQueue.length > 0 && currentDoc) {
      // Always pull highest-priority (lowest distance) item
      renderQueue.sort((a, b) => a.priority - b.priority);
      const task = renderQueue.shift();
      if (!task || !currentDoc) break;

      try {
        const page = currentDoc.page(task.pageNumber);
        const clampedWidth = Math.max(120, Math.min(2600, Math.round(task.targetWidth)));
        const rendered = page.render({
          width: clampedWidth,
          background: 'white',
        });

        const clampedRgba = new Uint8ClampedArray(
          rendered.rgba.buffer,
          rendered.rgba.byteOffset,
          rendered.rgba.byteLength
        );
        // Copy into standalone buffer so WASM memory is never detached or overwritten
        const standaloneCopy = new Uint8ClampedArray(clampedRgba.length);
        standaloneCopy.set(clampedRgba);

        if (typeof createImageBitmap === 'function' && typeof ImageData === 'function') {
          const imageData = new ImageData(standaloneCopy, rendered.width, rendered.height);
          const bitmap = await createImageBitmap(imageData);
          const msg: PdfWorkerResponse = {
            type: 'RENDERED_BITMAP',
            requestId: task.requestId,
            pageNumber: task.pageNumber,
            width: rendered.width,
            height: rendered.height,
            bitmap,
          };
          self.postMessage(msg, [bitmap]);
        } else {
          const rgbaBuffer = standaloneCopy.buffer;
          const msg: PdfWorkerResponse = {
            type: 'RENDERED_RGBA',
            requestId: task.requestId,
            pageNumber: task.pageNumber,
            width: rendered.width,
            height: rendered.height,
            rgbaBuffer,
          };
          self.postMessage(msg, [rgbaBuffer]);
        }
      } catch (err) {
        const msg: PdfWorkerResponse = {
          type: 'RENDER_ERROR',
          requestId: task.requestId,
          pageNumber: task.pageNumber,
          message: err instanceof Error ? err.message : 'Page render failed',
        };
        self.postMessage(msg);
      }

      // Yield briefly so CANCEL_PAGES messages can preempt queued work
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    processingQueue = false;
  }
}

self.onmessage = async (event: MessageEvent<PdfWorkerRequest>) => {
  const msg = event.data;

  if (msg.type === 'OPEN_URL') {
    closeCurrentDoc();
    openAbortController = new AbortController();
    const timeoutMs = msg.fetchTimeoutMs ?? 30_000;
    const maxBytes = msg.fetchMaxBytes ?? 60 * 1024 * 1024;
    const timeoutId = setTimeout(() => openAbortController?.abort(), timeoutMs);

    try {
      const response = await fetch(msg.url, {
        headers: msg.headers,
        signal: openAbortController.signal,
      });

      if (!response.ok) {
        clearTimeout(timeoutId);
        const errMsg: PdfWorkerResponse = {
          type: 'OPEN_ERROR',
          requestId: msg.requestId,
          message: `PDF request failed (${response.status})`,
          statusCode: response.status,
        };
        self.postMessage(errMsg);
        return;
      }

      const buffer = await response.arrayBuffer();
      clearTimeout(timeoutId);

      if (buffer.byteLength > maxBytes) {
        const errMsg: PdfWorkerResponse = {
          type: 'OPEN_ERROR',
          requestId: msg.requestId,
          message: 'PDF exceeds allowed memory budget.',
        };
        self.postMessage(errMsg);
        return;
      }

      const activeEngine = await ensureEngine(msg.wasmUrl, msg.maxRenderPixels);
      currentDoc = await activeEngine.open(new Uint8Array(buffer));
      const pages = collectPageMetrics(currentDoc);

      const okMsg: PdfWorkerResponse = {
        type: 'OPENED',
        requestId: msg.requestId,
        pageCount: currentDoc.pageCount,
        pages,
        byteLength: buffer.byteLength,
      };
      self.postMessage(okMsg);
    } catch (err) {
      clearTimeout(timeoutId);
      const errMsg: PdfWorkerResponse = {
        type: 'OPEN_ERROR',
        requestId: msg.requestId,
        message: err instanceof Error ? err.message : 'Unable to load PDF document.',
      };
      self.postMessage(errMsg);
    }
    return;
  }

  if (msg.type === 'OPEN_BUFFER') {
    closeCurrentDoc();
    try {
      const activeEngine = await ensureEngine(msg.wasmUrl, msg.maxRenderPixels);
      currentDoc = await activeEngine.open(new Uint8Array(msg.buffer));
      const pages = collectPageMetrics(currentDoc);

      const okMsg: PdfWorkerResponse = {
        type: 'OPENED',
        requestId: msg.requestId,
        pageCount: currentDoc.pageCount,
        pages,
        byteLength: msg.buffer.byteLength,
      };
      self.postMessage(okMsg);
    } catch (err) {
      const errMsg: PdfWorkerResponse = {
        type: 'OPEN_ERROR',
        requestId: msg.requestId,
        message: err instanceof Error ? err.message : 'Unable to open offline PDF.',
      };
      self.postMessage(errMsg);
    }
    return;
  }

  if (msg.type === 'RENDER_PAGE') {
    // Deduplicate pending tasks for the same page, keeping the newest width/priority
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
    closeCurrentDoc();
    if (engine) {
      try {
        await engine.destroy();
      } catch {
        // Ignore cleanup errors
      }
      engine = null;
    }
    self.close();
  }
};
