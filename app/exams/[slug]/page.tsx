import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DetailPageTemplate } from '@/components/templates/DetailPageTemplate';
import { fetchExamBySlug } from '@/lib/firebase/server-catalog';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildExamDetailGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';

export const revalidate = 120;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const exam = await fetchExamBySlug(slug);
  if (!exam) {
    return {
      title: 'Exam Pack Not Found',
      robots: { index: false, follow: false },
    };
  }

  return {
    title: exam.title,
    description: exam.seoDescription || exam.fullDescription || exam.title,
    alternates: { canonical: `/exams/${exam.urlSlug}` },
    openGraph: {
      type: 'website',
      title: exam.title,
      description: exam.seoDescription || exam.fullDescription || exam.title,
      url: `/exams/${exam.urlSlug}`,
    },
  };
}

export default async function ExamDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const exam = await fetchExamBySlug(slug);
  if (!exam) {
    notFound();
  }

  const graph = buildExamDetailGraph(getCanonicalBaseUrl(), exam);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: escapeJsonLd(graph) }}
      />
      <DetailPageTemplate item={exam} />
    </>
  );
}
