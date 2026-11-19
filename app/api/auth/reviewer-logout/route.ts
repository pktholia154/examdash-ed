import { NextRequest, NextResponse } from 'next/server';
import {
  REVIEWER_SESSION_COOKIE_NAME,
  REVIEWER_SESSION_HINT_COOKIE_NAME,
} from '@/core/auth/reviewer-account';

export const runtime = 'nodejs';

function isSecureRequest(req: NextRequest): boolean {
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return proto === 'https' || req.nextUrl.protocol === 'https:';
}

export async function POST(req: NextRequest) {
  const secure = isSecureRequest(req);
  const response = NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    }
  );

  response.cookies.set(REVIEWER_SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });
  response.cookies.set(REVIEWER_SESSION_HINT_COOKIE_NAME, '', {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });

  return response;
}
