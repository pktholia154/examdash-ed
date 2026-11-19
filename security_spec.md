# ExamDash (ed) Firestore Security Specification

## 1. Data Invariants
1. **Public Catalog Read-Only Boundary**: Documents in `/books/{bookId}` and `/ExamPackDocument/{examId}` are readable by the public **only** when `isPublished == true && isDeleted == false`. Unpublished or soft-deleted records are readable exclusively by verified admins. All writes to catalog collections are restricted exclusively to verified admins.
2. **PII Isolation**: User profiles and analytics at `/users/{userId}` contain PII (`email`, `displayName`, `photoURL`) and are strictly restricted to the authenticated owner (`request.auth.uid == userId`) or a verified admin. Blanket reads are strictly denied.
3. **Cart Ownership & Master Gate**: Cart items at `/users/{userId}/cart/{cartItemId}` require the parent `/users/{userId}` document to exist, enforce `incoming().uid == userId == request.auth.uid`, enforce valid `contentType` (`books`, `exams`, `quizbooks`), bounded quantities (`1..20`), and non-negative pricing.
4. **Immutable Purchase Entitlements**: Purchase records at `/users/{userId}/purchases/{purchaseId}` require parent user document existence, verified email, `status == 'completed'`, valid `razorpayOrderId`, `razorpayPaymentId`, and server-signed `entitlementProof`. Once created (`status == 'completed'`), purchase records are terminal and cannot be modified or deleted by non-admin clients. Server-side full-content proxies independently verify `entitlementProof` with `RAZORPAY_KEY_SECRET` before streaming full books.
5. **Reading Progress Integrity**: Reading progress records at `/users/{userId}/readingProgress/{progressId}` require parent user document existence, enforce `uid == userId == request.auth.uid`, valid `format` (`pdf`|`markdown`), `mode` (`sample`|`full`), bounded ratios (`0..1`), bounded zoom (`0.5..4`), and server timestamps.
6. **Temporal Integrity & Path Hardening**: All document IDs are validated via `isValidId()` (`^[a-zA-Z0-9_\-]+$`, `<= 128` chars), all strings enforce explicit `.size()` bounds, and timestamps (`createdAt`, `updatedAt`, `addedAt`, `purchasedAt`) must equal `request.time`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Write to `books`**: Anonymous user attempts `create` on `/books/B999` -> `PERMISSION_DENIED`.
2. **Non-Admin Update to `ExamPackDocument`**: Standard signed-in user attempts to lower `buyPrice` to `0` on `/ExamPackDocument/E1` -> `PERMISSION_DENIED`.
3. **Draft / Deleted Catalog Leak**: Unauthenticated user attempts `get` on an unpublished (`isPublished: false`) or deleted (`isDeleted: true`) book -> `PERMISSION_DENIED`.
4. **PII Blanket Read**: User A attempts `get` on `/users/userB` -> `PERMISSION_DENIED`.
5. **Cross-User List Scraping**: User A attempts `list` on `/users` or `/users/userB/purchases` -> `PERMISSION_DENIED`.
6. **Self-Assigned Privilege Escalation (Shadow Field)**: User A creates `/users/userA` with extra ghost field `isAdmin: true` or `role: "admin"` -> `PERMISSION_DENIED`.
7. **Analytics Tampering on Profile Create**: User A creates `/users/userA` with `booksOwned: 999` instead of `0` -> `PERMISSION_DENIED`.
8. **Identity Spoofing in Cart & Purchases**: User A attempts to create `/users/userA/purchases/p1` with `uid: "userB"` -> `PERMISSION_DENIED`.
9. **Path ID Poisoning**: User A attempts to create `/users/userA/cart/invalid$id!with/junk` or 200-char ID -> `PERMISSION_DENIED`.
10. **Value Poisoning in Cart & Progress Updates**: User A updates cart `quantity: 99999` or progress `zoomScale: 999` -> `PERMISSION_DENIED`.
11. **Terminal State Violation on Purchases**: User A attempts to `update` or `delete` a completed purchase record at `/users/userA/purchases/p1` -> `PERMISSION_DENIED`.
12. **Unverified Email Admin Spoof**: Attacker signs in with admin email where `email_verified == false` and attempts catalog write -> `PERMISSION_DENIED`.
