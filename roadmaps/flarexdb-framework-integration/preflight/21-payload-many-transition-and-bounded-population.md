# Payload Many-Value Transition And Bounded Population

## Status And Recommendation

Status: bounded forward population is implemented privately. The optional-many
migration-host direction remains deferred. The [installation and migration
boundary](./22-payload-many-installation-and-migration-boundary.md) implements a
fresh private many consumer before an existing-row conversion host. The private
optional-one capability in [preflight 20](./20-payload-content-relations-and-rebinding.md)
is implemented. Its scalar successor, combined preference binding and depth-zero
CRUD remain compatible serving contracts.

Bounded forward population uses the existing `posts.relatedPost`
relation. Actual pinned Payload `findByID` and `find` support depth one,
using the same CMS read request and a bounded identity batch. This is one
capability, including the request bridge, storage read, limits and both-driver
conformance. It requires no new content schema or ownership successor.

Do not make optional-many admission a prerequisite for this read capability.
Existing-row conversion needs a distinct Payload migration-host decision, and
native reverse identities alone do not establish Payload join compatibility.
Neither gate is satisfied by forward population. The separate
[fresh join profile](./23-payload-bounded-reverse-joins.md) now completes the
bounded reverse-consumer prerequisite for the planned Medusa consumer proof.

## Current Evidence And Challenged Assumptions

Repository paths in this record are relative to the workspace root.

| Evidence at preflight | Consequence |
| --- | --- |
| `packages/analysis/src/applicationRelationAnalysis.ts`, `sourceValidatorMatchesDeclaration` | Native many declarations require a nonoptional array validator. `minItems: 0` permits an empty array, not an absent field. |
| `packages/persistence-postgres/src/applicationRelationCommit/Policy.ts`, `extractRelationOccurrencesResult` | Missing/null many values fail. The same lowerer reads prior and final documents and is reused by relation building. |
| `packages/persistence-postgres/src/applicationWriteOwnership/Successor.ts` | The authenticated exception is exactly scalar-to-optional-one. It does not authorize an arbitrary same-owner configuration change. |
| `packages/persistence-postgres/src/applicationRelationBinding/Policy.ts` | Cardinality changes are classified explicitly; reusing the optional-one physical identity for a many field is not an additive transition. |
| `packages/payload-adapter/src/runtime.ts` and `adapter.ts` | Public command arguments fix depth zero; adapter predicates admit only ID/title equality, and nonempty projections/joins are rejected. |
| `packages/persistence-postgres/src/cmsTransaction/host.ts` | A standalone read holds the existing scope-clock share lock through admission, callback and result capture. It has one request-owned document view. |
| `packages/persistence-postgres/src/cmsTransaction/documents.ts` | ID lookup, pending-row visibility and limits have a single owner. General `find` scans a bounded table; filtering that scan is not a population batch implementation. |
| `packages/persistence-postgres/src/cmsTransaction/lifetime.ts` | Overlapping document operations are refused. Concurrent loader callbacks must not open parallel operations on the same transaction. |

Pinned upstream remains `payload@3.88.0`, with installed distribution checked
alongside release commit `fea6f8a47a50ff1330d8a5071b43e7dcffb97b22`:

- [Payload's loader](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/collections/dataloader.ts)
  groups compatible keys and issues `find` with `id.in` and `pagination: false`.
  Its key includes transaction, access and projection parameters. Its default
  cache has no mutation generation, and framework batching alone does not bound
  database work or result size.
- [Relationship population](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/fields/hooks/afterRead/relationshipPopulationPromise.ts)
  uses that request loader until the depth boundary. Unresolved non-trash
  population falls back to an ID. That fallback is not proof of target liveness
  or authorization to reveal a target document.
- [Convex schema semantics](https://docs.convex.dev/database/schemas) distinguish
  optional properties from array values and validate existing documents when
  introducing a schema. Preserve that document model. Flarex's declared live
  references, restrict policy and trusted CMS request host are deliberate
  additional contracts, not a new universal mutation API.

## Optional-Many Existing-Row Decision

The intended later field is a new `posts.relatedPosts -> posts` relation,
retaining the existing optional `relatedPost`. It is top-level, nonlocalized,
monomorphic, ordered, duplicate-free, reverse-many and target-delete restrict.
Do not silently convert the existing scalar relation or reuse its identity.

The proposed Payload boundary accepts omission on create and supplies `[]`;
omission on update preserves the value; an explicit `[]` clears it. Required
Payload input is disabled, while Application storage requires a present array
with `minItems: 0`. Null, populated objects, sparse arrays, repeated IDs,
numeric/wrong-table IDs and unadmitted options are rejected before Payload can
normalize them. A first private ceiling of 32 items is proposed, within native
aggregate limits; it is not an increase to the native 1,024-item maximum.

Existing rows without `relatedPosts` still require a real document conversion.
An adapter default only affects a later API call. The relation builder's
backfill creates derived edges and adjacency evidence; it has no authority to
rewrite authoritative content. A synthetic empty-table fixture does not prove
the promised existing-row transition.

| Alternative | Decision |
| --- | --- |
| Default absent arrays in the Payload adapter or write `[]` directly into edge build SQL | Reject: candidate validation and prior-document extraction still fail, or the derived-projection owner becomes a content writer. |
| Treat every native `minItems: 0` declaration as accepting absence | Reject as incidental work: this changes schema/codec, extraction and compatibility meaning for Application consumers. An explicit native optional-array proposal could be considered separately. |
| Fresh-install-only many fixture | Useful lowerer evidence, but insufficient to claim an existing-row successor. |
| Explicit fenced Payload data conversion, then readiness and exact rebinding | Recommended direction for the later many capability, subject to its migration-host preflight below. No general migration engine is justified yet. |

The migration-host preflight must make these decisions concrete before code:

1. Identify real supported durable-data obligations. Fixtures alone do not
   justify a permanent dual-schema writer or compatibility bridge. With durable
   data but no live-traffic requirement, prefer the accepted offline conversion
   approach with backup, verification and recoverable activation.
2. Define authenticated authority over the exact old/new publications, table,
   policy, scope, generation and fence. Ordinary `ctx.db` writes remain denied;
   a raw driver handle, maintenance Boolean or caller-supplied digest is not
   migration authority.
3. Define the serving fence across short resumable conversion transactions.
   Each row conversion must retain row history, indexes/uniqueness and normal
   commit evidence through an admitted owner operation. The old writer cannot
   recreate missing arrays after progress is recorded. The current exact-schema
   CMS writer cannot simply write a field its active policy does not admit.
4. Resolve candidate-validator admission during conversion, durable progress,
   replay, partial failure, interruption and restore. A single process-local
   flag or one transaction held across the entire build is insufficient.
5. Build and validate the new derived relation only after converted rows are
   valid. Authenticate the new same-owner transition and its cold history,
   activate the Application head, then bind exact content/lifecycle evidence.
   Preserve the old optional-one relation through explicit reuse readiness.
6. Specify recovery after converted data, after Application activation and
   before rebinding. Reverting code alone does not establish data compatibility.
   Prove both race orders with a writer and enforce the existing history budget.

No migration-host implementation, new persisted progress record or native
absence-policy change is authorized by this document. The [migration-host
assessment](./22-payload-many-installation-and-migration-boundary.md#existing-row-conversion-contract-deferred)
records the conversion authority, serving exclusion, progress and recovery
requirements. Fresh-install many conformance is implemented separately because
no supported deployed-data obligation is recorded. Fresh-only evidence must never
be presented as an existing-row successor proof.

## Implemented Capability: Bounded Forward Population

### Observable Contract

| Surface | Admitted behavior |
| --- | --- |
| Entry | Private Node standalone `findByID` and `find` on the relation profile accept explicit depth 0 or 1; omission stays at depth 0. |
| Output | Depth 1 populates one `relatedPost` hop. Relations inside that target remain IDs/null at the depth boundary. Missing optional source value remains null. |
| Lists | Preserve existing root ID order, page/count semantics and limit at most 32. Shared target IDs reuse one request-local load; do not reorder roots. |
| Cycles | Self-reference and two-row cycles terminate at depth one; no recursive fixed-point traversal. |
| Writes/nesting | Create/update/delete results and fixed nested hooks remain depth zero. Reject depth-one use in a write request before invoking Payload. Mutation-local loader invalidation is a later contract. |
| Access | Preserve the existing fixed headless access policy and `overrideAccess: false`. No user-selectable access override, target collection, projection, locale, draft, hidden-field or dynamic access callback. |
| Unsupported | Depth greater than one, reverse joins, relationship predicates, caller-provided `id.in`, populated writes, cross-collection population and arbitrary select/populate arguments fail closed. |

Keep Payload's after-read ordering and loader result shaping. A new hand-written
population engine would duplicate framework semantics unnecessarily. Preserve
the existing authenticated content configuration: depth is a bounded read option,
not permission to widen schema, provenance or write ownership. If implementation
requires changing the authenticated sanitized configuration, revise this decision
before granting a new successor exception.

### Request, Storage And Limit Ownership

```text
exact content/lifecycle admission + scope-clock share lock
  -> root Payload read at admitted depth
  -> pinned request-local loader groups referenced IDs
  -> private adapter recognizes the exact loader query
  -> CMS document owner reads a bounded identity batch in the same request
  -> Payload shapes targets at depth one
  -> aggregate result capture + request cleanup + read settlement
```

Add one operation-specific batch read at the CMS document owner and reuse the
Application current-row reader beneath it. It accepts only authenticated table
identities, a bounded distinct ID set and the existing request capability. Return
results aligned with the requested IDs and retain explicit missing slots. Use a
single bounded document query for an uncached batch; do not implement the loader by
running a table scan or one SQL query per target. Existing target/current-row
decoding, document limits and typed corruption failures retain their owners.
The reader retains a separate size query before document hydration and its
existing clock check. A cache hit needs no additional row query. Cumulative
uncached identity capacity is checked before dispatch, so a ninth batch after
256 retained identities cannot hydrate a 257th document before refusal.
Route the exact root `findByID` lookup through the existing identity read as
well, preserving missing-root behavior. Otherwise its current bounded `find`
scan would hide a per-target batch improvement and unnecessarily load unrelated
posts. Combined ID/title predicates must retain both predicates.

The adapter may recognize the pinned internal `id.in` form only while an admitted
population request is active. A query shape or transaction string by itself is
not authority. Validate its IDs against the root documents' admitted forward
references, and keep the public command predicate grammar unchanged. Account
for Payload's generated query wrapping, defaults and loader result metadata;
prove the installed call shape rather than relaxing all adapter checks.

Use one fresh Payload request and loader per standalone root operation. All
population reads stay within the original CMS admission, scope, clock frontier,
transaction and lifetime. The scope-clock share lock supplies consistency for
the admitted READ COMMITTED current-row path; do not start a separate snapshot
or release that lock between root and target reads. Native snapshot-query
capabilities remain separate. Do not claim scope writes can proceed while this
bounded read holds its share lock.

Reserve a request-wide ceiling of 32 distinct population targets before dispatch.
It does not reset per loader call, root row or collection. Retain the CMS limits
of 32 root page rows, 256 loaded identities, 64 operations, 64 KiB per stored
document, 1 MiB aggregate command accounting and the existing deadlines. Root
scans already consume these limits; this capability does not make the general
find path scalable beyond its existing bounded profile. Repeated output copies
of a shared target still consume response bytes. Check/reserve output work before
building an oversized populated result; a final byte check alone is insufficient.

Serialize storage batches through the existing request lifecycle. Payload may
schedule several population promises, but that must not become overlapping
transaction operations or a second connection. Cancellation closes admission,
drains owned work and releases the share lock; no cache survives the request.

All visible references in this closed profile should resolve to live targets
under the same admission. A missing/tombstoned target is an integrity diagnostic,
not successful partial population justified by upstream ID fallback. Project it
as CMS `storedCorruption` with the target-integrity cause and fail the complete
read. Invalid caller IDs keep their input-failure classification.
Future dynamic access denial needs a separate identity-disclosure and response
contract; it is not implemented by this fixed-policy proof.

### Reverse Boundary

The existing native query path proves committed reverse identities with its
authenticated snapshot and bounded window contract. It does not supply Payload
join pagination, totals, arbitrary order, access-filtered completeness or pending
reverse reads. The forward-only profiles leave `join` disabled. The separate
fresh-only [join profile](./23-payload-bounded-reverse-joins.md) now maps the pinned
query/result shape to native first-window identities and depth-one population.
It does not invent a total from one window or scan all sources in the adapter.

## Execution And Completion Evidence

Keep the current transaction/commit owners, row and edge formats, exact bindings,
optional-one successor and scalar API. Extend the existing adapter/request bridge
and current-row read owner through narrow operations. No legacy engine needs a
port, rewrite or temporary bridge for this capability.

The argument/profile checks, request-bound batch read, pinned loader integration
and conformance form one capability. Its maintained proof contract is:

- Pure contract tests reject unsupported depth, forged/cross-request loader
  admission, wrong-table IDs, unadmitted projections and one-over-budget inputs.
  Pin defaults and duplicate target accounting without a database startup.
- One reusable scenario on PGlite and ordinary-role PostgreSQL exercises actual
  Payload depth-zero/one reads, root paging, shared targets, self/cycles, null,
  missing roots, exact output shape and fresh request caches after target update.
  Assert batch query counts at the row-read boundary, including reuse, rather
  than asserting a wall-clock speed threshold or counting unrelated metadata SQL.
- Prove root and target reads cannot observe opposite sides of a concurrent
  commit, and activation/rebinding cannot change admission during the read.
  Use native barriers with both holder orders. Prove interruption and batch
  failure release locks, drain callbacks and publish no row/fact/result/wake.
- Exercise aggregate byte/identity/call/target limits and cancellation. Existing
  write/nested depth-zero and scalar/preference behavior must remain compatible;
  no cache reuse may cross request, scope, binding or access identity.
- Add focused manifest-owned population lanes using the existing shared fixtures
  and one runtime/database per driver scenario. Run applicable Application
  preservation lanes once when the shared reader changes, focused regressions,
  bounded typechecks, core/diff/staged lint and both standing reviewers. Do not
  rerun broad database suites for individual assertions or documentation edits.

Completion means real depth-one forward population with bounded database and
response work, exact request consistency, fail-closed admission and both-driver
proof. Many conversion, general reverse-join parity, general access, public packages, dashboard,
live sync, hosted and production serving remain explicit subsequent gates.
