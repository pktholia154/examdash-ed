import { NextRequest, NextResponse } from 'next/server';
import {
  clearFailedLoginAttempts,
  isLoginRateLimited,
  recordFailedLoginAttempt,
  REVIEWER_SESSION_COOKIE_NAME,
  REVIEWER_SESSION_HINT_COOKIE_NAME,
  REVIEWER_SESSION_TTL_SECONDS,
  ReviewerLoginInputSchema,
  signReviewerSessionToken,
  verifyReviewerCredentials,
} from '@/core/auth/reviewer-account';

export const runtime = 'nodejs';

function getClientIpKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip')?.trim();
  return realIp || 'unknown';
}

function isSecureRequest(req: NextRequest): boolean {
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return proto === 'https' || req.nextUrl.protocol === 'https:';
}

export async function POST(req: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
  const clientKey = getClientIpKey(req);

  if (isLoginRateLimited(clientKey)) {
    return NextResponse.json(
      { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
      { status: 429, headers }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = ReviewerLoginInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please enter a valid email or username and password.' },
      { status: 400, headers }
    );
  }

  const identity = verifyReviewerCredentials(parsed.data.identifier, parsed.data.password);
  if (!identity) {
    recordFailedLoginAttempt(clientKey);
    return NextResponse.json(
      { error: 'Invalid email or password.' },
      { status: 401, headers }
    );
  }

  clearFailedLoginAttempts(clientKey);
  const token = signReviewerSessionToken(identity);
  const secure = isSecureRequest(req);

  const response = NextResponse.json(
    {
      authenticated: true,
      user: {
        uid: identity.uid,
        email: identity.email,
        displayName: identity.displayName,
      },
      token,
    },
    { status: 200, headers }
  );

  response.cookies.set(REVIEWER_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: REVIEWER_SESSION_TTL_SECONDS,
  });

  // Non-secret presence hint so general users never incur an extra session check request
  response.cookies.set(REVIEWER_SESSION_HINT_COOKIE_NAME, '1', {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: REVIEWER_SESSION_TTL_SECONDS,
  });

  return response;
}
