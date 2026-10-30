# Shared logical schema lifecycle and physical maintenance

Status: **Bounded Application lifecycle and physical maintenance implemented and validated locally after independent challenge**.
This is a connected milestone of the active [goal](../GOAL.md), not completion
of the native, GC, deployment or performance gates.

Baseline Flarex: `c5541e7106550679c209d9f6481791b99d9e9e9f`.
Pinned Convex: `db914cf06e2b06ee985646611b9e12ed7a770318`.

## Challenge findings and selected outcome

Current-owner, pinned-source and accepted-direction agents inspected
independently and exchanged evidence. They converge on replacing the actual
fresh Application install/deploy path with proposal, validation/index build and
atomic activation. The current one-shot `CoreDatabase.install` rejects every
populated definition change and has no source schema/build state. An installer
facade would leave the missing writer, identity and readiness mechanisms intact.

Three current storage graphs must remain distinct: the translated five-table
Application core; selected native consumers over the old generic logical
families and physical control catalogs; and remaining native physical targets.
Payload/Medusa compilers contain reusable native meaning. Their old catalogs,
readiness and structural installation choreography are replacement inputs.
Unrelated dirty Task/system-producer changes do not establish committed support.

## Connected logical replacement

| Current responsibility | Pinned mechanism | Required replacement |
| --- | --- | --- |
| One-shot table/index/program writes | SchemaModel submission, SchemaWorker, IndexModel and finish-push transaction | Durable proposal, real validation/build and atomic schema/index/program activation through the existing committer. |
| Per-table persisted validators | Namespaced `_schemas` and schema registry | Pending/Validated/Active/Failed/Overwritten states; one active and one pending-or-validated; state equality dependencies include absence. Import existing validators before admitting old data. |
| Boolean index readiness and unique runtime names | Full enabled/pending IndexRegistry | One enabled plus one pending replacement of the same name, distinct IndexIds; reads resolve enabled, all writers maintain both. Declaration uniqueness remains a separate rule. |
| All index writes ScanComplete | Backfilling/Backfilled/Enabled state | Source write-mode transition at retentionStarted; staged indexes stay maintained and unreadable until activation. |
| No build/progress owner | `_schema_validations`, `_schema_validation_progress`, Global `_index_backfills` | Attempt identity fences, informational counters separate from write-invalidated attempts, durable ordered index progress. Schema scan position is volatile, never an invented durable cursor. |
| Manifest table whitelist and missing-table refusal | Live namespaced table mapping and user-facing table model | All accessible user tables in the captured namespace, missing default scan empty with mapping dependency, explicit missing index error, missing table number get=None, implicit table creation before document validation. |
| Four-builtin logical bootstrap | Trusted system-table initialization/model migrations | Add source logical models and perform a bounded, versioned old-catalog migration before public admission; preserve IDs, data, program heads and outcomes. No reset or permanent parallel runtime. |

Active-schema violations reject the document write. A write conforming to the
active schema but violating Pending/Validated commits while atomically failing
that proposal. Staged violations fail their validation attempt, not the app
write. Conforming staged writes avoid unnecessary attempt-row observations.
Progress cannot certify a replaced or failed attempt.

Schema validation uses fresh ById pages at or after the proposal observation,
plus write-time enforcement. Skip work only for the source's actual proofs;
absent shape evidence means MustWalk. Source schema JSON, staged-validator hash
serialization and the executing canonical value validator have separate owners;
do not silently substitute a different record codec or canonical hash order.

Index builds translate the actual TableIterator: retain target S and historical
IndexRef, fetch recent weakly-monotonic ById pages, replay intervening document
logs, retain the first predecessor per ID (including null), fetch exact previous
revisions, merge historical keys and advance only after successful work. Add the
source timestamp-log and exact predecessor persistence ports with post-batch
retention validation. A predecessor query's witness timestamp is distinct from
its exact selected revision. Existing historical-scan convenience is not a
DO/native reason to replace that algorithm.

Use the source's genuine no-work retention branch only when the fixed floor is
at or below a new index creation bound. A resumed older build below an advanced
floor needs real retention support or explicit refusal. No wall-clock floor
advancement or unconditional retention skip is authorized.

Omitting a table from a schema preserves its identity, number, data and intrinsic
indexes, removes that schema's validator and drops its declared application
indexes only at final activation. Explicit table deletion is separate. A caught
document-validation failure after implicit table creation may leave the empty
table metadata, as in the source; do not add compensating deletion.

## Existing data and platform lane

The logical cutover preserves c554 data. Its frozen migration decoder imports
old per-table validators into an initial active schema and preserves disabled
but fully maintained indexes with the matching staged state. Publish a model
version only after its required transformation is complete and replay-safe.
The coordinator captured a populated store by executing the actual c554 owner;
the cutover witness must use that evidence, not a reimplemented old engine.

The preceding five-table declaration had no executing consumer; custom DDL
provisioned fresh targets and Drizzle Kit targeted the old schema. The shared
physical maintenance lane now consumes generated artifacts from that declaration. Keep legacy physical maintenance only for named
old consumers/data until their migration. Ordinary DO credentials perform no DDL.
See [physical maintenance](../divergences/drizzle-physical-maintenance.md).

## Authority, host adaptation and ownership

Global table/index catalogs and component-qualified logical schema tables follow
the source namespaces. Namespace labels do not grant native write authority.
Untrusted code receives neither schema installation nor raw persistence,
settlement, scope-clock or finalizer capabilities.

Schema models own codecs, state transitions, dependencies and validation-attempt
semantics. Index models own full index identity, diff/build/iterator state and
persistence reads. The engine owns transaction participation, bootstrap,
publication and atomic activation. Application compilation, actual callers and
the Worker bridge consume those owners. The coordinator owns physical platform
maintenance, integration, documentation, scoped projection and validation.

DO worker lifetime and Worker table-map transport have focused necessary
adaptations: [bounded lifecycle work](../divergences/cloudflare-schema-worker-lifetime.md)
and [Worker table mapping](../divergences/worker-table-mapping.md). They do not
change PostgreSQL authority or introduce a second progress/recovery engine.

## Native boundary and retirement

Native activation requires authenticated write-profile/exposure enforcement,
exact values, conditional uniqueness and relationship integrity at shared core
owners. Ordinary index readiness supplies none of those. The fresh owner must
not expose native-owned tables to unrestricted Application writes. Preserve the
previous ready combination while an actual native requirement is unsupported.

Reuse Payload sanitation/collection compilation and Medusa DML/Link lowering
when their actual consumers migrate. Payload draft/version/migration operations
currently refuse and are not invented compatibility obligations. Selected
native logical and physical consumers retain their named targets until that
connected cutover; the new lifecycle never falls back to those installers.
General business conversions and unnamed durable-data destruction remain outside
this milestone. Physical upgrades, shared lifecycle replacement and necessary
named cutover migrations remain authorized.

## Required witnesses and remaining gates

Prove replay/overwrite and competing pushes; active versus proposed/staged
violations; old-S writers across proposal/activation; same-name replacement
indexes with concurrent move/delete/body updates; ordered chunk failure and
resume; stale attempt/index worker refusal; namespace isolation; omission and
implicit/missing-table semantics; code-only publication; atomic schema/index/
program activation; uncertain progress/activation recovery; old-store cutover;
and Drizzle declaration/emitted/inspected schema agreement.

Run meaningful owner and real Application consumer coverage on PGlite and
ordinary-role PostgreSQL separately, then actual local workerd lifecycle/restart
proof. Required post-change TypeScript and systems reviewers inspect the exact
isolated checkpoint. No Rust test execution, native runtime cutover, production
capacity, general GC-era iteration or managed Hyperdrive/eviction is implied.

Versioned TableCounts are part of this connected scope. Source backfill progress
must not checkpoint a cursor while its total remains unknown and transaction
count is unavailable. Bootstrap/warm counts through the source table-summary
checkpoint and revision replay owner; publication applies coalesced row deltas
and transactions track a full ById count dependency. No adapter SQL COUNT or
independent history log substitutes for that owner. Shapes may remain genuinely
unavailable/conservatively Unknown, forcing MustWalk; exact shape inference and
its performance claims remain open. Preserve source numeric checkpoint ranges
and lexical encoding, including u64 counters beyond JavaScript safe integers.

The historical iterator's decoded-body cap is not a DO allocation or a bound on
all ID metadata. Host work settings must bound retained documents/pages and
finite work lifetime; spilling bodies to exact persisted references preserves
source reconstruction. Never truncate observed predecessors or advance a cursor
past uncompleted work. Retry follows the narrow settled-timeout adaptation in
[the PG lifetime record](../divergences/postgres-client-lifetime.md#tableiterator-timeout-classification).
The current Application validator protocol remains a bounded reused input:
source int64 literals and negative-zero literals require a connected protocol,
SDK, manifest and validator translation. They are a remaining parity gate, not
a justified DO divergence or a claim of complete schema compatibility. Search,
vector, exact shape inference and native constraints likewise retain their
explicit gates. Physical cutover preserves old revisions; opening a pre-cutover
logical transaction remains subject to the resident metadata/retention floor.

Captured schema table lookups use a private weakly owned name index, matching
source map lookup rather than rescanning ordered arrays for every write or every
proposed/active pair. Ordered DTO arrays, canonical source JSON and hashes stay
unchanged. This removes the known quadratic lookup path; it establishes no
production throughput or isolate capacity target.