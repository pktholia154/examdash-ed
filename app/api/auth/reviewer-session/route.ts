import { NextRequest, NextResponse } from 'next/server';
import {
  REVIEWER_SESSION_COOKIE_NAME,
  REVIEWER_SESSION_HINT_COOKIE_NAME,
  verifyReviewerSessionToken,
} from '@/core/auth/reviewer-account';

export const runtime = 'nodejs';

function isSecureRequest(req: NextRequest): boolean {
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return proto === 'https' || req.nextUrl.protocol === 'https:';
}

export async function GET(req: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
  const secure = isSecureRequest(req);
  const rawToken = req.cookies.get(REVIEWER_SESSION_COOKIE_NAME)?.value?.trim();

  if (!rawToken) {
    const res = NextResponse.json(
      { authenticated: false, user: null, token: null },
      { status: 200, headers }
    );
    if (req.cookies.get(REVIEWER_SESSION_HINT_COOKIE_NAME)) {
      res.cookies.set(REVIEWER_SESSION_HINT_COOKIE_NAME, '', {
        httpOnly: false,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
        expires: new Date(0),
      });
    }
    return res;
  }

  const identity = verifyReviewerSessionToken(rawToken);
  if (!identity) {
    const res = NextResponse.json(
      { authenticated: false, user: null, token: null },
      { status: 200, headers }
    );
    res.cookies.set(REVIEWER_SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
      expires: new Date(0),
    });
    res.cookies.set(REVIEWER_SESSION_HINT_COOKIE_NAME, '', {
      httpOnly: false,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
      expires: new Date(0),
    });
    return res;
  }

  return NextResponse.json(
    {
      authenticated: true,
      user: {
        uid: identity.uid,
        email: identity.email,
        displayName: identity.displayName,
      },
      token: rawToken,
    },
    { status: 200, headers }
  );
}
