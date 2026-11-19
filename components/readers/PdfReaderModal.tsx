'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CloudDownload,
  CloudOff,
  Lock,
  Maximize2,
  Minimize2,
  RotateCcw,
  ShoppingCart,
  Sun,
  Moon,
  BookOpen,
  X,
  ZoomIn,
  ZoomOut,
  Check,
  Loader2,
} from 'lucide-react';
import {
  clampPdfZoom,
  computeActiveRenderWindow,
  computeAdaptiveDpr,
  computeEvictionPages,
  computePdfProgressPercent,
  computeScaledPageBox,
  prioritizeRenderQueue,
  shouldUseInstantJump,
  type PageMetric,
} from '@/core/readers/pdf-windowing';
import {
  webFullscreenAdapter,
  webOfflineStorageAdapter,
  webPreferencesAdapter,
} from '@/core/adapters/platform';
import type { PdfWorkerRequest, PdfWorkerResponse } from '@/core/readers/pdf-render.worker';
import { formatPrice } from '@/lib/design-system/formatters';
import type { ReaderMode, ReadingProgressRecord, ReadingTheme } from '@/lib/design-system/types';

export interface PdfReaderModalProps {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly mode: ReaderMode;
  readonly buyPrice: number;
  readonly currency: string;
  readonly userEmail: string | null;
  readonly entitlementProof: string | null;
  readonly getAuthToken: (() => Promise<string>) | null;
  readonly initialProgress: ReadingProgressRecord | null;
  readonly isInCart: boolean;
  readonly checkoutBusy: boolean;
  readonly onSaveProgress: (record: Omit<ReadingProgressRecord, 'id' | 'updatedAt'>) => void;
  readonly onAddToCart?: () => void;
  readonly onBuyNow?: () => void;
  readonly onClose: () => void;
}

const PREF_PDF_THEME_KEY = 'examdash_pdf_theme_v1';

function makeOfflinePdfKey(bookId: string, mode: ReaderMode): string {
  return `pdf_${bookId}_${mode}.pdf`;
}

export function PdfReaderModal({
  bookId,
  bookTitle,
  mode,
  buyPrice,
  currency,
  userEmail,
  entitlementProof,
  getAuthToken,
  initialProgress,
  isInCart,
  checkoutBusy,
  onSaveProgress,
  onAddToCart,
  onBuyNow,
  onClose,
}: PdfReaderModalProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageStackRef = useRef<HTMLDivElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const canvasMapRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pageWrapperMapRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderedWidthMapRef = useRef<Map<number, number>>(new Map());
  const requestIdRef = useRef(0);
  const openRetriedAuthRef = useRef(false);
  const lastTapTimeRef = useRef(0);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef(1);
  const zoomSettleTimerRef = useRef<number | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const rafZoomRef = useRef<number | null>(null);
  const lastSavedStateRef = useRef<{
    pageIndex: number;
    totalPages: number;
    offsetRatio: number;
    zoomScale: number;
  }>({
    pageIndex: initialProgress?.pageIndex ?? 0,
    totalPages: initialProgress?.totalPages ?? 0,
    offsetRatio: initialProgress?.offsetRatio ?? 0,
    zoomScale: initialProgress?.zoomScale ?? 1,
  });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageMetrics, setPageMetrics] = useState<PageMetric[]>([]);
  const [currentPage, setCurrentPage] = useState(Math.max(1, (initialProgress?.pageIndex ?? 0) + 1));
  const [containerWidth, setContainerWidth] = useState(760);
  const [isMobile, setIsMobile] = useState(false);
  const [zoomScale, setZoomScale] = useState(() => clampPdfZoom(initialProgress?.zoomScale ?? 1));
  const [liveCssScale, setLiveCssScale] = useState(1);
  const [hudVisible, setHudVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [theme, setTheme] = useState<ReadingTheme>(() => {
    const saved = webPreferencesAdapter.get(PREF_PDF_THEME_KEY);
    return saved === 'sepia' || saved === 'dark' ? saved : 'light';
  });
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [jumpInput, setJumpInput] = useState('');
  const [renderedCount, setRenderedCount] = useState(0);

  const totalPages = pageMetrics.length;

  // Persist theme preference
  const handleThemeChange = useCallback((nextTheme: ReadingTheme) => {
    setTheme(nextTheme);
    webPreferencesAdapter.set(PREF_PDF_THEME_KEY, nextTheme);
  }, []);

  // Check if offline copy already exists
  useEffect(() => {
    let active = true;
    void webOfflineStorageAdapter.hasBinary(makeOfflinePdfKey(bookId, mode)).then((exists) => {
      if (active) setOfflineSaved(exists);
    });
    return () => {
      active = false;
    };
  }, [bookId, mode]);

  // Flush reading progress helper
  const flushProgressNow = useCallback(() => {
    const state = lastSavedStateRef.current;
    if (state.totalPages <= 0) return;
    onSaveProgress({
      bookId,
      format: 'pdf',
      mode,
      pageIndex: state.pageIndex,
      totalPages: state.totalPages,
      offsetRatio: state.offsetRatio,
      blockIndex: 0,
      zoomScale: state.zoomScale,
      progressPercent: computePdfProgressPercent(
        state.pageIndex,
        state.totalPages,
        state.offsetRatio
      ),
    });
  }, [bookId, mode, onSaveProgress]);

  const scheduleProgressSave = useCallback(
    (pageNumber: number, offsetRatio: number, total: number, scale: number) => {
      lastSavedStateRef.current = {
        pageIndex: Math.max(0, pageNumber - 1),
        totalPages: total,
        offsetRatio,
        zoomScale: scale,
      };
      if (progressTimerRef.current !== null) {
        window.clearTimeout(progressTimerRef.current);
      }
      progressTimerRef.current = window.setTimeout(() => {
        flushProgressNow();
      }, 1000);
    },
    [flushProgressNow]
  );

  // Measure reader viewport width via ResizeObserver (debounced, CLS-safe)
  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;

    const updateDims = () => {
      const w = scroller.clientWidth;
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      const horizontalPad = mobile ? 20 : 64;
      setContainerWidth(Math.max(280, Math.min(920, w - horizontalPad)));
    };

    updateDims();
    let timer: number | null = null;
    const ro = new ResizeObserver(() => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(updateDims, 120);
    });
    ro.observe(scroller);

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  // Compute exact proportional page boxes (CLS = 0)
  const pageBoxes = useMemo(
    () => pageMetrics.map((metric) => computeScaledPageBox(metric, containerWidth, zoomScale)),
    [pageMetrics, containerWidth, zoomScale]
  );

  // Helper to paint watermark on full paid PDF canvases
  const paintPaidWatermark = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      if (mode !== 'full' || !userEmail) return;
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = '#0f172a';
      ctx.font = `${Math.max(12, Math.round(width * 0.018))}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(`Licensed to ${userEmail}`, width - 16, height - 14);
      ctx.restore();
    },
    [mode, userEmail]
  );

  // Evict a single page's canvas GPU memory while keeping wrapper height intact
  const evictCanvas = useCallback((pageNumber: number) => {
    const canvas = canvasMapRef.current.get(pageNumber);
    if (canvas && (canvas.width > 0 || canvas.height > 0)) {
      canvas.width = 0;
      canvas.height = 0;
    }
    renderedWidthMapRef.current.delete(pageNumber);
  }, []);

  // Open document in Web Worker (checks offline storage first, falls back to authenticated proxy)
  const openDocumentInWorker = useCallback(
    async (worker: Worker, forceRefreshToken = false) => {
      setLoading(true);
      setLoadError(null);
      renderedWidthMapRef.current.clear();

      const reqId = ++requestIdRef.current;
      const wasmUrl = `${window.location.origin}/wasm/pdfium.esm.wasm`;
      const maxRenderPixels = window.innerWidth < 768 ? 5_000_000 : 8_000_000;

      // 1. Check offline OPFS / IndexedDB vault first
      const offlineBuf = await webOfflineStorageAdapter.readBinary(makeOfflinePdfKey(bookId, mode));
      if (offlineBuf && offlineBuf.byteLength > 0) {
        const msg: PdfWorkerRequest = {
          type: 'OPEN_BUFFER',
          requestId: reqId,
          buffer: offlineBuf,
          wasmUrl,
          maxRenderPixels,
        };
        worker.postMessage(msg, [offlineBuf]);
        return;
      }

      // 2. Fetch via protected server proxy (/api/books/[id]/pdf?mode=sample|full)
      const headers: Record<string, string> = {};
      if (mode === 'full') {
        if (getAuthToken) {
          try {
            const token = await getAuthToken();
            headers.Authorization = `Bearer ${token}`;
          } catch {
            // Handled by 401 recovery
          }
        }
        if (entitlementProof) {
          headers['X-Entitlement-Proof'] = entitlementProof;
        }
        if (forceRefreshToken) {
          headers['Cache-Control'] = 'no-cache';
        }
      }

      const url = `${window.location.origin}/api/books/${encodeURIComponent(bookId)}/pdf?mode=${mode}`;
      const msg: PdfWorkerRequest = {
        type: 'OPEN_URL',
        requestId: reqId,
        url,
        headers,
        wasmUrl,
        maxRenderPixels,
        fetchTimeoutMs: 30_000,
        fetchMaxBytes: 60 * 1024 * 1024,
      };
      worker.postMessage(msg);
    },
    [bookId, entitlementProof, getAuthToken, mode]
  );

  // Lifecycle: instantiate single reusable PDFium WASM Web Worker & strictly destroy on unmount
  useEffect(() => {
    openRetriedAuthRef.current = false;
    const worker = new Worker(
      new URL('../../core/readers/pdf-render.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<PdfWorkerResponse>) => {
      const msg = event.data;

      if (msg.type === 'OPENED') {
        setPageMetrics(msg.pages);
        setLoading(false);
        setLoadError(null);
        lastSavedStateRef.current.totalPages = msg.pageCount;

        // Restore resume page after layout paints
        const resumePage = Math.max(
          1,
          Math.min(msg.pageCount, (initialProgress?.pageIndex ?? 0) + 1)
        );
        setCurrentPage(resumePage);
        if (resumePage > 1) {
          requestAnimationFrame(() => {
            const wrapper = pageWrapperMapRef.current.get(resumePage);
            if (wrapper && scrollContainerRef.current) {
              const offsetY =
                wrapper.offsetTop +
                Math.round(wrapper.offsetHeight * (initialProgress?.offsetRatio ?? 0));
              scrollContainerRef.current.scrollTo({ top: offsetY, behavior: 'auto' });
            }
          });
        }
        return;
      }

      if (msg.type === 'OPEN_ERROR') {
        // Intercept HTTP 401/403 on expired token and silently retry once
        if (
          (msg.statusCode === 401 || msg.statusCode === 403) &&
          mode === 'full' &&
          !openRetriedAuthRef.current &&
          getAuthToken
        ) {
          openRetriedAuthRef.current = true;
          void openDocumentInWorker(worker, true);
          return;
        }
        setLoading(false);
        setLoadError(msg.message || 'Unable to load PDF document.');
        return;
      }

      if (msg.type === 'RENDERED_BITMAP') {
        const canvas = canvasMapRef.current.get(msg.pageNumber);
        if (canvas) {
          canvas.width = msg.width;
          canvas.height = msg.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(msg.bitmap, 0, 0);
            paintPaidWatermark(ctx, msg.width, msg.height);
          }
          renderedWidthMapRef.current.set(msg.pageNumber, msg.width);
          setRenderedCount(renderedWidthMapRef.current.size);
        }
        msg.bitmap.close();
        return;
      }

      if (msg.type === 'RENDERED_RGBA') {
        const canvas = canvasMapRef.current.get(msg.pageNumber);
        if (canvas) {
          canvas.width = msg.width;
          canvas.height = msg.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const imgData = new ImageData(
              new Uint8ClampedArray(msg.rgbaBuffer),
              msg.width,
              msg.height
            );
            ctx.putImageData(imgData, 0, 0);
            paintPaidWatermark(ctx, msg.width, msg.height);
          }
          renderedWidthMapRef.current.set(msg.pageNumber, msg.width);
          setRenderedCount(renderedWidthMapRef.current.size);
        }
      }
    };

    worker.onerror = (err) => {
      setLoading(false);
      setLoadError(err.message || 'PDF render worker encountered an error.');
    };

    const canvasMap = canvasMapRef.current;
    void openDocumentInWorker(worker);

    return () => {
      if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current);
      if (zoomSettleTimerRef.current !== null) window.clearTimeout(zoomSettleTimerRef.current);
      if (rafZoomRef.current !== null) cancelAnimationFrame(rafZoomRef.current);
      flushProgressNow();

      // Release every canvas GPU backing store immediately
      for (const pageNumber of Array.from(canvasMap.keys())) {
        evictCanvas(pageNumber);
      }

      // Strictly destroy PDFium doc + WASM engine + terminate Worker
      try {
        worker.postMessage({ type: 'DESTROY' } satisfies PdfWorkerRequest);
      } catch {
        // Ignore if worker already terminated
      }
      setTimeout(() => worker.terminate(), 50);
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, mode]);

  // Memory & Progress Resilience on visibilitychange (flush progress + evict offscreen canvases)
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushProgressNow();
        for (const pageNumber of Array.from(renderedWidthMapRef.current.keys())) {
          if (pageNumber !== currentPage) {
            evictCanvas(pageNumber);
          }
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [currentPage, evictCanvas, flushProgressNow]);

  // Bidirectional Windowing: queue visible pages by proximity & actively evict >1500px offscreen canvases
  const syncRenderWindow = useCallback(
    (activePage: number) => {
      const worker = workerRef.current;
      if (!worker || pageBoxes.length === 0) return;

      const dpr = computeAdaptiveDpr(window.devicePixelRatio || 1, isMobile);
      const activeWindow = computeActiveRenderWindow(activePage, pageBoxes.length, isMobile);
      const activeSet = new Set(activeWindow);

      // Cancel pending renders outside active window
      const toCancel: number[] = [];
      for (let p = 1; p <= pageBoxes.length; p += 1) {
        if (!activeSet.has(p)) toCancel.push(p);
      }
      if (toCancel.length > 0) {
        worker.postMessage({ type: 'CANCEL_PAGES', pageNumbers: toCancel } satisfies PdfWorkerRequest);
      }

      // Evict canvases outside outer ~1500px zone
      const scroller = scrollContainerRef.current;
      if (scroller) {
        const bounds = new Map<number, { top: number; bottom: number }>();
        for (const [p, el] of pageWrapperMapRef.current.entries()) {
          bounds.set(p, { top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight });
        }
        const evictList = computeEvictionPages(
          Array.from(renderedWidthMapRef.current.keys()),
          bounds,
          scroller.scrollTop,
          scroller.scrollTop + scroller.clientHeight,
          1500
        );
        for (const p of evictList) {
          evictCanvas(p);
        }
      }

      // Prioritize active window pages closest to viewport center
      const prioritized = prioritizeRenderQueue(activeWindow, activePage);
      for (const pageNumber of prioritized) {
        const box = pageBoxes[pageNumber - 1];
        if (!box) continue;
        const targetPixelWidth = Math.round(box.width * dpr);
        const alreadyRenderedWidth = renderedWidthMapRef.current.get(pageNumber);

        // Skip if already rendered within 4% of target sharpness
        if (
          alreadyRenderedWidth &&
          Math.abs(alreadyRenderedWidth - targetPixelWidth) <= Math.max(24, targetPixelWidth * 0.04)
        ) {
          continue;
        }

        const reqId = ++requestIdRef.current;
        worker.postMessage({
          type: 'RENDER_PAGE',
          requestId: reqId,
          pageNumber,
          targetWidth: targetPixelWidth,
          priority: Math.abs(pageNumber - activePage),
        } satisfies PdfWorkerRequest);
      }
    },
    [evictCanvas, isMobile, pageBoxes]
  );

  // Trigger render window whenever active page or settled pageBoxes change
  useEffect(() => {
    if (!loading && pageBoxes.length > 0) {
      syncRenderWindow(currentPage);
    }
  }, [currentPage, loading, pageBoxes, syncRenderWindow]);

  // Secondary IntersectionObserver for active page + sub-page offset tracking
  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller || pageBoxes.length === 0) return;

    const handleScroll = () => {
      const viewportCenter = scroller.scrollTop + scroller.clientHeight * 0.35;
      let bestPage = currentPage;
      let bestDist = Number.POSITIVE_INFINITY;
      let offsetRatio = 0;

      for (const [pageNumber, el] of pageWrapperMapRef.current.entries()) {
        const top = el.offsetTop;
        const height = Math.max(1, el.offsetHeight);
        const center = top + height / 2;
        const dist = Math.abs(center - viewportCenter);
        if (dist < bestDist) {
          bestDist = dist;
          bestPage = pageNumber;
          offsetRatio = Math.min(1, Math.max(0, (scroller.scrollTop - top) / height));
        }
      }

      if (bestPage !== currentPage) {
        setCurrentPage(bestPage);
      }
      scheduleProgressSave(bestPage, offsetRatio, pageBoxes.length, zoomScale);
    };

    scroller.addEventListener('scroll', handleScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', handleScroll);
  }, [currentPage, pageBoxes.length, scheduleProgressSave, zoomScale]);

  // Two-phase zoom commit helper: Phase 1 live CSS scale -> Phase 2 settled sharp re-render (200ms)
  const applyTwoPhaseZoom = useCallback(
    (nextScale: number, immediate = false) => {
      const clamped = clampPdfZoom(nextScale);
      if (immediate) {
        setLiveCssScale(1);
        setZoomScale(clamped);
        return;
      }

      const ratio = clamped / zoomScale;
      if (rafZoomRef.current !== null) cancelAnimationFrame(rafZoomRef.current);
      rafZoomRef.current = requestAnimationFrame(() => {
        setLiveCssScale(ratio);
      });

      if (zoomSettleTimerRef.current !== null) {
        window.clearTimeout(zoomSettleTimerRef.current);
      }
      zoomSettleTimerRef.current = window.setTimeout(() => {
        setLiveCssScale(1);
        setZoomScale(clamped);
      }, 200);
    },
    [zoomScale]
  );

  // Instant Jump (>5 pages uses auto, <=5 uses smooth)
  const jumpToPage = useCallback(
    (targetPage: number) => {
      if (totalPages === 0) return;
      const clamped = Math.max(1, Math.min(totalPages, Math.floor(targetPage)));
      const wrapper = pageWrapperMapRef.current.get(clamped);
      const scroller = scrollContainerRef.current;
      if (wrapper && scroller) {
        const behavior: ScrollBehavior = shouldUseInstantJump(currentPage, clamped)
          ? 'auto'
          : 'smooth';
        scroller.scrollTo({ top: Math.max(0, wrapper.offsetTop - 12), behavior });
      }
      setCurrentPage(clamped);
    },
    [currentPage, totalPages]
  );

  // Keyboard shortcuts (Escape, Ctrl/Cmd +/-/0, ArrowLeft/Right)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (webFullscreenAdapter.isFullscreen()) {
          void webFullscreenAdapter.exit();
        } else {
          onClose();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        applyTwoPhaseZoom(zoomScale + 0.25);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        applyTwoPhaseZoom(zoomScale - 0.25);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        applyTwoPhaseZoom(1, true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyTwoPhaseZoom, onClose, zoomScale]);

  // Ctrl + Wheel two-phase zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      applyTwoPhaseZoom(zoomScale * liveCssScale + delta);
    },
    [applyTwoPhaseZoom, liveCssScale, zoomScale]
  );

  // Touch pinch-to-zoom & double-tap (Fit-to-Width <-> 1.75x)
  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDistRef.current = Math.hypot(dx, dy);
        pinchStartScaleRef.current = zoomScale;
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTapTimeRef.current < 280) {
          applyTwoPhaseZoom(zoomScale > 1.25 ? 1.0 : 1.75, true);
          lastTapTimeRef.current = 0;
        } else {
          lastTapTimeRef.current = now;
        }
      }
    },
    [applyTwoPhaseZoom, zoomScale]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 2 && pinchStartDistRef.current) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const factor = dist / pinchStartDistRef.current;
        applyTwoPhaseZoom(pinchStartScaleRef.current * factor);
      }
    },
    [applyTwoPhaseZoom]
  );

  const handleTouchEnd = useCallback(() => {
    pinchStartDistRef.current = null;
  }, []);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(async () => {
    if (!rootRef.current || !webFullscreenAdapter.isSupported()) return;
    try {
      if (webFullscreenAdapter.isFullscreen()) {
        await webFullscreenAdapter.exit();
        setIsFullscreen(false);
      } else {
        await webFullscreenAdapter.enter(rootRef.current);
        setIsFullscreen(true);
      }
    } catch {
      // Ignore fullscreen rejection in restricted iframes
    }
  }, []);

  // Offline Save Toggle (OPFS -> IndexedDB) for Full Paid Editions
  const toggleOfflineSave = useCallback(async () => {
    const key = makeOfflinePdfKey(bookId, mode);
    setOfflineBusy(true);
    try {
      if (offlineSaved) {
        await webOfflineStorageAdapter.deleteBinary(key);
        setOfflineSaved(false);
      } else {
        const headers: Record<string, string> = {};
        if (mode === 'full') {
          if (getAuthToken) {
            const token = await getAuthToken();
            headers.Authorization = `Bearer ${token}`;
          }
          if (entitlementProof) {
            headers['X-Entitlement-Proof'] = entitlementProof;
          }
        }
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/pdf?mode=${mode}`, {
          headers,
        });
        if (!res.ok) throw new Error('Unable to download offline copy.');
        const buf = await res.arrayBuffer();
        await webOfflineStorageAdapter.saveBinary(key, buf);
        setOfflineSaved(true);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Offline save failed.');
    } finally {
      setOfflineBusy(false);
    }
  }, [bookId, entitlementProof, getAuthToken, mode, offlineSaved]);

  const filterClass =
    theme === 'dark'
      ? 'pdf-filter-dark'
      : theme === 'sepia'
        ? 'pdf-filter-sepia'
        : 'pdf-filter-light';

  const bgSurfaceClass =
    theme === 'dark'
      ? 'bg-[#111317] text-slate-100'
      : theme === 'sepia'
        ? 'bg-[#ede5d4] text-[#2c241b]'
        : 'bg-[#f4f5f7] text-[var(--text-primary)]';

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${bookTitle} — ${mode === 'sample' ? 'Sample PDF Preview' : 'Full PDF Reader'}`}
      data-testid="pdf-reader-modal"
      data-reader-mode={mode}
      data-rendered-pages={renderedCount}
      className={`fixed inset-0 z-50 flex flex-col overscroll-none ${bgSurfaceClass}`}
    >
      {/* Top Minimal HUD */}
      <header
        className={`flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-3 py-2 text-[var(--text-primary)] transition-transform duration-150 safe-top sm:px-5 ${
          hudVisible ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text-primary)]">
              {mode === 'sample' ? 'Free Sample PDF' : 'Full PDF Edition'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">
              {totalPages > 0 ? `Page ${currentPage} of ${totalPages}` : 'Loading pages...'}
            </span>
          </div>
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{bookTitle}</p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Mobile Compact Theme Cycle (Light -> Sepia -> Dark) */}
          <button
            type="button"
            onClick={() =>
              handleThemeChange(
                theme === 'light' ? 'sepia' : theme === 'sepia' ? 'dark' : 'light'
              )
            }
            aria-label={`Switch PDF reading theme (current: ${theme})`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-canvas)] text-[var(--text-primary)] sm:hidden"
          >
            {theme === 'light' ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : theme === 'sepia' ? (
              <BookOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
          </button>

          {/* Theme Switcher (Zero-Cost CSS Filter) */}
          <div
            role="group"
            aria-label="PDF reading theme"
            className="hidden items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-0.5 sm:inline-flex"
          >
            <button
              type="button"
              onClick={() => handleThemeChange('light')}
              aria-label="Light reading mode"
              aria-pressed={theme === 'light'}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                theme === 'light'
                  ? 'bg-[var(--surface-canvas)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Sun className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => handleThemeChange('sepia')}
              aria-label="Sepia reading mode"
              aria-pressed={theme === 'sepia'}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                theme === 'sepia'
                  ? 'bg-[var(--surface-canvas)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => handleThemeChange('dark')}
              aria-label="Dark reading mode"
              aria-pressed={theme === 'dark'}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                theme === 'dark'
                  ? 'bg-[var(--surface-canvas)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Moon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {mode === 'sample' && onBuyNow && (
            <button
              type="button"
              onClick={onBuyNow}
              disabled={checkoutBusy}
              className="hidden h-9 items-center gap-1.5 rounded-lg bg-[var(--brand-ink)] px-3 text-xs font-medium text-white whitespace-nowrap transition-colors hover:bg-[var(--brand-ink-hover)] disabled:opacity-60 md:inline-flex"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Unlock Full</span>
            </button>
          )}

          {/* Two-Phase Zoom Controls */}
          <div className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-canvas)]">
            <button
              type="button"
              onClick={() => applyTwoPhaseZoom(zoomScale - 0.25)}
              aria-label="Zoom out PDF"
              className="inline-flex h-9 w-9 items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            >
              <ZoomOut className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => applyTwoPhaseZoom(1, true)}
              aria-label="Reset PDF zoom to 100%"
              className="font-mono-tabular px-2 text-xs font-medium text-[var(--text-primary)] whitespace-nowrap"
            >
              {Math.round(zoomScale * liveCssScale * 100)}%
            </button>
            <button
              type="button"
              onClick={() => applyTwoPhaseZoom(zoomScale + 0.25)}
              aria-label="Zoom in PDF"
              className="inline-flex h-9 w-9 items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            >
              <ZoomIn className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Offline Save (Full Paid Books -> OPFS/IndexedDB) */}
          {mode === 'full' && (
            <button
              type="button"
              onClick={() => void toggleOfflineSave()}
              disabled={offlineBusy}
              aria-label={offlineSaved ? 'Remove offline PDF copy' : 'Save PDF for offline reading'}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-2.5 text-xs font-medium text-[var(--text-primary)] whitespace-nowrap hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              {offlineBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : offlineSaved ? (
                <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <CloudDownload className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span className="hidden md:inline">
                {offlineSaved ? 'Saved Offline' : 'Save Offline'}
              </span>
            </button>
          )}

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="hidden h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] sm:inline-flex"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            )}
          </button>

          {/* Close Reader */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close PDF reader"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Scrollable Virtualized PDF Page Stream */}
      <div
        ref={scrollContainerRef}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => {
          if (e.target === scrollContainerRef.current) {
            setHudVisible((v) => !v);
          }
        }}
        className="flex-1 overflow-auto overscroll-none touch-pan-y px-3 py-5 sm:px-6"
      >
        {loading && (
          <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-3 py-20 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-[var(--text-primary)]" aria-hidden="true" />
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Initializing PDF engine and loading {mode === 'sample' ? 'sample preview' : 'full book'}...
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Rendering off the main thread for smooth scrolling
            </p>
          </div>
        )}

        {!loading && loadError && (
          <div className="mx-auto my-12 max-w-lg rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-6 text-center text-[var(--text-primary)]">
            <p className="text-base font-bold">Unable to load PDF</p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{loadError}</p>
            <div className="mt-5 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => workerRef.current && void openDocumentInWorker(workerRef.current, true)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-ink)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-ink-hover)]"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                <span>Retry</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {!loading && !loadError && pageBoxes.length > 0 && (
          <div
            ref={pageStackRef}
            style={{
              transform: liveCssScale !== 1 ? `scale(${liveCssScale})` : undefined,
              transformOrigin: 'top center',
            }}
            className="mx-auto flex flex-col items-center gap-4 will-change-transform"
          >
            {pageBoxes.map((box) => (
              <div
                key={box.pageNumber}
                ref={(el) => {
                  if (el) pageWrapperMapRef.current.set(box.pageNumber, el);
                  else pageWrapperMapRef.current.delete(box.pageNumber);
                }}
                style={{ width: `${box.width}px`, height: `${box.height}px` }}
                className="relative shrink-0 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-white shadow-xs"
              >
                <canvas
                  ref={(el) => {
                    if (el) canvasMapRef.current.set(box.pageNumber, el);
                    else canvasMapRef.current.delete(box.pageNumber);
                  }}
                  aria-label={`Page ${box.pageNumber} of ${totalPages}`}
                  className={`block h-full w-full ${filterClass}`}
                />
                <span className="font-mono-tabular pointer-events-none absolute right-2.5 bottom-2 rounded bg-slate-900/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  {box.pageNumber}
                </span>
              </div>
            ))}

            {/* Native End-of-Sample Paywall CTA Card (Sample Mode Only) */}
            {mode === 'sample' && (
              <section
                aria-label="Unlock full book"
                className="my-4 w-full max-w-2xl rounded-xl border border-[var(--border-strong)] bg-[var(--surface-canvas)] p-6 text-center text-[var(--text-primary)] shadow-sm"
              >
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--surface-subtle)] text-[var(--text-primary)]">
                  <Lock className="h-5 w-5" aria-hidden="true" />
                </div>
                <h2 className="mt-3 text-lg font-bold">End of Free Sample Preview</h2>
                <p className="mx-auto mt-1.5 max-w-md text-sm text-[var(--text-secondary)]">
                  Purchase the full edition of <span className="font-medium text-[var(--text-primary)]">{bookTitle}</span> to unlock the complete PDF, full reflowable Markdown book, and offline reading in your Purchased Library.
                </p>
                <p className="font-mono-tabular mt-3 text-lg font-bold text-[var(--text-primary)]">
                  {formatPrice(buyPrice, currency)}
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  {onBuyNow && (
                    <button
                      type="button"
                      onClick={onBuyNow}
                      disabled={checkoutBusy}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-ink)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--brand-ink-hover)] disabled:opacity-60"
                    >
                      {checkoutBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      <span>{checkoutBusy ? 'Starting Razorpay...' : 'Unlock Full Book'}</span>
                    </button>
                  )}
                  {onAddToCart && (
                    <button
                      type="button"
                      onClick={onAddToCart}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                    >
                      {isInCart ? (
                        <>
                          <Check className="h-4 w-4" aria-hidden="true" />
                          <span>In Cart</span>
                        </>
                      ) : (
                        <>
                          <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                          <span>Add to Cart</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* Auto-Hiding Bottom Scrubber & Instant Jump Bar */}
      {totalPages > 0 && (
        <footer
          className={`flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-4 py-2.5 text-[var(--text-primary)] transition-transform duration-150 safe-bottom ${
            hudVisible ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => jumpToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              aria-label="Previous page"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => jumpToPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
              aria-label="Next page"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-1 items-center gap-3 px-1">
            <input
              type="range"
              min={1}
              max={totalPages}
              value={currentPage}
              aria-label="Jump to PDF page"
              onChange={(e) => jumpToPage(Number(e.target.value))}
              className="h-2 w-full cursor-pointer accent-[var(--brand-ink)]"
            />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = Number(jumpInput);
              if (Number.isFinite(parsed) && parsed >= 1) {
                jumpToPage(parsed);
                setJumpInput('');
              }
            }}
            className="flex items-center gap-1.5"
          >
            <label htmlFor="pdf-jump-input" className="sr-only">
              Go to page
            </label>
            <input
              id="pdf-jump-input"
              type="number"
              min={1}
              max={totalPages}
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value)}
              placeholder={`${currentPage}`}
              className="font-mono-tabular h-9 w-16 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-2 text-center text-xs font-medium text-[var(--text-primary)]"
            />
            <span className="font-mono-tabular text-xs text-[var(--text-muted)] whitespace-nowrap">
              / {totalPages}
            </span>
          </form>
        </footer>
      )}
    </div>
  );
}
