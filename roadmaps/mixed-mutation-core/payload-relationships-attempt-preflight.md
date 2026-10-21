# Payload Optional-One Relationships In Mixed Mutations

Status: implemented privately for fresh configured Payload
collections. Public APIs and cross-framework relationships remain pending.

## Connected Outcome

Compose `articles.author -> authors` through native Payload create/update/findByID
in the existing Application/Product Worker mutation. Read a newly created and
updated author through depth-one population of a pending article. Null clears
the optional reference; omission preserves it. Only the trusted root publishes.

## Shared Owner Correction

Logical document source admission accepts only scalar and the checked optional-one
Payload relation profile. Borrowed CMS execution retains that restriction. The
logical schema retains the native declaration. Shared readiness and binding
activation authenticate its derived target-liveness/reverse-index policy;
shared publication enforces it.

The shared logical-requirements owner lowers the supported declaration into the
existing publication reference projection. It derives or reuses an unconditional
reverse index; the document field remains the authoritative reference. Final-state,
scope-locked reference validation, index maintenance, deletion restriction and
rollback remain at shared publication. No adapter SQL, second edge writer or
per-call settlement is introduced.

Admit only the compiler's existing one optional, monomorphic, nonlocalized,
restrict-on-delete reference within its own checked Payload collection set.
Other native document relation profiles retain their runtime refusal. Existing
strong cross-source extensions retain their own policy and compatibility gates.
Separate population permission from standalone transaction behavior: borrowed
reads retain their transaction ID while native loaders read only root-observed
targets within the same request and pending state. Joins remain standalone-only.

## Boundaries And Validation

Create/update/findByID remain available in content-only profiles. The connected
[delete and preference lifecycle](./payload-delete-preferences-preflight.md)
adds real Payload delete only with admitted cleanup authority. The relationship
witness now uses native delete to prove target restriction and both target-delete/
reference-insert orderings. Find/count, many/join fields, arbitrary hooks,
cross-owner writes, commerce references, public facade, serving activation and
performance optimization retain their gates. Population reads remain genuine
Local API calls.

The [connected Worker witness](../../packages/flarex-backend/test/mixedMutationPayloadRelationships.workerd.test.ts)
covers pending population and reassignment/clear, missing/wrong-table/foreign-scope
targets, late rollback, conflict/retry, durable replay and uncertain-COMMIT
recovery. The two target-delete/reference-insert orderings exclude Product and
Application writes; population retry observes an independently updated target
from a genuinely fresh snapshot. PGlite and ordinary-role PostgreSQL are separate
validation lanes; real COMMIT-response loss is PostgreSQL-only. This does not
establish production scale, simultaneous lock-contention capacity or arbitrary
framework compatibility. Affected typechecks use Pinggg `tsc-rs`.

This extends fresh private logical configurations and their derived index and
activation evidence. Existing scalar and cross-source extension bytes retain
their meaning. No named environment, durable row, journal or outstanding attempt
is reset or reinterpreted; existing installations would need an explicit
rebuild/readiness/activation decision before enabling the newly admitted policy.
