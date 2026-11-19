import test from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_SAMPLE_EXAM_SET, normalizeExamSetsPayload } from './schema';
import {
  advanceToNextTimedSection,
  buildAttemptSummary,
  clearQuestionResponse,
  computeDriftFreeTimer,
  createInitialExamSession,
  evaluateFullExam,
  evaluateQuestion,
  flattenPurchasedExamSets,
  getPaletteCounts,
  isQuestionAttempted,
  markForReviewAndNext,
  saveAndNextQuestion,
  startExamSession,
  submitExamSession,
  updateResponse,
  visitQuestion,
} from './engine';
import type { PublicExamPackDTO, PurchasedItem } from '@/lib/design-system/types';

test('isQuestionAttempted validates NAT, MCQ, and MSQ edge cases', () => {
  assert.equal(isQuestionAttempted({ type: 'NAT' }, ''), false);
  assert.equal(isQuestionAttempted({ type: 'NAT' }, '-'), false);
  assert.equal(isQuestionAttempted({ type: 'NAT' }, '.'), false);
  assert.equal(isQuestionAttempted({ type: 'NAT' }, '-.'), false);
  assert.equal(isQuestionAttempted({ type: 'NAT' }, '129.9'), true);
  assert.equal(isQuestionAttempted({ type: 'NAT' }, 0), true);

  assert.equal(isQuestionAttempted({ type: 'MCQ' }, null), false);
  assert.equal(isQuestionAttempted({ type: 'MCQ' }, 'C'), true);

  assert.equal(isQuestionAttempted({ type: 'MSQ' }, []), false);
  assert.equal(isQuestionAttempted({ type: 'MSQ' }, ['A']), true);
});

test('evaluateQuestion grades NAT, MCQ, and partial-credit MSQ accurately', () => {
  // NAT exact & tolerance
  const q1 = CANONICAL_SAMPLE_EXAM_SET.sections[0].questions[0];
  assert.deepEqual(evaluateQuestion(q1, '129.9'), { status: 'CORRECT', marksAwarded: 3 });
  assert.deepEqual(evaluateQuestion(q1, '130.0'), { status: 'WRONG', marksAwarded: 0 });

  // 5-option MCQ with negative marking
  const q2 = CANONICAL_SAMPLE_EXAM_SET.sections[0].questions[1];
  assert.deepEqual(evaluateQuestion(q2, 'C'), { status: 'CORRECT', marksAwarded: 2 });
  assert.deepEqual(evaluateQuestion(q2, 'A'), { status: 'WRONG', marksAwarded: -0.5 });

  // Override negative marking simulator
  assert.deepEqual(evaluateQuestion(q2, 'A', { mode: 'override', wrongPenaltyAbs: 0 }), {
    status: 'WRONG',
    marksAwarded: 0,
  });
  assert.deepEqual(evaluateQuestion(q2, 'A', { mode: 'override', wrongPenaltyAbs: 1 }), {
    status: 'WRONG',
    marksAwarded: -1,
  });

  // MSQ partial credit & wrong option penalty
  const q4 = CANONICAL_SAMPLE_EXAM_SET.sections[0].questions[3];
  assert.deepEqual(evaluateQuestion(q4, ['A', 'C']), { status: 'CORRECT', marksAwarded: 4 });
  assert.deepEqual(evaluateQuestion(q4, ['A']), { status: 'PARTIAL', marksAwarded: 1 });
  assert.deepEqual(evaluateQuestion(q4, ['A', 'B']), { status: 'WRONG', marksAwarded: -2 });
});

test('evaluateFullExam enforces section maxAttempts cap cleanly', () => {
  const cappedSet = normalizeExamSetsPayload([
    {
      ...CANONICAL_SAMPLE_EXAM_SET,
      sections: [
        {
          ...CANONICAL_SAMPLE_EXAM_SET.sections[0],
          maxAttempts: 2,
        },
      ],
    },
  ])[0];

  const report = evaluateFullExam(cappedSet, {
    sec_1_q_1: '129.9',
    sec_1_q_2: 'C',
    sec_1_q_3: 'A', // exceeds maxAttempts=2 -> ignoredByCap
    sec_1_q_4: ['A', 'C'], // exceeds maxAttempts=2 -> ignoredByCap
  });

  assert.equal(report.totalScore, 5); // 3 + 2 only
  assert.equal(report.attemptedCount, 2);
  assert.equal(report.questionResults.sec_1_q_3.ignoredByCap, true);
  assert.equal(report.questionResults.sec_1_q_4.ignoredByCap, true);
});

test('CBT state machine tracks all 5 palette statuses, revisits, and per-question time', () => {
  const t0 = 1_700_000_000_000;
  let session = createInitialExamSession({
    userId: 'guest',
    examPackId: 'E1',
    examPackSlug: 'online-exam-ibps-e1',
    exam: CANONICAL_SAMPLE_EXAM_SET,
    mode: 'sample',
    nowMs: t0,
  });

  // Start exam at t0 + 1s
  session = startExamSession(session, CANONICAL_SAMPLE_EXAM_SET, t0 + 1_000);
  let counts = getPaletteCounts(session, CANONICAL_SAMPLE_EXAM_SET);
  assert.equal(counts.notAnswered, 1);
  assert.equal(counts.notVisited, 3);

  // Answer Q1 after 15s and Save & Next -> Q1 answered, Q2 not_answered
  session = updateResponse(session, CANONICAL_SAMPLE_EXAM_SET, 'sec_1_q_1', '129.9', t0 + 16_000);
  session = saveAndNextQuestion(session, CANONICAL_SAMPLE_EXAM_SET, t0 + 16_000);
  assert.equal(session.activeQuestionIndex, 1);
  assert.equal(session.telemetry.sec_1_q_1.status, 'answered');
  assert.equal(session.telemetry.sec_1_q_1.timeSpentMs, 15_000);

  // Answer Q2 and Mark for Review & Next -> Q2 answered_marked, Q3 not_answered
  session = updateResponse(session, CANONICAL_SAMPLE_EXAM_SET, 'sec_1_q_2', 'C', t0 + 26_000);
  session = markForReviewAndNext(session, CANONICAL_SAMPLE_EXAM_SET, t0 + 26_000);
  assert.equal(session.activeQuestionIndex, 2);
  assert.equal(session.telemetry.sec_1_q_2.status, 'answered_marked');
  assert.equal(session.telemetry.sec_1_q_2.timeSpentMs, 10_000);

  // Mark Q3 without answering -> Q3 marked, Q4 not_answered
  session = markForReviewAndNext(session, CANONICAL_SAMPLE_EXAM_SET, t0 + 31_000);
  assert.equal(session.activeQuestionIndex, 3);
  assert.equal(session.telemetry.sec_1_q_3.status, 'marked');

  // Revisit Q1 -> revisitCount becomes 1
  session = visitQuestion(session, CANONICAL_SAMPLE_EXAM_SET, 0, 0, t0 + 36_000);
  assert.equal(session.telemetry.sec_1_q_1.revisitCount, 1);

  counts = getPaletteCounts(session, CANONICAL_SAMPLE_EXAM_SET);
  assert.equal(counts.answered, 1);
  assert.equal(counts.answeredMarked, 1);
  assert.equal(counts.marked, 1);
  assert.equal(counts.notAnswered, 1);
  assert.equal(counts.notVisited, 0);

  // Clear Q1 -> reverts to not_answered
  session = clearQuestionResponse(session, CANONICAL_SAMPLE_EXAM_SET, 'sec_1_q_1', t0 + 40_000);
  assert.equal(session.telemetry.sec_1_q_1.status, 'not_answered');
  assert.equal(session.responses.sec_1_q_1, undefined);
});

test('Drift-free countdown timer survives simulated refresh/sleep without losing exact seconds', () => {
  const t0 = 1_700_000_000_000;
  let session = createInitialExamSession({
    userId: 'u1',
    examPackId: 'E1',
    examPackSlug: 'online-exam-ibps-e1',
    exam: CANONICAL_SAMPLE_EXAM_SET, // 60 minutes = 3,600,000 ms
    mode: 'full',
    nowMs: t0,
    startImmediately: true,
  });

  // Simulate browser crash/reload 12 minutes 30 seconds later (750,000 ms)
  const afterCrash = t0 + 750_000;
  const timer = computeDriftFreeTimer(session, CANONICAL_SAMPLE_EXAM_SET, afterCrash);
  assert.equal(timer.totalElapsedMs, 750_000);
  assert.equal(timer.totalRemainingMs, 3_600_000 - 750_000);
  assert.equal(timer.isExamExpired, false);

  // Simulate expiry at 61 minutes
  const expiredTimer = computeDriftFreeTimer(session, CANONICAL_SAMPLE_EXAM_SET, t0 + 3_660_000);
  assert.equal(expiredTimer.totalRemainingMs, 0);
  assert.equal(expiredTimer.isExamExpired, true);

  // Submitting freezes timer at submission timestamp
  session = submitExamSession(session, CANONICAL_SAMPLE_EXAM_SET, afterCrash);
  const frozen = computeDriftFreeTimer(session, CANONICAL_SAMPLE_EXAM_SET, afterCrash + 999_000);
  assert.equal(frozen.totalElapsedMs, 750_000);
});

test('Multi-section sectionalTiming locks free jump and advances cleanly', () => {
  const multiSecExam = normalizeExamSetsPayload([
    {
      ...CANONICAL_SAMPLE_EXAM_SET,
      sectionalTiming: true,
      duration: 40,
      sections: [
        { ...CANONICAL_SAMPLE_EXAM_SET.sections[0], id: 's1', title: 'Sec 1', duration: 20 },
        {
          id: 's2',
          title: 'Sec 2',
          duration: 20,
          contexts: [],
          questions: [
            {
              ...CANONICAL_SAMPLE_EXAM_SET.sections[0].questions[1],
              id: 's2_q1',
              contextId: null,
            },
          ],
        },
      ],
    },
  ])[0];

  const t0 = 1_700_000_000_000;
  let session = createInitialExamSession({
    userId: 'u1',
    examPackId: 'E1',
    examPackSlug: 'e1',
    exam: multiSecExam,
    mode: 'full',
    nowMs: t0,
    startImmediately: true,
  });

  // Attempting to jump directly to Section 2 is blocked while sectionalTiming=true
  const blocked = visitQuestion(session, multiSecExam, 1, 0, t0 + 5_000);
  assert.equal(blocked.activeSectionIndex, 0);

  // Explicitly advancing timed section unlocks Section 2
  session = advanceToNextTimedSection(session, multiSecExam, t0 + 5_000);
  assert.equal(session.activeSectionIndex, 1);
  assert.deepEqual(session.completedSectionIds, ['s1']);
});

test('flattenPurchasedExamSets flattens multi-set full JSON separately per exam set', () => {
  const purchases: PurchasedItem[] = [
    {
      id: 'exams_E1',
      itemId: 'E1',
      contentType: 'exams',
      title: 'Online exam IBPS',
      urlSlug: 'online-exam-ibps-e1',
      currency: 'INR',
      amountPaid: 199,
      razorpayOrderId: 'order_123',
      razorpayPaymentId: 'pay_123',
      entitlementProof: 'proof_1234567890abcdef',
      status: 'completed',
      purchasedAt: '2026-11-18T10:00:00.000Z',
    },
  ];

  const catalogExam: PublicExamPackDTO = {
    id: 'E1',
    contentType: 'exams',
    title: 'Online exam IBPS',
    urlSlug: 'online-exam-ibps-e1',
    seoDescription: '',
    fullDescription: '',
    type: 'Exam Pack',
    language: 'English',
    publisher: 'ExamDash',
    authorName: 'Team',
    tags: [],
    currency: 'INR',
    listPrice: 399,
    buyPrice: 199,
    totalMocktest: 2,
    mocktestTitles: [
      { id: 'exam_set_1', title: 'Mock Set 01', duration: 60, totalQuestions: 4, totalMarks: 12 },
      { id: 'exam_set_2', title: 'Mock Set 02', duration: 60, totalQuestions: 4, totalMarks: 12 },
    ],
    sampleJsonStoragePath: 'public/exam_samples/E1_sample.json',
    createdAt: null,
    updatedAt: null,
    publishAt: null,
  };

  const set2 = { ...CANONICAL_SAMPLE_EXAM_SET, id: 'exam_set_2', title: 'Mock Set 02 Full' };
  const s1 = submitExamSession(
    updateResponse(
      createInitialExamSession({
        userId: 'u1',
        examPackId: 'E1',
        examPackSlug: 'online-exam-ibps-e1',
        exam: CANONICAL_SAMPLE_EXAM_SET,
        mode: 'full',
        nowMs: 1000,
        startImmediately: true,
      }),
      CANONICAL_SAMPLE_EXAM_SET,
      'sec_1_q_1',
      '129.9',
      2000
    ),
    CANONICAL_SAMPLE_EXAM_SET,
    3000
  );
  const summary1 = buildAttemptSummary(s1, CANONICAL_SAMPLE_EXAM_SET, 3000);

  const flat = flattenPurchasedExamSets(
    purchases,
    new Map([['E1', catalogExam]]),
    { E1: [CANONICAL_SAMPLE_EXAM_SET, set2] },
    { 'E1::exam_set_1': summary1 }
  );

  assert.equal(flat.length, 2);
  assert.equal(flat[0].examSetId, 'exam_set_1');
  assert.equal(flat[0].setNumber, 1);
  assert.equal(flat[0].attemptSummary?.score, 3);
  assert.equal(flat[1].examSetId, 'exam_set_2');
  assert.equal(flat[1].setTitle, 'Mock Set 02 Full');
  assert.equal(flat[1].attemptSummary, null);
});
