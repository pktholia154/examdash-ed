import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import 'katex/dist/katex.min.css';
import { fetchExamBySlug } from '@/lib/firebase/server-catalog';
import { ExamAttemptPageClient } from '@/components/exam/ExamAttemptPageClient';

export const revalidate = 120;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const exam = await fetchExamBySlug(slug);
  if (!exam) {
    return {
      title: 'Exam Not Found',
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `Attempt ${exam.title}`,
    description: `Computer-Based Test (CBT) interface for ${exam.title}.`,
    robots: { index: false, follow: false },
  };
}

export default async function ExamAttemptPage({ params }: PageProps) {
  const { slug } = await params;
  const exam = await fetchExamBySlug(slug);
  if (!exam) {
    notFound();
  }

  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[var(--surface-canvas)] text-sm text-[var(--text-secondary)]">
          Loading Examination Workspace...
        </div>
      }
    >
      <ExamAttemptPageClient examPack={exam} />
    </Suspense>
  );
}
