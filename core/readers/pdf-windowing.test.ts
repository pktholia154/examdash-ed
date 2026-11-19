import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPdfZoom,
  computeActiveRenderWindow,
  computeAdaptiveDpr,
  computeEvictionPages,
  computePdfProgressPercent,
  computeScaledPageBox,
  prioritizeRenderQueue,
  shouldUseInstantJump,
} from './pdf-windowing';

test('computeAdaptiveDpr caps DPR safely for mobile and desktop', () => {
  assert.equal(computeAdaptiveDpr(3, true), 1.75);
  assert.equal(computeAdaptiveDpr(3, false), 2.0);
  assert.equal(computeAdaptiveDpr(1.5, true), 1.5);
  assert.equal(computeAdaptiveDpr(0, false), 1);
});

test('computeActiveRenderWindow bounds window to current ±2 mobile and ±3 desktop', () => {
  assert.deepEqual(computeActiveRenderWindow(10, 50, true), [8, 9, 10, 11, 12]);
  assert.deepEqual(computeActiveRenderWindow(10, 50, false), [7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(computeActiveRenderWindow(1, 3, false), [1, 2, 3]);
});

test('computeEvictionPages identifies canvases outside 1500px outer eviction zone', () => {
  const bounds = new Map<number, { top: number; bottom: number }>([
    [1, { top: 0, bottom: 900 }],
    [5, { top: 4000, bottom: 4900 }],
    [6, { top: 5000, bottom: 5900 }],
    [12, { top: 10000, bottom: 10900 }],
  ]);
  // Viewport sits around page 6 (5000..5900)
  const evict = computeEvictionPages([1, 5, 6, 12], bounds, 5000, 5900, 1500);
  assert.deepEqual(evict, [1, 12]);
});

test('prioritizeRenderQueue sorts pages closest to viewport center first', () => {
  assert.deepEqual(prioritizeRenderQueue([7, 13, 10, 11, 9], 10), [10, 9, 11, 7, 13]);
});

test('computeScaledPageBox preserves exact aspect ratio for zero CLS', () => {
  const box = computeScaledPageBox({ pageNumber: 1, rawWidth: 600, rawHeight: 900 }, 800, 1.5);
  assert.equal(box.width, 1200);
  assert.equal(box.height, 1800);
  assert.equal(box.aspectRatio, 1.5);
});

test('shouldUseInstantJump triggers for page jumps greater than 5', () => {
  assert.equal(shouldUseInstantJump(1, 4), false);
  assert.equal(shouldUseInstantJump(1, 6), false);
  assert.equal(shouldUseInstantJump(1, 7), true);
  assert.equal(shouldUseInstantJump(20, 12), true);
});

test('clampPdfZoom and computePdfProgressPercent bound values properly', () => {
  assert.equal(clampPdfZoom(5), 3);
  assert.equal(clampPdfZoom(0.2), 0.75);
  assert.equal(computePdfProgressPercent(0, 10, 0), 2);
  assert.equal(computePdfProgressPercent(9, 10, 1), 100);
});
