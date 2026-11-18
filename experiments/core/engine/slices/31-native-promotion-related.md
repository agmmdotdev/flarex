# Selected native Promotion related predicates through Core

Status **Implemented. PGlite and ordinary-role PostgreSQL verification passed.**

Flarex baseline `fb25d77beb1daba0cd9e371157c2da7f33730904`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`. Executing Medusa fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Independent challenge

- Current Core can evaluate a closed relational predicate over captured rows.
  The Legacy related caller resolves a source group and named foreign key,
  captures complete ordered Rule and Value cohorts and records three ordered
  observations. Promotion is the only runtime caller of that port.
- Pinned Convex supplies ordinary index range compilation, pending write and
  tombstone overlay, hydration and exact consumed-range dependencies including
  exhaustion and misses. The relevant owners are `crates/common/src/query.rs`,
  `crates/database/src/transaction_index.rs` and
  `crates/database/src/query/index_range.rs`.
- The accepted-direction challenge identified two unsafe shortcuts. The
  existing scalar executor slices its returned page even when it observes the
  complete set. Invoking public native operations inside one guarded operation
  reacquires its semaphore. Reuse complete selection internally and issue the
  batch against the authentic live child table token.

The peer exchange selected the existing scope-exclusive owner for the first
admission. Capture both cohorts through the same guarded operation and reuse
the existing related predicate evaluator. The
[native related predicate divergence](../divergences/native-related-predicates.md)
owns the SQL semantics, exact three observations and independent limits.

The authenticated Promotion source includes ApplicationMethod's nonunique
currency index with an off-key non-null deletion predicate. Admission reuses
the [ordinary index lowering](../divergences/native-compound-non-null-indexes.md)
for a single equality key followed by the non-null suffix.

## Connected acceptance

- Prove authentic same-source FK admission, complete pending and historical
  cohorts, empty dependencies, joined-row predicates and anti-membership.
  Verify selected-scope refusal, exact combined row and comparison bounds
  before evaluation, and caught cast failure leaving rollback-only state.
- Issue the full authenticated Promotion source and move both prefilter and
  all five compute cases onto Core. Preserve candidate order, three actual
  observations, typed receipt tamper refusal, resource selection and rollback.
- Keep the five full Cart creation cases on their existing assembly while the
  six remaining sources are admitted. Those sources are Customer, Region,
  Payment, full Fulfillment, Cart Promotion Link and Cart PaymentCollection Link.
- Run PGlite and ordinary-role PostgreSQL, affected typechecks, source and
  portability guards, lint and both independent reviews.
