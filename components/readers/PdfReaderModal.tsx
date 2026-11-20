'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { createMainThreadPdfBridge, type PdfBridge } from '@/core/readers/pdf-mainthread-fallback';
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
  readonly getAuthToken: ((forceRefresh?: boolean) => Promise<string>) | null;
  readonly initialProgress: ReadingProgressRecord | null;
  readonly isInCart: boolean;
  readonly checkoutBusy: boolean;
  readonly checkoutError?: string | null;
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
  checkoutError = null,
  onSaveProgress,
  onAddToCart,
  onBuyNow,
  onClose,
}: PdfReaderModalProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageStackRef = useRef<HTMLDivElement | null>(null);
  const workerRef = useRef<PdfBridge | null>(null);
  const canvasMapRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pageWrapperMapRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderedWidthMapRef = useRef<Map<number, number>>(new Map());
  const retriedRenderPagesRef = useRef<Set<number>>(new Set());
  const requestIdRef = useRef(0);
  const openRetriedAuthRef = useRef(false);
  const usedMainThreadFallbackRef = useRef(false);
  const docOpenedRef = useRef(false);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const touchGestureRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startTime: number;
    moved: boolean;
    wasMultiTouch: boolean;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startTime: 0,
    moved: false,
    wasMultiTouch: false,
  });
  const pinchStateRef = useRef<{
    active: boolean;
    engaged: boolean;
    startDist: number;
    startScale: number;
    pendingScale: number;
    cooldownUntil: number;
  }>({
    active: false,
    engaged: false,
    startDist: 0,
    startScale: 1,
    pendingScale: 1,
    cooldownUntil: 0,
  });
  const mousePanRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
  });
  const pendingFocalScrollRef = useRef<{
    xRatio: number;
    yRatio: number;
    resetX: boolean;
  } | null>(null);
  const zoomSettleTimerRef = useRef<number | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const rafZoomRef = useRef<number | null>(null);
  const rafScrollRef = useRef<number | null>(null);
  const lastMeasuredWidthRef = useRef<number>(0);
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
  const currentPageRef = useRef(currentPage);
  const [containerWidth, setContainerWidth] = useState(760);
  const [isMobile, setIsMobile] = useState(false);
  const [zoomScale, setZoomScale] = useState(() => clampPdfZoom(initialProgress?.zoomScale ?? 1));
  const zoomScaleRef = useRef(zoomScale);
  const [liveCssScale, setLiveCssScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [theme, setTheme] = useState<ReadingTheme>(() => {
    const saved = webPreferencesAdapter.get(PREF_PDF_THEME_KEY);
    return saved === 'sepia' || saved === 'dark' ? saved : 'light';
  });
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [jumpInput, setJumpInput] = useState('');
  const [renderedCount, setRenderedCount] = useState(0);

  const isZoomed = zoomScale > 1.01;

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    zoomScaleRef.current = zoomScale;
  }, [zoomScale]);

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

  // Measure reader viewport width via ResizeObserver (ignores mobile URL-bar height changes)
  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;

    const updateDims = () => {
      const w = scroller.clientWidth;
      if (w <= 0 || w === lastMeasuredWidthRef.current) return;
      lastMeasuredWidthRef.current = w;
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      const horizontalPad = mobile ? 24 : 64;
      setContainerWidth(Math.max(240, Math.min(920, w - horizontalPad)));
    };

    updateDims();
    let timer: number | null = null;
    const ro = new ResizeObserver(() => {
      if (scroller.clientWidth === lastMeasuredWidthRef.current) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(updateDims, 150);
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

  // Open document in active PDF bridge (checks offline storage first, falls back to authenticated proxy)
  const openDocumentInWorker = useCallback(
    async (bridge: PdfBridge, forceRefreshToken = false) => {
      renderedWidthMapRef.current.clear();
      retriedRenderPagesRef.current.clear();

      const reqId = ++requestIdRef.current;
      const wasmUrl = `${window.location.origin}/wasm/pdfium.esm.wasm`;
      const maxRenderPixels = window.innerWidth < 768 ? 4_000_000 : 8_000_000;

      // 1. Check offline OPFS / IndexedDB vault first (guarded for Safari private mode)
      let offlineBuf: ArrayBuffer | null = null;
      try {
        offlineBuf = await webOfflineStorageAdapter.readBinary(makeOfflinePdfKey(bookId, mode));
      } catch {
        offlineBuf = null;
      }
      if (offlineBuf && offlineBuf.byteLength > 0) {
        const msg: PdfWorkerRequest = {
          type: 'OPEN_BUFFER',
          requestId: reqId,
          buffer: offlineBuf,
          wasmUrl,
          maxRenderPixels,
        };
        bridge.postMessage(msg, [offlineBuf]);
        return;
      }

      // 2. Fetch via protected server proxy (/api/books/[id]/pdf?mode=sample|full)
      const headers: Record<string, string> = {};
      if (mode === 'full') {
        if (getAuthToken) {
          try {
            const token = await getAuthToken(forceRefreshToken);
            headers.Authorization = `Bearer ${token}`;
          } catch {
            // Handled by 401 recovery or explicit server error
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
      bridge.postMessage(msg);
    },
    [bookId, entitlementProof, getAuthToken, mode]
  );

  // Lifecycle: instantiate off-main-thread classic PDFium WASM Web Worker with automatic
  // main-thread WASM fallback for restricted mobile WebViews or worker load failures.
  useEffect(() => {
    openRetriedAuthRef.current = false;
    usedMainThreadFallbackRef.current = false;
    docOpenedRef.current = false;
    let disposed = false;

    const attachBridgeHandlers = (bridge: PdfBridge, isPrimaryWorker: boolean) => {
      bridge.onmessage = (event: { data: PdfWorkerResponse }) => {
        if (disposed) return;
        const msg = event.data;

        if (msg.type === 'OPENED') {
          docOpenedRef.current = true;
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
          // Intercept HTTP 401/403 on expired token and silently retry once with a refreshed token
          if (
            (msg.statusCode === 401 || msg.statusCode === 403) &&
            mode === 'full' &&
            !openRetriedAuthRef.current &&
            getAuthToken
          ) {
            openRetriedAuthRef.current = true;
            void openDocumentInWorker(bridge, true).catch((err) => {
              if (disposed) return;
              setLoading(false);
              setLoadError(err instanceof Error ? err.message : 'Unable to load PDF document.');
            });
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
          return;
        }

        if (msg.type === 'RENDER_ERROR') {
          // Retry once at a conservative width (helps low-memory mobile GPUs)
          if (!retriedRenderPagesRef.current.has(msg.pageNumber)) {
            retriedRenderPagesRef.current.add(msg.pageNumber);
            const reqId = ++requestIdRef.current;
            bridge.postMessage({
              type: 'RENDER_PAGE',
              requestId: reqId,
              pageNumber: msg.pageNumber,
              targetWidth: 640,
              priority: 0,
            });
          }
        }
      };

      bridge.onerror = (err) => {
        if (disposed) return;
        // Seamless fallback to main-thread WASM bridge if the Web Worker fails to boot
        if (isPrimaryWorker && !docOpenedRef.current && !usedMainThreadFallbackRef.current) {
          usedMainThreadFallbackRef.current = true;
          try {
            bridge.terminate();
          } catch {
            // Ignore termination error
          }
          const fallback = createMainThreadPdfBridge();
          workerRef.current = fallback;
          attachBridgeHandlers(fallback, false);
          void openDocumentInWorker(fallback).catch((err) => {
            if (disposed) return;
            setLoading(false);
            setLoadError(err instanceof Error ? err.message : 'Unable to load PDF document.');
          });
          return;
        }
        setLoading(false);
        setLoadError(err?.message || 'PDF render engine encountered an error.');
      };
    };

    let activeBridge: PdfBridge;
    let isPrimaryWorker = false;
    try {
      if (typeof Worker !== 'undefined') {
        // Classic webpack worker (omit `{ type: 'module' }`) maximizes iOS Safari / WebView compatibility
        const nativeWorker = new Worker(
          new URL('../../core/readers/pdf-render.worker.ts', import.meta.url)
        );
        activeBridge = nativeWorker as unknown as PdfBridge;
        isPrimaryWorker = true;
      } else {
        usedMainThreadFallbackRef.current = true;
        activeBridge = createMainThreadPdfBridge();
      }
    } catch {
      usedMainThreadFallbackRef.current = true;
      activeBridge = createMainThreadPdfBridge();
    }

    workerRef.current = activeBridge;
    attachBridgeHandlers(activeBridge, isPrimaryWorker);

    const canvasMap = canvasMapRef.current;
    void openDocumentInWorker(activeBridge).catch((err) => {
      if (disposed) return;
      setLoading(false);
      setLoadError(err instanceof Error ? err.message : 'Unable to load PDF document.');
    });

    return () => {
      disposed = true;
      if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current);
      if (zoomSettleTimerRef.current !== null) window.clearTimeout(zoomSettleTimerRef.current);
      if (rafZoomRef.current !== null) cancelAnimationFrame(rafZoomRef.current);
      if (rafScrollRef.current !== null) cancelAnimationFrame(rafScrollRef.current);
      flushProgressNow();

      // Release every canvas GPU backing store immediately
      for (const pageNumber of Array.from(canvasMap.keys())) {
        evictCanvas(pageNumber);
      }

      // Strictly destroy PDFium doc + WASM engine + terminate active bridge
      const currentBridge = workerRef.current;
      if (currentBridge) {
        try {
          currentBridge.postMessage({ type: 'DESTROY' } satisfies PdfWorkerRequest);
        } catch {
          // Ignore if already terminated
        }
        setTimeout(() => {
          try {
            currentBridge.terminate();
          } catch {
            // Ignore
          }
        }, 50);
      }
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

  // rAF-throttled scroll tracker for active page + sub-page offset (stable on touch screens)
  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller || pageBoxes.length === 0) return;

    const measureActivePage = () => {
      rafScrollRef.current = null;
      const viewportCenter = scroller.scrollTop + scroller.clientHeight * 0.35;
      let bestPage = currentPageRef.current;
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

      if (bestPage !== currentPageRef.current) {
        currentPageRef.current = bestPage;
        setCurrentPage(bestPage);
      }
      scheduleProgressSave(bestPage, offsetRatio, pageBoxes.length, zoomScaleRef.current);
    };

    const handleScroll = () => {
      if (rafScrollRef.current !== null) return;
      rafScrollRef.current = requestAnimationFrame(measureActivePage);
    };

    scroller.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', handleScroll);
      if (rafScrollRef.current !== null) {
        cancelAnimationFrame(rafScrollRef.current);
        rafScrollRef.current = null;
      }
    };
  }, [pageBoxes.length, scheduleProgressSave]);

  // Preserve focal center (horizontal & vertical) whenever zoomScale commits so left/right panning stays centered
  useLayoutEffect(() => {
    const anchor = pendingFocalScrollRef.current;
    const scroller = scrollContainerRef.current;
    if (!anchor || !scroller) return;
    pendingFocalScrollRef.current = null;

    if (anchor.resetX) {
      scroller.scrollLeft = 0;
    } else {
      const maxX = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      scroller.scrollLeft = Math.min(
        maxX,
        Math.max(0, Math.round(anchor.xRatio * scroller.scrollWidth - scroller.clientWidth / 2))
      );
    }

    const maxY = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.min(
      maxY,
      Math.max(0, Math.round(anchor.yRatio * scroller.scrollHeight - scroller.clientHeight / 2))
    );
  }, [zoomScale, pageBoxes.length]);

  const commitZoomWithFocalAnchor = useCallback((nextScale: number) => {
    const clamped = clampPdfZoom(nextScale);
    const scroller = scrollContainerRef.current;
    if (scroller && scroller.scrollWidth > 0 && scroller.scrollHeight > 0) {
      const prevZoom = zoomScaleRef.current;
      const xRatio =
        clamped <= 1.01
          ? 0.5
          : prevZoom <= 1.01
            ? 0.5
            : (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth;
      const yRatio = (scroller.scrollTop + scroller.clientHeight / 2) / scroller.scrollHeight;
      pendingFocalScrollRef.current = {
        xRatio: Math.min(1, Math.max(0, xRatio)),
        yRatio: Math.min(1, Math.max(0, yRatio)),
        resetX: clamped <= 1.01,
      };
    }
    setLiveCssScale(1);
    setZoomScale(clamped);
  }, []);

  // Two-phase zoom commit helper: Phase 1 live CSS scale -> Phase 2 settled sharp re-render (200ms)
  const applyTwoPhaseZoom = useCallback(
    (nextScale: number, immediate = false) => {
      const clamped = clampPdfZoom(nextScale);
      if (immediate) {
        if (zoomSettleTimerRef.current !== null) {
          window.clearTimeout(zoomSettleTimerRef.current);
          zoomSettleTimerRef.current = null;
        }
        commitZoomWithFocalAnchor(clamped);
        return;
      }

      const ratio = clamped / zoomScaleRef.current;
      if (rafZoomRef.current !== null) cancelAnimationFrame(rafZoomRef.current);
      rafZoomRef.current = requestAnimationFrame(() => {
        setLiveCssScale(ratio);
      });

      if (zoomSettleTimerRef.current !== null) {
        window.clearTimeout(zoomSettleTimerRef.current);
      }
      zoomSettleTimerRef.current = window.setTimeout(() => {
        zoomSettleTimerRef.current = null;
        commitZoomWithFocalAnchor(clamped);
      }, 200);
    },
    [commitZoomWithFocalAnchor]
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

  // Native non-passive touch listeners for rock-solid touch scrolling, deadzoned pinch-to-zoom,
  // and accidental-scroll-proof double-tap toggle (Fit-to-Width <-> 1.75x)
  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        touchGestureRef.current.active = false;
        touchGestureRef.current.wasMultiTouch = true;
        lastTapRef.current = null;
        if (dist >= 30) {
          if (zoomSettleTimerRef.current !== null) {
            window.clearTimeout(zoomSettleTimerRef.current);
            zoomSettleTimerRef.current = null;
          }
          pinchStateRef.current = {
            active: true,
            engaged: false,
            startDist: dist,
            startScale: zoomScaleRef.current,
            pendingScale: zoomScaleRef.current,
            cooldownUntil: 0,
          };
        }
        return;
      }

      if (e.touches.length === 1) {
        const target = e.target as HTMLElement | null;
        if (target?.closest('button, a, input, label, select')) {
          touchGestureRef.current.active = false;
          return;
        }
        const now = Date.now();
        if (now < pinchStateRef.current.cooldownUntil) {
          touchGestureRef.current.active = false;
          return;
        }
        touchGestureRef.current = {
          active: true,
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          startTime: now,
          moved: false,
          wasMultiTouch: false,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStateRef.current.active) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);

        // Require deliberate 16px pinch movement before zooming so light finger rests stay rock-steady
        if (!pinchStateRef.current.engaged) {
          if (Math.abs(dist - pinchStateRef.current.startDist) < 16) {
            return;
          }
          pinchStateRef.current.engaged = true;
        }

        e.preventDefault();
        const factor = dist / pinchStateRef.current.startDist;
        const nextScale = clampPdfZoom(pinchStateRef.current.startScale * factor);
        pinchStateRef.current.pendingScale = nextScale;
        const cssRatio = nextScale / zoomScaleRef.current;

        if (rafZoomRef.current !== null) cancelAnimationFrame(rafZoomRef.current);
        rafZoomRef.current = requestAnimationFrame(() => {
          setLiveCssScale(cssRatio);
        });
        return;
      }

      if (e.touches.length === 1 && touchGestureRef.current.active && !touchGestureRef.current.moved) {
        const dx = e.touches[0].clientX - touchGestureRef.current.startX;
        const dy = e.touches[0].clientY - touchGestureRef.current.startY;
        if (Math.hypot(dx, dy) > 10) {
          touchGestureRef.current.moved = true;
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (pinchStateRef.current.active && e.touches.length < 2) {
        const { engaged, pendingScale } = pinchStateRef.current;
        pinchStateRef.current = {
          active: false,
          engaged: false,
          startDist: 0,
          startScale: pendingScale,
          pendingScale,
          cooldownUntil: Date.now() + 350,
        };
        lastTapRef.current = null;
        if (engaged) {
          commitZoomWithFocalAnchor(pendingScale);
        } else {
          setLiveCssScale(1);
        }
        return;
      }

      if (e.touches.length === 0 && touchGestureRef.current.active) {
        const gesture = touchGestureRef.current;
        touchGestureRef.current.active = false;
        const now = Date.now();
        const isCleanTap =
          !gesture.moved &&
          !gesture.wasMultiTouch &&
          now - gesture.startTime < 260 &&
          now >= pinchStateRef.current.cooldownUntil;

        if (!isCleanTap) {
          lastTapRef.current = null;
          return;
        }

        const prevTap = lastTapRef.current;
        if (
          prevTap &&
          now - prevTap.time < 280 &&
          Math.hypot(gesture.startX - prevTap.x, gesture.startY - prevTap.y) <= 32
        ) {
          lastTapRef.current = null;
          commitZoomWithFocalAnchor(zoomScaleRef.current > 1.25 ? 1.0 : 1.75);
        } else {
          lastTapRef.current = { time: now, x: gesture.startX, y: gesture.startY };
        }
      }
    };

    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    scroller.addEventListener('touchend', onTouchEnd, { passive: true });
    scroller.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [commitZoomWithFocalAnchor]);

  // Desktop click-and-drag horizontal/vertical panning when zoomed in (>100%)
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || zoomScaleRef.current <= 1.01) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input, label, select')) return;
    const scroller = scrollContainerRef.current;
    if (!scroller) return;
    mousePanRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: scroller.scrollLeft,
      startScrollTop: scroller.scrollTop,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!mousePanRef.current.active) return;
    const scroller = scrollContainerRef.current;
    if (!scroller) return;
    const dx = e.clientX - mousePanRef.current.startX;
    const dy = e.clientY - mousePanRef.current.startY;
    scroller.scrollLeft = mousePanRef.current.startScrollLeft - dx;
    scroller.scrollTop = mousePanRef.current.startScrollTop - dy;
  }, []);

  const handleMouseUpOrLeave = useCallback(() => {
    mousePanRef.current.active = false;
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
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-2.5 py-2 text-[var(--text-primary)] safe-top sm:gap-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="hidden items-center gap-2 text-xs text-[var(--text-muted)] sm:flex">
            <span className="font-semibold text-[var(--text-primary)] whitespace-nowrap">
              {mode === 'sample' ? 'Free Sample PDF' : 'Full PDF Edition'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular whitespace-nowrap">
              {totalPages > 0 ? `Page ${currentPage} of ${totalPages}` : 'Loading pages...'}
            </span>
          </div>
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{bookTitle}</p>
        </div>

        <div className="flex items-center gap-1 shrink-0 sm:gap-1.5">
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

          {/* Two-Phase Zoom Controls: compact [-][+] on mobile, [-] 100% [+] on sm+ */}
          <div className="inline-flex items-center divide-x divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-canvas)] sm:divide-x-0">
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
              className="font-mono-tabular hidden h-9 items-center justify-center px-2 text-xs font-medium text-[var(--text-primary)] whitespace-nowrap sm:inline-flex"
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
              className="inline-flex h-9 w-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-canvas)] text-xs font-medium text-[var(--text-primary)] whitespace-nowrap hover:bg-[var(--surface-hover)] disabled:opacity-50 md:w-auto md:px-2.5"
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
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] sm:h-10 sm:w-10"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Scrollable Virtualized PDF Page Stream */}
      <div
        ref={scrollContainerRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        className={`flex-1 overflow-auto overscroll-none select-none ${
          isZoomed ? 'pdf-scroll-pannable cursor-grab active:cursor-grabbing' : 'pdf-scroll-locked'
        }`}
      >
        {loading && (
          <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-3 px-4 py-20 text-center">
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
                onClick={() => {
                  if (!workerRef.current) return;
                  setLoading(true);
                  setLoadError(null);
                  void openDocumentInWorker(workerRef.current, true).catch((err) => {
                    setLoading(false);
                    setLoadError(err instanceof Error ? err.message : 'Unable to load PDF document.');
                  });
                }}
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
            className="flex w-max min-w-full flex-col items-center gap-4 px-3 py-5 will-change-transform sm:px-6"
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
                {checkoutError && (
                  <p
                    role="alert"
                    className="mx-auto mt-4 max-w-md rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
                  >
                    {checkoutError}
                  </p>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      {/* Bottom Scrubber & Instant Jump Bar */}
      {totalPages > 0 && (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-3 py-2 text-[var(--text-primary)] safe-bottom sm:gap-3 sm:px-4 sm:py-2.5">
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
