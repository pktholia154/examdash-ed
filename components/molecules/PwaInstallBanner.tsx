'use client';

import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '@/hooks/use-pwa-install';

export function PwaInstallBanner() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [dismissed, setDismissed] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled || dismissed) {
    return null;
  }

  const handleAction = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuide(true);
  };

  return (
    <div data-nosnippet="" className="w-full">
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-start gap-3 sm:items-center">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-ink)] text-white">
            <Smartphone className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Add ExamDash (ed) to your home screen
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              Install the web app for instant full-screen launch and quick access to your books and exam packs.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <button
            type="button"
            onClick={handleAction}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-ink)] px-4 py-2 text-sm font-medium text-white whitespace-nowrap shrink-0 transition-colors duration-150 hover:bg-[var(--brand-ink-hover)]"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>Install App</span>
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss install banner"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {showGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h2
                id="pwa-install-guide-title"
                className="text-lg font-bold text-[var(--text-primary)]"
              >
                Install ExamDash (ed)
              </h2>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {isIOS ? (
              <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-[var(--text-secondary)]">
                <li>1. Tap the Share button in the Safari browser toolbar.</li>
                <li>2. Scroll down and select Add to Home Screen.</li>
                <li>3. Tap Add to launch ExamDash (ed) like a native app.</li>
              </ol>
            ) : (
              <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-[var(--text-secondary)]">
                <li>1. Open your browser menu or look for the install icon in the address bar.</li>
                <li>2. Select Install ExamDash (ed) or Add to Home screen.</li>
                <li>3. Confirm to pin ExamDash (ed) to your device launcher.</li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-6 min-h-[44px] w-full rounded-lg bg-[var(--brand-ink)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-ink-hover)]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
