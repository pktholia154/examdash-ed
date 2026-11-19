'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Mail,
} from 'lucide-react';
import { useAppSession } from '@/components/providers/AppSessionProvider';
import { DESIGN_TOKENS } from '@/lib/design-system/tokens';

function sanitizeRedirectTarget(raw: string | null): string {
  if (!raw) return '/';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/';
  }
  return trimmed;
}

export function ReviewerLoginTemplate() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = sanitizeRedirectTarget(searchParams.get('redirect'));

  const { user, authReady, authBusy, authError, signIn, signInWithReviewerCredentials, signOut } =
    useAppSession();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const cleanId = identifier.trim();
    if (!cleanId || !password) {
      setFormError('Please enter your email or username and password.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await signInWithReviewerCredentials(cleanId, password);
      if (!result.ok) {
        setFormError(result.error || 'Invalid email or password.');
        return;
      }
      router.push(redirectTarget);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setFormError(null);
    const signedIn = await signIn();
    if (signedIn) {
      router.push(redirectTarget);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--surface-canvas)]">
      <header className="border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)] safe-top">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="font-display text-base font-bold tracking-tight text-[var(--text-primary)] whitespace-nowrap sm:text-lg"
          >
            {DESIGN_TOKENS.brand.name}
          </Link>

          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back to catalog</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12 sm:px-6">
        {authReady && user ? (
          <section
            aria-labelledby="signed-in-heading"
            className="space-y-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-6 sm:p-7"
          >
            <div className="flex items-start gap-3">
              <CheckCircle2
                className="mt-0.5 h-5 w-5 shrink-0 text-[var(--semantic-discount)]"
                aria-hidden="true"
              />
              <div className="min-w-0 space-y-1">
                <h1
                  id="signed-in-heading"
                  className="text-lg font-bold tracking-tight text-[var(--text-primary)]"
                >
                  Signed in
                </h1>
                <p className="truncate text-sm text-[var(--text-secondary)]">
                  {user.displayName ? `${user.displayName} (${user.email ?? user.uid})` : user.email ?? user.uid}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <Link
                href={redirectTarget}
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[var(--brand-ink)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-ink-hover)]"
              >
                Continue to ExamDash
              </Link>
              <Link
                href="/purchased"
                rel="nofollow"
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)]"
              >
                Open Purchased Library
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={authBusy}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-60"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>Sign out</span>
              </button>
            </div>
          </section>
        ) : (
          <section
            aria-labelledby="login-heading"
            className="space-y-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-6 sm:p-7"
          >
            <div className="space-y-1">
              <h1
                id="login-heading"
                className="text-xl font-bold tracking-tight text-[var(--text-primary)]"
              >
                Account Sign In
              </h1>
              <p className="text-sm text-[var(--text-secondary)]">
                Sign in to access checkout, orders, and your ExamDash library.
              </p>
            </div>

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label
                  htmlFor="login-identifier"
                  className="block text-xs font-semibold text-[var(--text-primary)]"
                >
                  Email or Username
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
                    aria-hidden="true"
                  />
                  <input
                    id="login-identifier"
                    name="email"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="name@example.com"
                    className="h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-canvas)] pr-3.5 pl-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-xs font-semibold text-[var(--text-primary)]"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
                    aria-hidden="true"
                  />
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-canvas)] pr-11 pl-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute top-1/2 right-1 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              {(formError || authError) && (
                <p
                  role="alert"
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
                >
                  {formError || authError}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting || authBusy}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand-ink)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-ink-hover)] disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" aria-hidden="true" />
                    <span>Sign in</span>
                  </>
                )}
              </button>
            </form>

            <div className="relative flex items-center py-1" aria-hidden="true">
              <div className="flex-1 border-t border-[var(--border-subtle)]" />
              <span className="px-3 text-xs text-[var(--text-muted)]">or</span>
              <div className="flex-1 border-t border-[var(--border-subtle)]" />
            </div>

            <button
              type="button"
              onClick={() => void handleGoogleSignIn()}
              disabled={submitting || authBusy}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-60"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              <span>Continue with Google</span>
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
