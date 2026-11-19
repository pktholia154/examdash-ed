import { z } from 'zod';

export const QuestionMarksSchema = z.object({
  correct: z.number().finite().default(1),
  wrong: z.number().finite().default(0),
  partial: z.number().finite().optional().default(0),
});

export const ChartSeriesItemSchema = z.object({
  key: z.string().min(1),
  label: z.string().optional(),
  type: z.enum(['bar', 'line', 'scatter']).optional(),
  yAxis: z.enum(['left', 'right']).optional(),
});

export const ExamVisualSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['chart', 'table', 'svg', 'mermaid', 'smiles', 'image']),
  chartType: z
    .enum(['pie', 'combo', 'bar', 'stacked_bar', 'line', 'scatter', 'radar'])
    .optional(),
  title: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  xAxisKey: z.string().optional(),
  series: z.array(ChartSeriesItemSchema).optional(),
  data: z.unknown().optional(),
  headers: z.array(z.unknown()).optional(),
  rows: z.array(z.array(z.unknown())).optional(),
  url: z.string().optional(),
  alt: z.string().optional(),
});

export const ExamOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().nullable().optional(),
  visual: ExamVisualSchema.nullable().optional(),
});

export const ExamQuestionSchema = z.object({
  id: z.string().min(1),
  contextId: z.string().nullable().optional(),
  type: z.enum(['MCQ', 'MSQ', 'NAT']),
  marks: QuestionMarksSchema.default({ correct: 1, wrong: 0, partial: 0 }),
  prompt: z.string().default(''),
  visuals: z.array(ExamVisualSchema).nullable().optional().default([]),
  options: z.array(ExamOptionSchema).nullable().optional().default([]),
  answer: z.union([
    z.string(),
    z.array(z.string()),
    z.tuple([z.number(), z.number()]),
    z.array(z.number()),
  ]),
  explanation: z.string().nullable().optional().default(''),
  explanationVisuals: z.array(ExamVisualSchema).nullable().optional().default([]),
});

export const ExamContextSchema = z.object({
  id: z.string().min(1),
  text: z.string().nullable().optional().default(''),
  visuals: z.array(ExamVisualSchema).nullable().optional().default([]),
});

export const ExamSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  duration: z.number().nonnegative().optional().default(0),
  totalQuestions: z.number().nonnegative().optional(),
  maxAttempts: z.number().positive().nullable().optional().default(null),
  contexts: z.array(ExamContextSchema).nullable().optional().default([]),
  questions: z.array(ExamQuestionSchema).default([]),
});

export const ExamSetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  duration: z.number().positive().default(60),
  totalQuestions: z.number().nonnegative().optional(),
  totalMarks: z.number().nonnegative().optional(),
  sectionalTiming: z.boolean().optional().default(false),
  calculator: z.enum(['scientific', 'basic']).nullable().optional().default(null),
  sections: z.array(ExamSectionSchema).min(1),
});

export type QuestionMarks = z.infer<typeof QuestionMarksSchema>;
export type ExamVisual = z.infer<typeof ExamVisualSchema>;
export type ExamOption = z.infer<typeof ExamOptionSchema>;
export type ExamQuestion = z.infer<typeof ExamQuestionSchema>;
export type ExamContext = z.infer<typeof ExamContextSchema>;
export type ExamSection = z.infer<typeof ExamSectionSchema>;
export type ExamSet = z.infer<typeof ExamSetSchema>;

export interface NormalizedExamSet extends ExamSet {
  totalQuestions: number;
  totalMarks: number;
  sections: Array<
    ExamSection & {
      totalQuestions: number;
      contexts: ExamContext[];
      questions: ExamQuestion[];
    }
  >;
}

/**
 * Normalizes a single ExamSet or an array of ExamSets stored in the universal
 * Pillar 2 JSON schema without mutating or breaking existing Firebase JSON files.
 */
export function normalizeExamSetsPayload(raw: unknown): NormalizedExamSet[] {
  const rawList: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Array.isArray((raw as { examSets?: unknown[] }).examSets)
        ? (raw as { examSets: unknown[] }).examSets
        : Array.isArray((raw as { sets?: unknown[] }).sets)
          ? (raw as { sets: unknown[] }).sets
          : [raw]
      : [];

  const normalized: NormalizedExamSet[] = [];

  for (const entry of rawList) {
    const parsed = ExamSetSchema.safeParse(entry);
    if (!parsed.success) {
      continue;
    }

    const set = parsed.data;
    const sections = set.sections.map((sec) => {
      const questions = sec.questions ?? [];
      const contexts = sec.contexts ?? [];
      return {
        ...sec,
        contexts,
        questions,
        totalQuestions:
          typeof sec.totalQuestions === 'number' && sec.totalQuestions > 0
            ? sec.totalQuestions
            : questions.length,
      };
    });

    const computedTotalQuestions = sections.reduce((sum, s) => sum + s.questions.length, 0);
    const computedTotalMarks = Number(
      sections
        .reduce(
          (secSum, s) =>
            secSum +
            s.questions.reduce((qSum, q) => qSum + Math.max(0, Number(q.marks?.correct ?? 1)), 0),
          0
        )
        .toFixed(2)
    );

    normalized.push({
      ...set,
      sections,
      totalQuestions:
        typeof set.totalQuestions === 'number' && set.totalQuestions > 0
          ? set.totalQuestions
          : computedTotalQuestions,
      totalMarks:
        typeof set.totalMarks === 'number' && set.totalMarks > 0
          ? set.totalMarks
          : computedTotalMarks,
    });
  }

  return normalized;
}

/**
 * Canonical Pillar 2 multi-pattern sample set (NAT, 5-option MCQ, 4-option MCQ with
 * SVG + Mermaid, partial-credit MSQ with table, and 3 interconnected context visuals).
 * Used only as a resilient fallback for unauthenticated public sample previews if
 * Firebase Storage rules restrict anonymous reads on sampleJsonStoragePath.
 */
export const CANONICAL_SAMPLE_EXAM_SET: NormalizedExamSet = normalizeExamSetsPayload([
  {
    id: 'exam_set_1',
    title: 'Mock Set 01: Comprehensive Multi-Pattern Assessment',
    duration: 60,
    totalQuestions: 4,
    totalMarks: 12,
    sectionalTiming: true,
    calculator: 'scientific',
    sections: [
      {
        id: 'sec_1',
        title: 'Data Interpretation & Analytical Reasoning',
        duration: 60,
        totalQuestions: 4,
        maxAttempts: null,
        contexts: [
          {
            id: 'sec_1_ctx_1',
            text: '**Directions (Q1 – Q2):** Study the following **three interconnected visuals** (Chart 1, Chart 2, and Table 1) carefully to answer the questions that follow.',
            visuals: [
              {
                id: 'v1',
                type: 'chart',
                chartType: 'pie',
                title: 'Chart 1: Percentage Breakup of Total Cloud Server Traffic (Total = 8,000 TB)',
                note: '**Note:** Traffic in Region X consists of only Web and API requests.',
                xAxisKey: 'region',
                series: [{ key: 'share', label: 'Traffic Share (%)' }],
                data: [
                  { region: 'Region X', share: 35 },
                  { region: 'Region Y', share: 45 },
                  { region: 'Region Z', share: 20 },
                ],
              },
              {
                id: 'v2',
                type: 'chart',
                chartType: 'combo',
                title: 'Chart 2: Cost per TB (₹ Thousand) & Outage Duration (Hours)',
                note: '**Formula:** $\\text{Total SLA Penalty} = \\text{Outage Hours} \\times ₹15,000$.',
                xAxisKey: 'region',
                series: [
                  { key: 'cost', label: "Cost/TB (₹ '000)", type: 'bar', yAxis: 'left' },
                  { key: 'outage', label: 'Outage (Hrs)', type: 'line', yAxis: 'right' },
                ],
                data: [
                  { region: 'Region X', cost: 12, outage: 4 },
                  { region: 'Region Y', cost: 10, outage: 6 },
                  { region: 'Region Z', cost: 15, outage: 2 },
                ],
              },
              {
                id: 'v3',
                type: 'table',
                title: 'Table 1: Web vs API Traffic Ratio & Discount Rate',
                note: 'Discount is applied on gross traffic cost before adding SLA penalty.',
                headers: ['Region', 'Web : API Traffic', 'Discount on Gross Cost'],
                rows: [
                  ['Region X', '$4 : 3$', '$10\\%$'],
                  ['Region Y', '$5 : 4$', '$20\\%$'],
                  ['Region Z', '$3 : 2$', '$15\\%$'],
                ],
              },
            ],
          },
        ],
        questions: [
          {
            id: 'sec_1_q_1',
            contextId: 'sec_1_ctx_1',
            type: 'NAT',
            marks: { correct: 3, wrong: 0, partial: 0 },
            prompt:
              "Find the net amount payable (in ₹ Lakh) for **API Traffic** in **Region X** after applying the discount and adding $50\\%$ of Region X's total SLA penalty.",
            visuals: [],
            options: [],
            answer: [129.9, 129.9],
            explanation:
              '1. **Total Traffic in Region X:** $35\\% \\text{ of } 8000 = 2800\\text{ TB}$.\n2. **API Traffic in Region X:** $\\frac{3}{4+3} \\times 2800 = 1200\\text{ TB}$.\n3. **Gross Cost:** $1200 \\times ₹12,000 = ₹144\\text{ Lakh}$.\n4. **After 10% Discount:** $144 \\times 0.90 = ₹129.6\\text{ Lakh}$.\n5. **50% of SLA Penalty:** $0.5 \\times (4 \\times ₹15,000) = ₹0.3\\text{ Lakh}$.\n6. **Net Amount Payable:** $129.6 + 0.3 = ₹129.9\\text{ Lakh}$.',
            explanationVisuals: [],
          },
          {
            id: 'sec_1_q_2',
            contextId: 'sec_1_ctx_1',
            type: 'MCQ',
            marks: { correct: 2, wrong: -0.5, partial: 0 },
            prompt:
              'In **Region Y**, what is the difference (in TB) between **Web Traffic** and **API Traffic**?',
            visuals: [],
            options: [
              { id: 'A', text: '$300\\text{ TB}$', visual: null },
              { id: 'B', text: '$350\\text{ TB}$', visual: null },
              { id: 'C', text: '$400\\text{ TB}$', visual: null },
              { id: 'D', text: '$450\\text{ TB}$', visual: null },
              { id: 'E', text: 'None of these', visual: null },
            ],
            answer: 'C',
            explanation:
              'Total Traffic in Region Y $= 45\\% \\text{ of } 8000 = 3600\\text{ TB}$.\nRatio of Web to API $= 5 : 4$.\nDifference $= \\frac{5 - 4}{5 + 4} \\times 3600 = \\frac{1}{9} \\times 3600 = 400\\text{ TB}$.',
            explanationVisuals: [],
          },
          {
            id: 'sec_1_q_3',
            contextId: null,
            type: 'MCQ',
            marks: { correct: 3, wrong: -1, partial: 0 },
            prompt:
              'A logic circuit (Figure 1) and its state transition flow (Figure 2) are shown below. Identify the output $Y$ and next state when $A=1, B=0$ starting from $S_0$.',
            visuals: [
              {
                id: 'v1',
                type: 'svg',
                title: 'Figure 1: Combinational Front-End',
                note: 'All logic gates are ideal.',
                data: "<svg viewBox='0 0 320 120' xmlns='http://www.w3.org/2000/svg'><line x1='20' y1='40' x2='90' y2='40' stroke='#0f172a' stroke-width='2'/><text x='10' y='44' font-size='12'>A</text><line x1='20' y1='80' x2='90' y2='80' stroke='#0f172a' stroke-width='2'/><text x='10' y='84' font-size='12'>B</text><path d='M90,25 L130,25 A35,35 0 0,1 130,95 L90,95 Z' fill='#e0f2fe' stroke='#0284c7' stroke-width='2'/><text x='110' y='65' font-size='12'>AND</text><line x1='165' y1='60' x2='240' y2='60' stroke='#0f172a' stroke-width='2'/><text x='246' y='64' font-size='12'>Y = A.B</text></svg>",
              },
              {
                id: 'v2',
                type: 'mermaid',
                title: 'Figure 2: Downstream Controller State',
                note: 'Transition occurs on rising clock edge.',
                data: 'stateDiagram-v2\n direction LR\n S0 --> S1 : Y = 1\n S0 --> S0 : Y = 0',
              },
            ],
            options: [
              { id: 'A', text: '$Y = 0$, Controller stays in $S_0$', visual: null },
              { id: 'B', text: '$Y = 1$, Controller moves to $S_1$', visual: null },
              { id: 'C', text: '$Y = 1$, Controller stays in $S_0$', visual: null },
              { id: 'D', text: '$Y = 0$, Controller moves to $S_1$', visual: null },
            ],
            answer: 'A',
            explanation:
              'Since $A=1$ and $B=0$, the output is $Y = A \\cdot B = 1 \\cdot 0 = 0$. From Figure 2, when $Y=0$, the controller stays in $S_0$.',
            explanationVisuals: [],
          },
          {
            id: 'sec_1_q_4',
            contextId: null,
            type: 'MSQ',
            marks: { correct: 4, wrong: -2, partial: 1 },
            prompt:
              'Match the asymptotic growth claims in the table below and select **all** options that are mathematically true.',
            visuals: [
              {
                id: 'v1',
                type: 'table',
                title: 'Function Growth Claims',
                note: null,
                headers: ['Item', 'Function', 'Claimed Bound'],
                rows: [
                  ['P', '$f(n) = 3n^2 + 5n$', '$O(n^2)$'],
                  ['Q', '$f(n) = 2^{n+1}$', '$O(2^n)$'],
                  ['R', '$f(n) = n!$', '$O(2^n)$'],
                ],
              },
            ],
            options: [
              { id: 'A', text: 'Item P is true for all $n \\ge 1$.', visual: null },
              { id: 'B', text: 'Item Q is false because $2^{n+1}$ grows faster than $2^n$.', visual: null },
              { id: 'C', text: 'Item Q is true with constant $c = 2$.', visual: null },
              { id: 'D', text: 'Item R is true for all $n \\ge 4$.', visual: null },
            ],
            answer: ['A', 'C'],
            explanation:
              'Item P holds since $3n^2 + 5n \\le 8n^2$ ($n \\ge 1$). Item Q holds since $2^{n+1} = 2 \\cdot 2^n$. Item R is false since $n!$ grows faster than $2^n$. Thus A and C are correct.',
            explanationVisuals: [],
          },
        ],
      },
    ],
  },
])[0];
