import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import { PurchasedLibraryTemplate } from '@/components/templates/PurchasedLibraryTemplate';
import { fetchHomeCatalog } from '@/lib/firebase/server-catalog';

export const revalidate = 120;

export const metadata: Metadata = {
  title: 'Purchased Library',
  description:
    'Read your purchased full PDF books, full Markdown editions, and manage unlocked online exam mock tests on ExamDash (ed).',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function PurchasedPage() {
  const catalog = await fetchHomeCatalog();
  const compactBooks = catalog.books.map((b) => ({ ...b, fullDescription: '' }));
  const compactExams = catalog.exams.map((e) => ({ ...e, fullDescription: '' }));

  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-white text-sm text-slate-600">
          Loading Purchased Library...
        </div>
      }
    >
      <PurchasedLibraryTemplate books={compactBooks} exams={compactExams} />
    </Suspense>
  );
}
