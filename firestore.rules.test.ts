import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.join(process.cwd(), 'firestore.rules');
const draftPath = path.join(process.cwd(), 'DRAFT_firestore.rules');
const activeRules = fs.existsSync(draftPath)
  ? fs.readFileSync(draftPath, 'utf8')
  : fs.readFileSync(rulesPath, 'utf8');

test('Dirty Dozen #1 & #2: Default-deny global catch-all and admin-only catalog writes', () => {
  assert.match(activeRules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  assert.match(activeRules, /match \/books\/\{bookId\}[\s\S]*allow create:[\s\S]*isAdmin\(\)/);
  assert.match(activeRules, /match \/ExamPackDocument\/\{examId\}[\s\S]*allow update:[\s\S]*isAdmin\(\)/);
});

test('Dirty Dozen #3: Draft and deleted catalog items are blocked for non-admin reads', () => {
  assert.match(activeRules, /existing\(\)\.isPublished == true && existing\(\)\.isDeleted == false/);
});

test('Dirty Dozen #4 & #5: User profiles and purchases enforce PII isolation and block blanket list queries', () => {
  assert.match(activeRules, /match \/users\/\{userId\}[\s\S]*allow get: if isValidId\(userId\) && \(isOwner\(userId\) \|\| isAdmin\(\)\);/);
  assert.match(activeRules, /match \/users\/\{userId\}[\s\S]*allow list: if isAdmin\(\);/);
  assert.match(activeRules, /match \/purchases\/\{purchaseId\}[\s\S]*allow list: if isValidId\(userId\) && \(isOwner\(userId\) \|\| isAdmin\(\)\) && existing\(\)\.uid == userId;/);
});

test('Dirty Dozen #6 & #7: User profile creation blocks shadow fields and forged analytics', () => {
  assert.match(activeRules, /function isValidUserProfile\(data, userId\)[\s\S]*data\.keys\(\)\.hasOnly\(/);
  assert.match(activeRules, /incoming\(\)\.testsAttempted == 0/);
  assert.match(activeRules, /incoming\(\)\.booksOwned == 0/);
  assert.match(activeRules, /incoming\(\)\.examsOwned == 0/);
});

test('Dirty Dozen #8 & #9: Cart, Purchases, and ReadingProgress enforce uid integrity and path hardening', () => {
  assert.match(activeRules, /function isValidId\(id\)[\s\S]*id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/);
  assert.match(activeRules, /function isValidPurchase\(data, userId\)[\s\S]*data\.uid == userId &&[\s\S]*data\.uid == request\.auth\.uid/);
  assert.match(activeRules, /function isValidReadingProgress\(data, userId\)[\s\S]*data\.uid == userId &&[\s\S]*data\.uid == request\.auth\.uid/);
});

test('Dirty Dozen #10: Cart and ReadingProgress enforce strict value bounds and affectedKeys allowlist', () => {
  assert.match(activeRules, /data\.quantity is int && data\.quantity >= 1 && data\.quantity <= 20/);
  assert.match(activeRules, /affectedKeys\(\)\.hasOnly\(\['quantity', 'updatedAt'\]\)/);
  assert.match(activeRules, /data\.zoomScale is number && data\.zoomScale >= 0\.5 && data\.zoomScale <= 4/);
  assert.match(activeRules, /data\.offsetRatio is number && data\.offsetRatio >= 0 && data\.offsetRatio <= 1/);
});

test('Dirty Dozen #11: Completed purchases enforce terminal state lock and server timestamp', () => {
  assert.match(activeRules, /data\.status == 'completed'/);
  assert.match(activeRules, /incoming\(\)\.purchasedAt == request\.time/);
  assert.match(activeRules, /existing\(\)\.status != 'completed'/);
});

test('Dirty Dozen #12: Admin checks mandate verified email', () => {
  assert.match(activeRules, /function isVerifiedUser\(\)[\s\S]*request\.auth\.token\.email_verified == true/);
  assert.match(activeRules, /function isAdmin\(\)[\s\S]*isVerifiedUser\(\)/);
});

test('Review Security #13-#16: Deterministic 1-per-user key, verifiedPurchase anti-spoof, parent check, and strict bounds', () => {
  assert.match(activeRules, /function isValidProductReview\(data, reviewId\)/);
  assert.match(activeRules, /data\.id == \(data\.contentType \+ '_' \+ data\.itemId \+ '_' \+ data\.uid\)/);
  assert.match(activeRules, /data\.rating is int && data\.rating >= 1 && data\.rating <= 5/);
  assert.match(activeRules, /data\.body is string && data\.body\.size\(\) >= 10 && data\.body\.size\(\) <= 2000/);
  assert.match(activeRules, /data\.title is string && data\.title\.size\(\) <= 120/);
  assert.match(activeRules, /data\.authorName is string && data\.authorName\.size\(\) >= 2 && data\.authorName\.size\(\) <= 80/);
  assert.match(activeRules, /isPublishedCatalogProduct\(incoming\(\)\.contentType, incoming\(\)\.itemId\)/);
  assert.match(activeRules, /incoming\(\)\.verifiedPurchase == false \|\| hasVerifiedProductPurchase\(/);
});

test('Review Security #17-#18: Atomic helpful votes block self-voting and require existsAfter/getAfter pairing', () => {
  assert.match(activeRules, /match \/helpfulVotes\/\{voterUid\}/);
  assert.match(activeRules, /request\.auth\.uid != existing\(\)\.uid/);
  assert.match(activeRules, /existsAfter\(\/databases\/\$\(database\)\/documents\/productReviews\/\$\(reviewId\)\/helpfulVotes\/\$\(request\.auth\.uid\)\)/);
  assert.match(activeRules, /getAfter\(\/databases\/\$\(database\)\/documents\/productReviews\/\$\(reviewId\)\)\.data\.helpfulCount/);
  assert.match(activeRules, /allow delete: if isVerifiedUser\(\) && isValidId\(reviewId\) && \(isOwner\(existing\(\)\.uid\) \|\| isAdmin\(\)\);/);
});
