/**
 * Pure PDF reader windowing, eviction, priority render queue, DPR,
 * and resume offset calculations — framework-agnostic for Web and Capacitor.
 */

export interface PageMetric {
  readonly pageNumber: number; // 1-based
  readonly rawWidth: number;
  readonly rawHeight: number;
}

export interface PageLayoutBox {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: number;
}

export interface PdfResumeState {
  readonly pageIndex: number; // 0-based
  readonly offsetRatio: number; // 0..1 within active page
  readonly zoomScale: number;
  readonly updatedAt: number;
}

/**
 * Caps devicePixelRatio to avoid iOS WKWebView / Android WebView canvas RAM crashes.
 */
export function computeAdaptiveDpr(devicePixelRatio: number, isMobile: boolean): number {
  const safeDpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(safeDpr, isMobile ? 1.75 : 2.0);
}

/**
 * Clamps PDF zoom scale cleanly within supported bounds.
 */
export function clampPdfZoom(scale: number, min = 0.75, max = 3.0): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.round(Math.min(max, Math.max(min, scale)) * 100) / 100;
}

/**
 * Computes exact proportional pixel box for a PDF page so placeholder skeletons
 * never trigger Cumulative Layout Shift (CLS = 0).
 */
export function computeScaledPageBox(
  metric: PageMetric,
  containerWidth: number,
  zoomScale: number
): PageLayoutBox {
  const safeContainer = Math.max(260, containerWidth);
  const safeRawW = metric.rawWidth > 0 ? metric.rawWidth : 595;
  const safeRawH = metric.rawHeight > 0 ? metric.rawHeight : 842;
  const aspectRatio = safeRawH / safeRawW;
  const width = Math.round(safeContainer * clampPdfZoom(zoomScale));
  const height = Math.round(width * aspectRatio);
  return {
    pageNumber: metric.pageNumber,
    width,
    height,
    aspectRatio,
  };
}

/**
 * Computes the tight bidirectional active render window around the current page:
 * Desktop: current ± 3 pages (max 7 canvases)
 * Mobile:  current ± 2 pages (max 5 canvases)
 */
export function computeActiveRenderWindow(
  currentPage: number,
  totalPages: number,
  isMobile: boolean
): number[] {
  if (totalPages <= 0) return [];
  const clampedCurrent = Math.max(1, Math.min(totalPages, Math.floor(currentPage)));
  const radius = isMobile ? 2 : 3;
  const start = Math.max(1, clampedCurrent - radius);
  const end = Math.min(totalPages, clampedCurrent + radius);
  const pages: number[] = [];
  for (let p = start; p <= end; p += 1) {
    pages.push(p);
  }
  return pages;
}

/**
 * Returns rendered page numbers that have exited the outer eviction zone
 * (~1500px from viewport) so their canvas backing stores can be released (width=0, height=0).
 */
export function computeEvictionPages(
  renderedPages: readonly number[],
  pageBounds: ReadonlyMap<number, { top: number; bottom: number }>,
  viewportTop: number,
  viewportBottom: number,
  evictionMarginPx = 1500
): number[] {
  const minKeep = viewportTop - evictionMarginPx;
  const maxKeep = viewportBottom + evictionMarginPx;
  const toEvict: number[] = [];

  for (const pageNumber of renderedPages) {
    const bounds = pageBounds.get(pageNumber);
    if (!bounds) continue;
    if (bounds.bottom < minKeep || bounds.top > maxKeep) {
      toEvict.push(pageNumber);
    }
  }
  return toEvict;
}

/**
 * Orders pending page renders by proximity to the active viewport center page.
 */
export function prioritizeRenderQueue(
  pendingPages: readonly number[],
  currentPage: number
): number[] {
  return [...pendingPages].sort((a, b) => {
    const distA = Math.abs(a - currentPage);
    const distB = Math.abs(b - currentPage);
    if (distA !== distB) return distA - distB;
    return a - b;
  });
}

/**
 * Uses instant scrollTo for jumps > 5 pages to prevent IntersectionObserver storms.
 */
export function shouldUseInstantJump(fromPage: number, toPage: number): boolean {
  return Math.abs(toPage - fromPage) > 5;
}

/**
 * Computes normalized 0..100 reading progress from 0-based pageIndex and offsetRatio.
 */
export function computePdfProgressPercent(
  pageIndex: number,
  totalPages: number,
  offsetRatio = 0
): number {
  if (totalPages <= 0) return 0;
  const clampedPage = Math.max(0, Math.min(totalPages - 1, pageIndex));
  const clampedOffset = Math.max(0, Math.min(1, offsetRatio));
  const fraction = (clampedPage + Math.max(0.15, clampedOffset)) / totalPages;
  return Math.min(100, Math.max(0, Math.round(fraction * 100)));
}
