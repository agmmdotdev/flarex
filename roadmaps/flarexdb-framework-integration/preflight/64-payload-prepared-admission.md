# Payload Prepared Admission

Status: implemented for the private CMS profiles and connected composite command.

## Outcome And Boundary

Replace CMS's standalone active-read preparation with the existing shared
Application binding preparation and one complete acceptance under the business
transaction's scope clock and active-head locks. The measured scalar baseline
in [62](./62-payload-latency-baseline.md) makes repeated admission/readiness work
the first target. No cache, schema, migration, lock-strength, durability, public
Payload API or deployment change is approved.

The accepted database and Payload designs govern authority. Existing Commerce
preparation remains supported. The implementation belongs to Application
activation/readiness, binding projection/content verification, native relation
reads and CMS composition in persistence, not the Payload database adapter.

## Design And Cleanup

- Extend the existing opaque preparation with owner-checked planning metadata;
  it cannot be claimed as an executable active selection or readiness verdict.
- Accept once with the existing complete fold/replay validation and current
  active-head correlation. A callback-local opaque binding pins the exact
  transaction and clock. It is revoked on success, failure and interruption.
- Binding projection, content ownership and native join capabilities consume
  that acceptance. The native relation owner still verifies exact repository,
  definition identity and eligibility. An escaped or foreign-transaction
  capability fails closed. No second readiness fold is needed for each join
  window under the same protected admission.
- Retain standalone active selection and native relation-read APIs for their
  actual independent callers. Replace and delete the old CMS standalone-read
  preparation; do not add a scalar-only fast path or fallback. Existing scalar,
  single/many relationship and join profiles use the same admission flow.
- Keep request recovery re-preparation, preference installation locks, access
  identity, revocation, binding checks, rollback-only behavior, publication and
  outer settlement unchanged. The existing cross-domain CMS consumer follows
  the same preparation contract, borrowing Commerce's acceptance after installation
  locks. Borrowing requires the exact preparation, transaction and clock and
  cannot outlive the outer acceptance. Configuration snapshots use the existing
  write-policy capture owner and are recursively frozen before admission.

Preliminary readiness failures may now be observed at accepting admission rather
than a discarded earlier validation. No callback or mutation occurs before full
acceptance. Immutable planning inputs never substitute for current target checks.
Do not wrap whole requests in a metadata cache or weaken corruption validation.

## Completion Gates

Prove forged/prepared/expired capability refusal, wrong transaction/clock/scope,
active revision changes and readiness corruption between prepare and accept,
success and interruption cleanup, and PostgreSQL lock retention. Preserve native
Payload CRUD, unique errors, nested hooks, preferences, relation/population/join,
rollback and retained replay behavior. Run both PGlite and ordinary PostgreSQL,
connected Commerce/cross-domain regressions, typechecks, lint and both reviewers.

Rerun the same opt-in latency workload and compare SQL work and local p50/p95.
Report setup, sample counts, limitations and exact receipts through benchmark/Git
evidence; do not assert timing thresholds or claim production performance. Stop
owned runtimes. Completion includes one scoped commit and no displaced CMS path.
