'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  BookOpen,
  Check,
  CloudDownload,
  CloudOff,
  List,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Moon,
  RotateCcw,
  ShoppingCart,
  Sun,
  X,
} from 'lucide-react';
import {
  clampMarkdownScale,
  computeBlockProgressPercent,
  parseMarkdownDocument,
  stepMarkdownScale,
  type ParsedMarkdownDocument,
} from '@/core/readers/markdown-engine';
import {
  webExternalLinkAdapter,
  webFullscreenAdapter,
  webOfflineStorageAdapter,
  webPreferencesAdapter,
} from '@/core/adapters/platform';
import { formatPrice } from '@/lib/design-system/formatters';
import type { ReaderMode, ReadingProgressRecord, ReadingTheme } from '@/lib/design-system/types';

export interface MarkdownReaderModalProps {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly mode: ReaderMode;
  readonly buyPrice: number;
  readonly currency: string;
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

const PREF_MD_SCALE_KEY = 'examdash_md_scale_v1';
const PREF_MD_THEME_KEY = 'examdash_md_theme_v1';

function makeOfflineMdKey(bookId: string, mode: ReaderMode): string {
  return `md_${bookId}_${mode}.md`;
}

export function MarkdownReaderModal({
  bookId,
  bookTitle,
  mode,
  buyPrice,
  currency,
  entitlementProof,
  getAuthToken,
  initialProgress,
  isInCart,
  checkoutBusy,
  onSaveProgress,
  onAddToCart,
  onBuyNow,
  onClose,
}: MarkdownReaderModalProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const activeBlockRef = useRef<number>(initialProgress?.blockIndex ?? 0);
  const progressTimerRef = useRef<number | null>(null);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchDebounceRef = useRef<number | null>(null);
  const rawMarkdownRef = useRef<string>('');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [parsedDoc, setParsedDoc] = useState<ParsedMarkdownDocument | null>(null);
  const [mdScale, setMdScale] = useState<number>(() => {
    const saved = webPreferencesAdapter.get(PREF_MD_SCALE_KEY);
    if (saved) return clampMarkdownScale(Number(saved));
    return clampMarkdownScale(initialProgress?.zoomScale ?? 1.0);
  });
  const [theme, setTheme] = useState<ReadingTheme>(() => {
    const saved = webPreferencesAdapter.get(PREF_MD_THEME_KEY);
    return saved === 'sepia' || saved === 'dark' ? saved : 'light';
  });
  const [tocOpen, setTocOpen] = useState(false);
  const [activeBlock, setActiveBlock] = useState(initialProgress?.blockIndex ?? 0);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const progressPercent = useMemo(
    () => computeBlockProgressPercent(activeBlock, parsedDoc?.blockCount ?? 0),
    [activeBlock, parsedDoc?.blockCount]
  );

  // Check offline cache status
  useEffect(() => {
    let active = true;
    void webOfflineStorageAdapter.hasText(makeOfflineMdKey(bookId, mode)).then((exists) => {
      if (active) setOfflineSaved(exists);
    });
    return () => {
      active = false;
    };
  }, [bookId, mode]);

  // Flush anchor-based reading progress
  const flushProgressNow = useCallback(() => {
    const totalBlocks = parsedDoc?.blockCount ?? 0;
    if (totalBlocks <= 0) return;
    onSaveProgress({
      bookId,
      format: 'markdown',
      mode,
      pageIndex: 0,
      totalPages: totalBlocks,
      offsetRatio: 0,
      blockIndex: activeBlockRef.current,
      zoomScale: mdScale,
      progressPercent: computeBlockProgressPercent(activeBlockRef.current, totalBlocks),
    });
  }, [bookId, mdScale, mode, onSaveProgress, parsedDoc?.blockCount]);

  const scheduleProgressSave = useCallback(() => {
    if (progressTimerRef.current !== null) {
      window.clearTimeout(progressTimerRef.current);
    }
    progressTimerRef.current = window.setTimeout(() => {
      flushProgressNow();
    }, 1000);
  }, [flushProgressNow]);

  const [reloadTick, setReloadTick] = useState(0);
  const initialBlockIndexRef = useRef<number>(initialProgress?.blockIndex ?? 0);

  // Fetch & sanitize Markdown (checks offline IndexedDB first, then server proxy)
  useEffect(() => {
    let cancelled = false;

    async function fetchAndParseMarkdown() {
      try {
        let markdownText = await webOfflineStorageAdapter.readText(makeOfflineMdKey(bookId, mode));
        let assetBaseUrl: string | undefined;

        if (!markdownText) {
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
          const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/markdown?mode=${mode}`, {
            headers,
          });
          const payload = (await res.json().catch(() => ({}))) as {
            markdown?: string;
            assetBaseUrl?: string;
            error?: string;
          };
          if (!res.ok || typeof payload.markdown !== 'string') {
            throw new Error(payload.error || 'Unable to load Markdown document.');
          }
          markdownText = payload.markdown;
          assetBaseUrl = payload.assetBaseUrl;
        }

        if (cancelled) return;

        rawMarkdownRef.current = markdownText;

        const parsed = parseMarkdownDocument(markdownText, {
          assetBaseUrl,
          sanitizer: (dirtyHtml) =>
            DOMPurify.sanitize(dirtyHtml, {
              USE_PROFILES: { html: true },
              FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
              ADD_ATTR: [
                'data-md-block',
                'data-md-lightbox',
                'data-md-external',
                'loading',
                'decoding',
                'referrerpolicy',
              ],
            }),
        });

        if (cancelled) return;

        setParsedDoc(parsed);
        setLoading(false);

        // Re-anchor to saved paragraph block after mount
        const savedBlock = initialBlockIndexRef.current;
        if (savedBlock > 0) {
          requestAnimationFrame(() => {
            const el = articleRef.current?.querySelector<HTMLElement>(
              `[data-md-block="${savedBlock}"]`
            );
            if (el) {
              el.scrollIntoView({ behavior: 'auto', block: 'start' });
            }
          });
        }
      } catch (err) {
        if (cancelled) return;
        setLoading(false);
        setLoadError(err instanceof Error ? err.message : 'Unable to render Markdown.');
      }
    }

    void fetchAndParseMarkdown();

    return () => {
      cancelled = true;
      if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current);
      if (pinchDebounceRef.current !== null) window.clearTimeout(pinchDebounceRef.current);
      flushProgressNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, mode, reloadTick]);

  // Flush progress immediately on visibilitychange
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushProgressNow();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [flushProgressNow]);

  // IntersectionObserver tracking top-most visible block for zoom-resilient scroll anchoring
  useEffect(() => {
    const scroller = scrollerRef.current;
    const article = articleRef.current;
    if (!scroller || !article || !parsedDoc) return;

    const blocks = Array.from(article.querySelectorAll<HTMLElement>('[data-md-block]'));
    if (blocks.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let topMostIdx: number | null = null;
        let smallestTop = Number.POSITIVE_INFINITY;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number((entry.target as HTMLElement).dataset.mdBlock);
          if (!Number.isFinite(idx)) continue;
          if (entry.boundingClientRect.top < smallestTop) {
            smallestTop = entry.boundingClientRect.top;
            topMostIdx = idx;
          }
        }
        if (topMostIdx !== null && topMostIdx !== activeBlockRef.current) {
          activeBlockRef.current = topMostIdx;
          setActiveBlock(topMostIdx);
          scheduleProgressSave();
        }
      },
      {
        root: scroller,
        rootMargin: '-10% 0px -70% 0px',
        threshold: [0, 0.25],
      }
    );

    for (const block of blocks) {
      observer.observe(block);
    }

    return () => observer.disconnect();
  }, [parsedDoc, scheduleProgressSave]);

  // True Reflowable Zoom with Block-Anchor Restoration (never loses reading position)
  const applyReflowZoom = useCallback((nextScale: number) => {
    const clamped = clampMarkdownScale(nextScale);
    const anchorIdx = activeBlockRef.current;

    setMdScale(clamped);
    webPreferencesAdapter.set(PREF_MD_SCALE_KEY, String(clamped));

    requestAnimationFrame(() => {
      const anchorEl = articleRef.current?.querySelector<HTMLElement>(
        `[data-md-block="${anchorIdx}"]`
      );
      if (anchorEl) {
        anchorEl.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    });
  }, []);

  // Keyboard bindings: Ctrl/Cmd +, Ctrl/Cmd -, Ctrl/Cmd 0, Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxImage) {
          setLightboxImage(null);
        } else if (tocOpen) {
          setTocOpen(false);
        } else {
          onClose();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        applyReflowZoom(stepMarkdownScale(mdScale, 1));
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        applyReflowZoom(stepMarkdownScale(mdScale, -1));
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        applyReflowZoom(1.0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyReflowZoom, lightboxImage, mdScale, onClose, tocOpen]);

  // Delegated Capacitor-safe link & image lightbox click handler
  const handleArticleClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    // 1. Tap-to-inspect image lightbox
    const img = target.closest('img[data-md-lightbox="true"]') as HTMLImageElement | null;
    if (img && img.src) {
      e.preventDefault();
      setLightboxImage({ src: img.src, alt: img.alt || 'Document illustration' });
      return;
    }

    // 2. Intercept all link clicks to prevent WebView hijacking
    const anchor = target.closest('a') as HTMLAnchorElement | null;
    if (!anchor) return;
    const rawHref = anchor.getAttribute('href') || '';
    if (!rawHref) return;

    if (rawHref.startsWith('#')) {
      e.preventDefault();
      const targetId = rawHref.slice(1);
      const heading = articleRef.current?.querySelector<HTMLElement>(`#${CSS.escape(targetId)}`);
      if (heading) {
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

    if (/^https?:\/\//i.test(rawHref)) {
      e.preventDefault();
      webExternalLinkAdapter.openExternal(rawHref);
    }
  }, []);

  // Debounced two-finger pinch mapped to discrete --md-scale steps on touch screens
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistRef.current = Math.hypot(dx, dy);
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 2 && pinchStartDistRef.current) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const delta = dist - pinchStartDistRef.current;
        if (Math.abs(delta) > 36) {
          pinchStartDistRef.current = dist;
          const stepDir = delta > 0 ? 1 : -1;
          if (pinchDebounceRef.current !== null) window.clearTimeout(pinchDebounceRef.current);
          pinchDebounceRef.current = window.setTimeout(() => {
            applyReflowZoom(stepMarkdownScale(mdScale, stepDir));
          }, 90);
        }
      }
    },
    [applyReflowZoom, mdScale]
  );

  const handleTouchEnd = useCallback(() => {
    pinchStartDistRef.current = null;
  }, []);

  const handleThemeChange = useCallback((nextTheme: ReadingTheme) => {
    setTheme(nextTheme);
    webPreferencesAdapter.set(PREF_MD_THEME_KEY, nextTheme);
  }, []);

  const toggleOfflineSave = useCallback(async () => {
    const key = makeOfflineMdKey(bookId, mode);
    setOfflineBusy(true);
    try {
      if (offlineSaved) {
        await webOfflineStorageAdapter.deleteText(key);
        setOfflineSaved(false);
      } else if (rawMarkdownRef.current) {
        await webOfflineStorageAdapter.saveText(key, rawMarkdownRef.current);
        setOfflineSaved(true);
      }
    } finally {
      setOfflineBusy(false);
    }
  }, [bookId, mode, offlineSaved]);

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
      // Ignore fullscreen rejection
    }
  }, []);

  const themeClass =
    theme === 'dark'
      ? 'reader-theme-dark'
      : theme === 'sepia'
        ? 'reader-theme-sepia'
        : 'reader-theme-light';

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${bookTitle} — ${mode === 'sample' ? 'Sample Markdown Preview' : 'Full Markdown Reader'}`}
      data-testid="markdown-reader-modal"
      data-reader-mode={mode}
      data-md-scale={mdScale}
      className={`fixed inset-0 z-50 flex flex-col overscroll-y-none ${themeClass}`}
      style={{
        backgroundColor: 'var(--md-bg)',
        color: 'var(--md-fg)',
        ['--md-scale' as string]: String(mdScale),
      }}
    >
      {/* Top Minimal HUD */}
      <header
        className="flex items-center justify-between gap-2 border-b px-3 py-2 safe-top sm:px-5"
        style={{ borderColor: 'var(--md-border)', backgroundColor: 'var(--md-bg)' }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <button
            type="button"
            onClick={() => setTocOpen((v) => !v)}
            aria-label="Toggle table of contents"
            aria-expanded={tocOpen}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors hover:opacity-80"
            style={{ borderColor: 'var(--md-border)' }}
          >
            <List className="h-4 w-4" aria-hidden="true" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--md-muted)' }}>
              <span className="font-semibold" style={{ color: 'var(--md-fg)' }}>
                {mode === 'sample' ? 'Free Sample Markdown' : 'Full Markdown Edition'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">{progressPercent}% read</span>
            </div>
            <p className="truncate text-sm font-semibold">{bookTitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Reflowable Zoom Controls: A-, 100%, A+ */}
          <div
            role="group"
            aria-label="Text zoom controls"
            className="inline-flex items-center rounded-lg border"
            style={{ borderColor: 'var(--md-border)' }}
          >
            <button
              type="button"
              onClick={() => applyReflowZoom(stepMarkdownScale(mdScale, -1))}
              aria-label="Decrease text size"
              className="inline-flex h-9 min-w-[36px] items-center justify-center px-2 text-xs font-semibold hover:opacity-80"
            >
              A-
            </button>
            <button
              type="button"
              onClick={() => applyReflowZoom(1.0)}
              aria-label="Reset text size to 100%"
              className="font-mono-tabular h-9 border-x px-2 text-xs font-medium whitespace-nowrap"
              style={{ borderColor: 'var(--md-border)' }}
            >
              {Math.round(mdScale * 100)}%
            </button>
            <button
              type="button"
              onClick={() => applyReflowZoom(stepMarkdownScale(mdScale, 1))}
              aria-label="Increase text size"
              className="inline-flex h-9 min-w-[36px] items-center justify-center px-2 text-xs font-semibold hover:opacity-80"
            >
              A+
            </button>
          </div>

          {/* Mobile Compact Theme Cycle (Light -> Sepia -> Dark) */}
          <button
            type="button"
            onClick={() =>
              handleThemeChange(
                theme === 'light' ? 'sepia' : theme === 'sepia' ? 'dark' : 'light'
              )
            }
            aria-label={`Switch Markdown reading theme (current: ${theme})`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border sm:hidden"
            style={{ borderColor: 'var(--md-border)' }}
          >
            {theme === 'light' ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : theme === 'sepia' ? (
              <BookOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
          </button>

          {/* Theme Switcher */}
          <div
            role="group"
            aria-label="Markdown reading theme"
            className="hidden items-center rounded-lg border p-0.5 sm:inline-flex"
            style={{ borderColor: 'var(--md-border)' }}
          >
            <button
              type="button"
              onClick={() => handleThemeChange('light')}
              aria-label="Light reading theme"
              aria-pressed={theme === 'light'}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${
                theme === 'light' ? 'bg-slate-900 text-white' : 'opacity-65 hover:opacity-100'
              }`}
            >
              <Sun className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => handleThemeChange('sepia')}
              aria-label="Sepia reading theme"
              aria-pressed={theme === 'sepia'}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${
                theme === 'sepia' ? 'bg-slate-900 text-white' : 'opacity-65 hover:opacity-100'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => handleThemeChange('dark')}
              aria-label="Dark reading theme"
              aria-pressed={theme === 'dark'}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${
                theme === 'dark' ? 'bg-white text-slate-900' : 'opacity-65 hover:opacity-100'
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

          {/* Offline Cache Toggle (Full Mode) */}
          {mode === 'full' && (
            <button
              type="button"
              onClick={() => void toggleOfflineSave()}
              disabled={offlineBusy}
              aria-label={offlineSaved ? 'Remove offline markdown' : 'Save markdown offline'}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap hover:opacity-80 disabled:opacity-50"
              style={{ borderColor: 'var(--md-border)' }}
            >
              {offlineSaved ? (
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
            className="hidden h-9 w-9 items-center justify-center rounded-lg border hover:opacity-80 sm:inline-flex"
            style={{ borderColor: 'var(--md-border)' }}
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
            aria-label="Close Markdown reader"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:opacity-75"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Main Reader Split (Optional Slide-Over TOC + Reflowable Prose Stream) */}
      <div className="relative flex flex-1 overflow-hidden">
        {tocOpen && (
          <aside
            aria-label="Table of Contents"
            className="absolute inset-y-0 left-0 z-20 flex w-72 max-w-[82vw] flex-col border-r shadow-lg md:static md:shadow-none"
            style={{ borderColor: 'var(--md-border)', backgroundColor: 'var(--md-bg)' }}
          >
            <div
              className="flex items-center justify-between border-b px-4 py-3"
              style={{ borderColor: 'var(--md-border)' }}
            >
              <span className="text-xs font-bold tracking-wide uppercase" style={{ color: 'var(--md-muted)' }}>
                Contents ({parsedDoc?.toc.length ?? 0})
              </span>
              <button
                type="button"
                onClick={() => setTocOpen(false)}
                aria-label="Close table of contents"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:opacity-75"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-3">
              {!parsedDoc || parsedDoc.toc.length === 0 ? (
                <p className="px-2 py-4 text-xs" style={{ color: 'var(--md-muted)' }}>
                  No headings found in this section.
                </p>
              ) : (
                <ul className="space-y-1">
                  {parsedDoc.toc.map((heading) => (
                    <li key={heading.id}>
                      <button
                        type="button"
                        onClick={() => {
                          const target = articleRef.current?.querySelector<HTMLElement>(
                            `#${CSS.escape(heading.id)}`
                          );
                          if (target) {
                            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }
                          if (window.innerWidth < 768) setTocOpen(false);
                        }}
                        className={`block w-full truncate rounded-md px-2 py-2 text-left text-xs transition-opacity hover:opacity-80 ${
                          heading.level === 1
                            ? 'font-bold'
                            : heading.level === 2
                              ? 'pl-4 font-medium'
                              : 'pl-7 opacity-80'
                        }`}
                      >
                        {heading.text}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </nav>
          </aside>
        )}

        <div
          ref={scrollerRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="flex-1 overflow-y-auto overscroll-y-none px-4 py-6 safe-bottom sm:px-8"
        >
          {loading && (
            <div className="mx-auto flex max-w-xl flex-col items-center justify-center gap-3 py-20 text-center">
              <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
              <p className="text-sm font-medium">
                Loading {mode === 'sample' ? 'sample markdown preview' : 'full markdown book'}...
              </p>
            </div>
          )}

          {!loading && loadError && (
            <div
              className="mx-auto my-12 max-w-lg rounded-xl border p-6 text-center"
              style={{ borderColor: 'var(--md-border)' }}
            >
              <p className="text-base font-bold">Unable to load Markdown</p>
              <p className="mt-2 text-sm" style={{ color: 'var(--md-muted)' }}>
                {loadError}
              </p>
              <div className="mt-5 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setLoadError(null);
                    setReloadTick((t) => t + 1);
                  }}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-ink)] px-4 py-2 text-sm font-medium text-white"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  <span>Retry</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] rounded-lg border px-4 py-2 text-sm font-medium"
                  style={{ borderColor: 'var(--md-border)' }}
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {!loading && !loadError && parsedDoc && (
            <>
              <article
                ref={articleRef}
                onClick={handleArticleClick}
                className={`md-reader-prose ${mode === 'full' ? 'select-none' : ''}`}
                dangerouslySetInnerHTML={{ __html: parsedDoc.html }}
              />

              {/* Native End-of-Sample Paywall CTA Card */}
              {mode === 'sample' && (
                <section
                  aria-label="Unlock full markdown book"
                  className="mx-auto mt-10 mb-6 max-w-2xl rounded-xl border p-6 text-center"
                  style={{
                    borderColor: 'var(--md-border)',
                    backgroundColor: 'var(--md-code-bg)',
                  }}
                >
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border" style={{ borderColor: 'var(--md-border)' }}>
                    <Lock className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h2 className="mt-3 text-lg font-bold">End of Free Sample Preview</h2>
                  <p className="mx-auto mt-1.5 max-w-md text-sm" style={{ color: 'var(--md-muted)' }}>
                    Unlock the complete edition of <span className="font-semibold">{bookTitle}</span> for full Markdown and PDF access inside your Purchased Library.
                  </p>
                  <p className="font-mono-tabular mt-3 text-lg font-bold">
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
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium"
                        style={{ borderColor: 'var(--md-border)' }}
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
            </>
          )}
        </div>
      </div>

      {/* Tap-to-Inspect Image Lightbox */}
      {lightboxImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Inspect illustration"
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/85 p-4"
        >
          <button
            type="button"
            onClick={() => setLightboxImage(null)}
            aria-label="Close image preview"
            className="absolute top-4 right-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <img
            src={lightboxImage.src}
            alt={lightboxImage.alt}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}
