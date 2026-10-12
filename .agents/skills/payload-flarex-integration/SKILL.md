---
name: payload-flarex-integration
description: Plan, implement, refactor or review the Payload database adapter, Local API composition, collections, request lifecycle, queries, population and integration cleanup with Flarex. Ground contracts in the executing Payload source. Not for unrelated websites or content editing.
---

# Payload Integration With Flarex

Build the CMS outcome through native Payload behavior and admitted Flarex
capabilities. `AGENTS.md` owns scope, core corrections, cleanup, checks and
review; this skill does not authorize a framework rewrite.

## Executing Contract

Paths below are relative to the Flarex root. Inspect the accepted DB design,
`design-notes/flarexdb-payload-relational-adapter.md`,
`roadmaps/16-package-boundaries.md`,
`roadmaps/flarexdb-framework-integration/07-payload-adoption.md` and its
`preflight/payload-release-capability-map.json` compatibility evidence.
Verify `packages/payload-adapter/`, manifests/lockfile and executing Payload
exports, declarations and implementation before comparing pinned snapshots.
Keep release/status/test receipts in their current owners.

Trace admitted command -> Local API -> access/validation/hooks -> adapter ->
Flarex capability -> result. Direct `payload.db.*` calls do not prove the Local
API lifecycle. Native adapters supply contract evidence; their SQL, migrations
and transaction mechanisms are not automatic Flarex dependencies.

## Types, Validation And Reuse

Reuse native normalization, collection validation, hooks and results. Search
existing owners before copying helpers; compare strictness, defaults, error
order, mutation, lifetime and authority. If storage/host coupling blocks reuse,
consider a seam change at its actual owner.

Use exported operation types or types derived from adapter members. Broad native
generics do not prove Flarex's admitted operation/collection contract: derive
closed argument/result types from authoritative schemas/decoders. Keep unknown
at foreign/wire boundaries and decode before use. Preserve operation-to-input/
result correlation, exhaustive protocol alternatives, and directly bound
handlers where possible. Localize required generic assertions with runtime
evidence; never cast JSON into documents or duplicate schema fields in interfaces.

Caller filters, access-combined sanitized filters and authenticated loader
batches may share primitives but have different admitted shapes. Centralize
policy only where semantics agree; keep decoding/error mapping explicit.
Preserve omitted/null, create/patch, empty/missing collections, sort/page
envelopes and output ownership. Payload may mutate population slots/options;
do not lend canonical cached objects or frozen relation arrays. Preserve profile
metadata, provenance and authenticated digests; use explicit translations and
drift witnesses rather than a universal schema DSL.

## Lifecycle And Cross-Consumer Storage

Payload owns framework semantics; Flarex owns schema admission, integrity,
transactions, settlement and publication. Preserve same-request nesting,
transaction IDs, rollback-only state, scope/binding revalidation and outer-only
settlement. Missing standalone-read state differs from an invalid presented
mutation token. Keep closure/cancellation observable; signaled Promise work may
still be running. Never hold transactions over unadmitted hooks/remote effects.

Unsupported methods, fields, queries and internal collections fail under the
admitted contract. No successful no-op transaction/migration defaults or startup
DDL. Core blockers follow AGENTS.md's correct-owner procedure.

Use [shared logical storage](../../../design-notes/flarexdb-shared-logical-storage.md)
and its [roadmap](../../../roadmaps/shared-logical-storage/README.md).
Relationships across Application/Payload/admitted Medusa records need scoped
identities, forward population/reverse queries, authorization, draft/version/
soft-delete visibility, cardinality and deletion policies. Keep one authoritative
reference/Link plus derived indexes; traversal cannot bypass target hooks/access,
grant mutation authority or make independent calls atomic.

Logical planning/build/progress/recovery/readiness belongs at shared owners;
Payload config/conversion semantics remain Payload-owned and physical upgrades
remain distinct. [Advanced evolution](../../../roadmaps/shared-logical-storage/deferred-framework-schema-evolution.md)
is deferred: no populated-data conversions, full lifecycle upgrades, ownership
transfers or new migration host outside authorized scope. Record blockers and
continue independent work without adapter workarounds or legacy fallback.

## Runtime Construction And Proof

Construct by responsibility; callers supply real dependencies without rebuilding
a private pipeline. Show before/after callers, including exceptional cases.
Avoid factory stacks, generic CRUD engines, giant barrels and utility extraction
that only hides complexity.

Give fixture collections, fault hooks, counters and raw-instance inspection a
test-support owner. Keep one runtime and a small internal composition seam;
a testing barrel is insufficient if normal construction still installs fixtures.
Do not duplicate admission/transaction/recovery/publication in a fixture wrapper
or turn fixed fault hooks into an arbitrary public callback API. Preserve nested
failure, cancellation and replay witnesses, including single-execution counters.

Migrate callers and remove obsolete assembly, parallel validation and scenario
behavior while retaining meaningful assertions. Validate real Local API calls
and connected consumers, malformed/unsupported inputs and lifecycle failures.
For type changes, prove invalid combinations fail to typecheck and decoded
values reach handlers without assertion laundering. Use behavior/drift witnesses,
not helper counts/source layout, and apply AGENTS.md's database/review gates.
Keep private conformance, public API, deployment and production claims distinct.
