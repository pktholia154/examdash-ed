import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, DM_Sans } from 'next/font/google';
import { AppSessionProvider } from '@/components/providers/AppSessionProvider';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildOrganizationGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';
import './globals.css';

// Variable Google fonts: 1 woff2 file each (2 total preloaded font requests site-wide)
const displayFont = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const bodyFont = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export function generateMetadata(): Metadata {
  const baseUrl = getCanonicalBaseUrl();
  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: 'ExamDash (ed) — Study Books & Online Exam Packs',
      template: '%s | ExamDash (ed)',
    },
    description:
      'Discover curated digital study books, MCQ question banks, and online competitive exam mock test series on ExamDash (ed).',
    applicationName: 'ExamDash (ed)',
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
        'max-video-preview': -1,
      },
    },
    openGraph: {
      type: 'website',
      siteName: 'ExamDash (ed)',
      title: 'ExamDash (ed) — Study Books & Online Exam Packs',
      description:
        'Discover curated digital study books, MCQ question banks, and online competitive exam mock test series on ExamDash (ed).',
      images: [
        {
          url: '/pwa-512x512.png',
          width: 512,
          height: 512,
          type: 'image/png',
          alt: 'ExamDash (ed)',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'ExamDash (ed) — Study Books & Online Exam Packs',
      description:
        'Discover curated digital study books, MCQ question banks, and online competitive exam mock test series on ExamDash (ed).',
      images: ['/pwa-512x512.png'],
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
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const orgGraph = buildOrganizationGraph(getCanonicalBaseUrl());

  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: escapeJsonLd(orgGraph) }}
        />
      </head>
      <body suppressHydrationWarning>
        <AppSessionProvider>{children}</AppSessionProvider>
      </body>
    </html>
  );
}
