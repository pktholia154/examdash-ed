import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, DM_Sans, IBM_Plex_Mono } from 'next/font/google';
import { AppSessionProvider } from '@/components/providers/AppSessionProvider';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildOrganizationGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';
import 'katex/dist/katex.min.css';
import './globals.css';

const displayFont = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});

const bodyFont = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

const monoFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

const BASE_URL = getCanonicalBaseUrl();

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'ExamDash (ed) — Study Books & Online Exam Packs',
    template: '%s | ExamDash (ed)',
  },
  description:
    'Discover curated digital study books, MCQ question banks, and online competitive exam mock test series on ExamDash (ed).',
  applicationName: 'ExamDash (ed)',
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: 'website',
    siteName: 'ExamDash (ed)',
    title: 'ExamDash (ed) — Study Books & Online Exam Packs',
    description:
      'Discover curated digital study books, MCQ question banks, and online competitive exam mock test series on ExamDash (ed).',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ExamDash (ed) — Study Books & Online Exam Packs',
    description:
      'Discover curated digital study books, MCQ question banks, and online competitive exam mock test series on ExamDash (ed).',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ExamDash',
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

const SPECULATION_RULES = {
  prefetch: [
    {
      where: {
        and: [
          { href_matches: '/*' },
          { not: { href_matches: '/api/*' } },
          { not: { href_matches: '/account/*' } },
          { not: { href_matches: '/checkout/*' } },
          { not: { href_matches: '/admin/*' } },
          { not: { selector_matches: '[rel~=nofollow]' } },
        ],
      },
      eagerness: 'moderate',
    },
  ],
  prerender: [
    {
      where: {
        and: [
          { href_matches: '/books/*' },
          { not: { selector_matches: '[rel~=nofollow]' } },
        ],
      },
      eagerness: 'conservative',
    },
    {
      where: {
        and: [
          { href_matches: '/exams/*' },
          { not: { selector_matches: '[rel~=nofollow]' } },
        ],
      },
      eagerness: 'conservative',
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const orgGraph = buildOrganizationGraph(BASE_URL);

  return (
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: escapeJsonLd(orgGraph) }}
        />
        <script
          type="speculationrules"
          dangerouslySetInnerHTML={{ __html: escapeJsonLd(SPECULATION_RULES) }}
        />
      </head>
      <body suppressHydrationWarning>
        <AppSessionProvider>{children}</AppSessionProvider>
      </body>
    </html>
  );
}
