# FlarexDB Accepted Design And Review

Status: accepted architecture correction; implementation is still incomplete

Last reviewed: 2026-07-14

This document is the decision record for the proposed unified FlarexDB schema,
commit compiler, sync engine, Payload adapter, and Medusa integration. It keeps
the useful motivation from the longer research notes while correcting the
parts that were unsafe or internally contradictory.

When another design note conflicts with this document, this document controls.
Domain roadmaps own durable current status and target direction; Git owns
chronological implementation history.

## Verdict

The storage backbone is good, but the original unified-runtime proposal was
too broad for v1.

Accept:

```text
Postgres is the only authoritative committed data store.
App/CMS rows use typed JSON plus derived indexes, edges, and unique keys.
Medusa commerce uses Medusa-owned relational tables and transaction semantics.
Every authoritative write advances one scope-local commit stream and writes
recovery metadata atomically.
Cloudflare owns sandboxed execution, WebSockets, coordination, and disposable
cache state.
```

Reject as a v1 promise:

```text
one universal SessionDO transaction engine for Flarex, Payload, and Medusa
automatic atomic ctx.db + ctx.commerce transactions
cache freshness defined as observedCommitSeq >= mutation beginTs
VersionDO + DocCacheDO + QueryCacheDO as prerequisites for correct live sync
caller-authored locks, physical uniqueness rows, freshness rows, or system
outbox rows in a commit intent
```

The correct unification point is the trusted Postgres authority, scope clock,
commit feed, outbox, and adapter contracts. It is not one universal physical
table shape or one universal user-visible transaction.

## Hosted Runtime Topology

The hosted production target is a dedicated private `flarex-executor`
Cloudflare Worker:

```text
public backend Worker
  -> artifact-runtime Worker
  -> generated Dynamic Worker shell around untrusted user modules
  -> private FLAREX_EXECUTOR service binding
  -> trusted executor Worker
  -> cache-disabled Hyperdrive
  -> authoritative Postgres
```

This removes the former Cloudflare-to-Node/Nitro/Vercel deployment bridge. It
does not remove the sandbox syscall boundary. The generated Dynamic Worker
shell may call the executor binding, but developer modules receive only the
restricted `ctx` capabilities. They never receive Hyperdrive, `pg`, Drizzle,
SQL, persistence, physical routing, or transaction handles.

Keep the stable `/invoke/start`, `/invoke/syscall`, `/invoke/finish`, and
`/invoke/abort` Fetch protocol for the first Worker host. A service-binding
Fetch is an internal capability call, not a public executor URL. Workers RPC
may replace that transport later only as an independent compatibility change;
it is not a FlarexDB correctness prerequisite.

Cloudflare Durable Object facets are the accepted conditional placement for a
measured `C07A` journal move, not a replacement for the first Postgres-backed
proof. When the predeclared journal threshold is met, the hosted variant is:

```text
artifact-runtime Worker
  -> one server-issued supervisor Durable Object per query/mutation session
  -> one dynamically loaded InvocationFacet per attempt fence
  -> restricted executor syscall capability for exact Postgres reads
  -> sealed logical journal/result returned to the supervisor through facet RPC
  -> private trusted executor finish
  -> authoritative Postgres commit and outcome
```

The execution artifact remains the exact content-addressed package selected by
trusted deployment/session authority and loaded from the existing artifact
store. Supervisor or facet SQLite must not become a second code-package or
deployment authority. A scope-wide or deployment-wide execution actor is also
rejected: session actors use a server-issued per-session identity so unrelated
queries and mutations do not share one serialized execution lane.

The trusted executor core and commit compiler remain framework-neutral and are
called in-process by the executor Worker adapter. The Worker persistence
adapter uses a request-scoped `pg.Client` through a cache-disabled Hyperdrive
binding and closes it in `finally`. It does not retain the current Node-style
`pg.Pool`, run filesystem-backed migrations, or perform unbounded migration,
backfill, or maintenance work inside request handling. Migration generation
and application remain deployment/control-plane or Node CLI responsibilities.
PGlite remains the fast local/test lane. Nitro/Vercel remains an optional
compatibility host until explicitly retired after hosted parity.

Cloudflare's current connection-lifecycle guidance says invocation-scoped
Workers-to-Hyperdrive clients are cleaned up automatically. Flarex still owns
an explicit `client.end()` attempt in `finally` for deterministic portability
through the direct-Postgres local/test lane. That rule is not a claim that
Hyperdrive requires driver cleanup, and a cleanup failure must not replace the
primary request failure. No client or driver pool may live in module scope.

The host decision is accepted, but production activation remains gated on a
small proof: Worker-safe import graph and Wrangler bundle, request cleanup,
cache-disabled Hyperdrive, and real-Postgres transaction/OCC behavior. S02-B
and S02-C are host-neutral persistence turns. This proof must pass before
S02-D wires production generation resolution into the hosted executor.

Cloudflare references:

- [Postgres drivers and Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)
  for `pg`, Drizzle, `nodejs_compat`, and request-scoped clients;
- [Hyperdrive behavior](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/)
  for transaction pooling and the lack of write-driven query-cache
  invalidation;
- [Workers service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
  for private Worker-to-Worker Fetch and RPC boundaries;
- [Dynamic Worker bindings](https://developers.cloudflare.com/dynamic-workers/usage/bindings/)
  for passing restricted custom capabilities into loaded code; and
- [Durable Object facets](https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/)
  for supervisor-owned dynamic classes, isolated facet SQLite, lifecycle, and
  facet `fetch`/RPC calls.

## Document And Implementation Status

### Design Lineage And Shipped State

Three design iterations coexist in the repository, but they are not three
public storage versions:

| Design iteration | Repository form | Authority status |
| --- | --- | --- |
| Durable Object prototype | `PartitionDO` with authoritative Durable Object SQLite state and partition-local OCC | Unshipped prototype. Preserve only still-intended behavior as target tests; do not extend or migrate this architecture by default. |
| Initial Postgres prototype | `legacy_v1`, the current routed executor using the existing document/index/session/commit/outbox families | Unshipped intermediate implementation. It is evidence about behavior, not the accepted physical or transaction design. |
| Accepted FlarexDB design | `flarexdb_v1` | The only forward app-data architecture. `v1` means the first intended shippable FlarexDB storage contract, not the first internal design attempt. |

No implemented Cloudflare D1 app-data engine or `D1Database` binding was found.
The first prototype's authoritative SQLite is Durable Object storage. Historical
D1 proposals remain provenance only, and gate labels such as `S03-D1` do not
refer to Cloudflare D1.

Owner-declared shipped state, last confirmed 2026-07-14: neither prototype was
deployed as a supported production Flarex app-data service, and no durable
customer app data, live traffic, or supported external compatibility obligation
is known or recorded for either prototype. Repository inspection also finds
only internal/local consumers for these paths. Checked-in fixtures and
ephemeral test/generated development state are resettable. A named persistent
developer environment must still be inventoried before destructive cleanup. If
contrary deployment, data, issued-identifier, request-key, cursor, or consumer
evidence appears, that affected scope must be reclassified before destructive
work continues.

| Layer | Status | Meaning |
| --- | --- | --- |
| Existing `documents`, `indexes`, invoke sessions, Postgres live-query registry, and delivery outbox | Implemented prototype baseline | Keep only as bounded internal behavior evidence until equivalent target paths and tests exist. Do not extend it or treat it as a shipped migration obligation. |
| Typed app row JSON with revision/current, declared index, edge, and unique sidecars | Partially implemented accepted target | S06 implements the internal, non-routing row revision/current kernel. Index, edge, and unique sidecars plus target-native index population/build and routing consumers remain planned behind the storage-generation boundary. |
| Native commit feed, committed-success outcomes, and commit wakes | Partially implemented accepted target | S08 implements native commit/change-feed storage and its bounded private reader. S09-A implements the private scope-lifetime committed-success result receipt. S09-B implements the fixed-kind private commit-wake table and fenced claim/settlement repository. O07-A implements the private read-only committed-outcome resolver, and O07-B atomically publishes point rows, feed evidence, success receipts, and wakes. C06 replay orchestration/dispatch, payload expiry, sync activation, and retention advancement remain pending. |
| SessionDO/facet journal plus trusted commit compiler | Accepted only for a bounded app-data slice | The Postgres-backed point path now has C04C1's private logical plan, O06's reusable rollback-proven transaction kernel, and O07-B's first private durable publication. After the complete point path passes its real-Postgres gate, immediately measure journal overhead. If the predeclared threshold is met, use one per-session supervisor and one attempt-fenced facet whose isolated SQLite stores only the temporary logical journal. Broader query overlays must fail closed until implemented. |
| Payload adapter | Staged target | Start with reserved logical collections and scalar CRUD/transaction conformance; add relations, versions/drafts, globals, auth, locks, and hooks incrementally. |
| Medusa adapter | Separate trusted transaction lane | Preserve real Medusa repository, workflow, link, migration, and transaction behavior. |
| DeploymentSyncDO | Accepted v1 coordination target | One deterministic instance per scope, durable SQLite cursor/query/dependency state, Postgres catch-up. |
| VersionDO, DocCacheDO, QueryCacheDO | Deferred optimization | Add only after measurement and a gap-free freshness protocol. |
| Generic atomic `ctx.db + ctx.commerce` | Rejected | Commerce-affecting atomic behavior belongs behind a Medusa-owned facade/workflow. Cross-boundary follow-up uses IDs and the transactional outbox. |

Replacement strategy is selected from shipped-state evidence:

| Proven obligation | Required strategy |
| --- | --- |
| No durable data, live traffic, issued durable identifiers/request keys/cursors, or supported external contract | Clean replacement: prove the target vertically, switch internal callers and fixtures, then delete superseded runtime and storage paths. Source/deployment rollback is sufficient while the checkpoint is being proven. |
| Durable data exists, but an offline migration is acceptable | Back up, perform the smallest one-time conversion, verify invariants and recovery, then activate the target. Dual operation is not automatic. |
| Live traffic must remain available | Add only the necessary backfill/shadowing, comparison, scoped cutover, and rollback mechanisms, each with an explicit retirement gate. |
| Only external identifiers, request keys, cursors, or API contracts were issued | Preserve or map that boundary contract without automatically retaining the old storage engine. |

Under the current owner-declared state, the clean-replacement row governs the
two prototypes. A generation fence remains useful for trusted activation and
rollback of a deployment checkpoint; it does not imply a legacy data migration.

## Authority And Scope

`scope_id` is the data-plane authority. It is not an optional hint supplied by
the mutation journal. Scope-qualified key rules apply to data-plane rows and
per-scope operational state. Control-plane catalog identities may use globally
unique opaque IDs, but every versioned definition must be tied by foreign keys
to the same deployment as its stable identity and schema version.

The trusted executor derives scope from an authenticated server-side session or
grant. In a shared-table topology, every primary key, unique constraint, and
intra-scope foreign key includes `scope_id`. A child relationship has the
shape:

```sql
foreign key (scope_id, parent_id)
  references parent_table (scope_id, id)
```

RLS or an equivalent transaction-local scope binding should provide defense in
depth. In schema-per-scope or database-per-scope deployments, redundant scope
columns may be omitted physically, but the logical authority remains the same.

Use a shared physical Medusa schema only when the platform enforces one
homogeneous Medusa schema and module set. Projects with staggered Medusa
versions, custom modules, or custom repository/provider behavior should use a
per-project schema or database until a safe compiled shared strategy is proven.

## Physical Identifier And Index Scalability Policy

This policy applies to the replacement FlarexDB schema. Existing prefixed-text
identifiers and legacy Durable Object keys are not the future physical-type
authority. They become migration inputs only if durable shipped values are
actually discovered.

- Keep branded public identifiers at API and protocol boundaries, but do not
  repeat strings such as `scope_<uuid>` through every hot Postgres primary key,
  foreign key, and secondary index. The shared-database replacement stores the
  trusted scope and epoch components as native `uuid` values and converts at the
  trusted boundary.
- Keep app document IDs opaque and table-qualified in the developer API.
  Replacement Document ID V1 is a positive compact table identity plus one
  canonical lowercase UUID, whose exact bytes are the physical 16-byte row
  identity. Current trusted generation remains UUIDv4. The textual/physical
  codec is generator-neutral: a future measured UUIDv7 choice would not create
  Document ID V2, and no UUID version or insertion order is an API ordering
  contract. The permissive existing parser remains legacy-only.
- Prefer compact numeric physical identities for hot stable catalog keys such
  as table, index, relation, and constraint identities. Public or globally
  portable catalog references may additionally carry opaque UUIDs; those do not
  need to be repeated in every data-plane index.
- Preserve adapter-owned identity semantics. Payload collection IDs and Medusa
  module IDs are compiled from their actual schema/manifest. Do not coerce them
  all to UUID. If a wide external ID would dominate hot indexes, keep the
  external unique key and add a compact trusted surrogate.
- Continue using scope-local signed `bigint` commit and outbox sequences. Every
  persisted sequence or fence contract, including `CommitSeq`,
  `StorageGenerationFence`, attempt fences, and revocation epochs, rejects
  values outside PostgreSQL's signed-int64 domain. Nonnegative counters permit
  `0..9223372036854775807`; positive fences permit
  `1..9223372036854775807`. Protocol types must not admit values that the
  authoritative database cannot store. IDs never replace `commit_seq`,
  `outbox_seq`, or explicit business ordering.
- Every ordered pagination index ends in a unique deterministic tie-breaker,
  normally the compact row identity. Queries must use explicit `ORDER BY`; heap
  or UUID insertion order is not an API contract.
- Every index must correspond to a named read, uniqueness, OCC, delivery, or
  recovery path. Avoid overlapping indexes unless query plans prove both are
  necessary. Partial indexes, BRIN, hash partitioning, and scope promotion are
  measured physical options, not unconditional v1 requirements.
- Ordered-key codec v1 permits at most 2,048 encoded field-tuple bytes. The
  separate exact 16-byte row identity is not part of that ceiling. Equality
  hashes cannot substitute for ordered bytes in range scans, and an oversized
  tuple fails with `OrderedIndexKeyTooLargeError` before SQL rather than
  discovering the B-tree tuple limit in production.

If a supported legacy public ID was actually issued, its migration must preserve
a reversible mapping to the new compact physical representation. Otherwise the
target starts directly with Document ID V1 and no artificial legacy mapping.

Postgres references for this policy:

- [UUID type](https://www.postgresql.org/docs/current/datatype-uuid.html) and
  [UUID functions](https://www.postgresql.org/docs/current/functions-uuid.html)
  for native UUID storage and the time-ordered UUIDv7 candidate;
- [multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html)
  and [indexes and ordering](https://www.postgresql.org/docs/current/indexes-ordering.html)
  for equality prefixes, range columns, deterministic suffixes, and backward
  B-tree scans;
- [B-tree indexes](https://www.postgresql.org/docs/current/btree.html) for index
  tuple-size constraints and
  [BRIN indexes](https://www.postgresql.org/docs/current/brin.html) for measured
  append-correlated history/feed optimization.

## Catalog And Schema Evolution

Catalog identity must survive schema activation. Separate stable identities
from immutable versioned definitions:

```text
stable:
  table_id, logical_index_id, relation_id, constraint_id

versioned:
  table_definition, column_definition, index_definition,
  relation_definition, constraint_definition
```

`logical_index_id` identifies the deployment-scoped developer access path
`(table_id, descriptor)`. It is not sufficient to identify physical index
entries or a build. A field, kind, predicate, or ordered-key-codec change must
produce a separate immutable physical definition/build identity so the old
enabled index and its replacement can coexist. Per-scope build state and app
index-entry rows key that physical identity, never `logical_index_id` alone.
S05-A has frozen ordered-key codec v1 and the separate fixed 16-byte row
identity representation. C3 chooses a separately branded, deployment-local
positive signed-32-bit `index_definition_id`; one ID never serves both logical
and physical roles.

The `*_definition` names above describe semantic roles, not a requirement for
one physical catalog table per role. In the accepted v1 table path,
`fx_control_table` owns only the stable deployment-scoped mapping from compact
`table_id` to `(namespace, logical_name)`. The version-pinned table definition
lives exactly once inside `fx_control_schema_version.manifest_json`; there is
no `fx_control_table_definition`, `physical_name`, or second `definition_json`
projection. Names repeated in the manifest are immutable assertions that the
trusted binder must verify against `fx_control_table`, not a competing identity
authority.

S03-B2a freezes only a composable `tableDefinitions` section. Its first proven
variant is an `appDocument` definition with a required object validator and a
stable table ID. App table names, nested object-field names, and `v.id(...)`
targets follow Convex's 64-byte ASCII identifier rules; app table names also
reject the reserved `_` system prefix. The definition pins
`ObjectValidatorJsonV1`; expanding the compatibility validator later cannot
silently widen an existing section/definition version. It is not the complete
unified schema-manifest format:
indexes remain S03-C work, relation and constraint semantics remain gated on a
real compiler contract, and Payload/Medusa variants must be derived from their
own source schemas rather than being disguised as app document validators.
Extending the closed section requires an explicit semantic-version change.

S03-B2b uses an optimistic prepare/commit boundary because stable IDs are part
of the canonical bytes, while canonicalization and Web Crypto must stay outside
SQL locks:

```text
validate declarations and cap app tables at 10,000
  -> read current bindings and catalog high-water mark without a lock
  -> assign deterministic candidate IDs in ASCII name order
  -> assemble the ID-ordered semantic section
  -> canonicalize/hash outside SQL
  -> lock the deployment and revalidate the opaque binding plan
  -> insert the exact planned missing IDs and immutable artifact together
```

Any conflicting binding, partial application, or catalog high-water change
while every planned missing row remains absent makes the plan stale before
insertion; the caller rolls back and restarts preparation. A fully exact prior
application is replayable even if unrelated allocations later advanced the
frontier. S03-B2b2 now exposes one trusted persistence-facade operation whose
input is only deployment/schema/version identity plus unbound app declarations.
It manufactures one repository-authenticated combined token containing the
B2b1 binding plan and the B1 artifact prepared from that exact frozen section,
then applies both inside one transaction. Neither child token nor the combined
transaction helper is public.

The package root exposes the facade plus read/result/error contracts, not the
B1 artifact writer or stable-table allocator. Concrete backend adapter subpaths
still expose trusted Drizzle/schema capabilities for migrations, tests, and
executor composition; those are privileged escape hatches, not supported
schema-publication APIs, and must never be passed to user code.

The coordinator makes at most three total fresh attempts and retries only a
typed stale binding plan. Each retry rebuilds stable-ID planning and canonical
bytes/hash before opening the next transaction. Invalid input, missing
deployment, ID exhaustion, artifact conflict, checksum collision, corruption,
and SQL failures remain terminal. A standalone "reserve IDs, then best-effort
the artifact" flow is not accepted.

Convex evaluates source/schema code before SQL, then creates missing table
mappings and its Pending schema row in one transaction. Flarex preserves that
atomic publication invariant through optimistic revalidation because, unlike
Convex's name-keyed schema JSON, the Flarex canonical artifact embeds stable
numeric IDs.

S03-C1 adds a new closed semantic envelope rather than widening the existing
table-only publication contract:

```text
appSchema v1
  -> tableDefinitions v1
  -> indexBindings v1
```

An unbound developer index declaration contains only table logical name,
descriptor, and ordered field paths. The bound section carries a branded
deployment-scoped `logicalIndexId`, stable table ID, and the logical ordered
spec. It excludes physical definition identity, codec version, lifecycle,
build state, canonical bytes, and caller-supplied analyzer ordinals. Bindings
are ordered by logical index ID and reject duplicate descriptors or equivalent
ordered field lists per table.

Developer index descriptors use Convex's 64-byte ASCII identifier rules and
reserve `_...`, `by_id`, and `by_creation_time`. V1 accepts at most 64
developer indexes per table and 15 declared fields per developer index. S05-A
lowers those fields and appends trusted `systemCreationTime`; `_id` is the
implicit final tie-breaker represented by a separate exact 16-byte row
identity. This preserves Convex's 16-field effective limit without exposing
either system component in developer declarations. System field paths are
forbidden in developer declarations. Field-existence validation against the
table validator remains trusted compiler work.

The manifest declaration protocol retains absolute ceilings of 10,000 app
tables and 10,000 total developer index declarations. Because D2c currently
persists catalog definitions through serial SQL while holding the deployment
lock, the supported full publication facade adds a lower operational ceiling
of 256 combined definition work items, computed as app table declarations plus
developer index declarations. Both count layers are checked before decoding or catalog
planning. The existing 64 indexes per table and 15 declared fields per index
remain semantic limits.

Full publication also has an exact 16 MiB canonical-manifest ceiling. A
conservative traversal of decoded declarations rejects any guaranteed-over-limit
payload before the facade clones declarations or reads the catalog; the authoritative exact byte
check still runs after every fresh preparation and before its write
transaction. These are fixed generation/resource-safety boundaries, not
dynamic product-tier entitlements, lifetime quotas, or database DDL
constraints. Raising the operational work ceiling requires measured evidence
or a batched/set-based persistence path rather than merely changing the
protocol maxima.

`by_id` and `by_creation_time` are intrinsic app-table access paths in this
generation, not developer-owned `indexBindings` entries. `by_id` is satisfied
by row identity; creation-order storage remains a trusted physical compiler
responsibility. The semantic manifest version pins those built-ins even though
they do not consume developer logical index IDs.

Publication names follow the contract they actually expose:

- `ensureAppTableDefinitionsArtifactV1` is the explicit table-only
  compatibility operation. It persists the V1 `tableDefinitions` section and
  must not be mistaken for complete app-schema publication.
- `publishAppSchemaV1` is the supported full publication operation. It accepts
  unbound table and developer-index declarations and atomically returns the
  complete `SchemaManifestAppSchemaV1` projection.

There is no active app-schema publication V2, app-schema artifact V2, or
schema-manifest canonical codec V2. The V1 suffixes identify real, independent
contracts: the full semantic manifest, its component sections and physical
specs, and the schema-manifest canonical codec. This naming is separate from
the independently versioned Flarex row-value codec.
Publication is idempotent catalog persistence/replay; it does not activate the
schema, claim readiness, or route app data.

S03-C2 accepts `fx_control_index` as only the stable deployment-scoped mapping
from `(table_id, descriptor)` to `logical_index_id`. The descriptor column is
generic nonblank text at the database boundary; the app planner applies C1's
stricter developer descriptor contract, while future Payload/Medusa compilers
may define their own trusted naming policy. The row contains no logical fields,
schema-version binding, physical definition identity, codec, lifecycle, or
mutable timestamp. Its composite foreign key to `fx_control_table` prevents a
table ID from another deployment from being paired with the mapping.

C2 also accepts one internal combined table/index optimistic plan. Tables are
planned first; index declarations must reference a table in that exact
prospective schema, and missing logical IDs are assigned by resolved numeric
table ID then ASCII descriptor. Final bindings remain ordered by logical index
ID. Under one deployment lock, trusted code revalidates both catalog frontiers
and every requested identity before insertion. Exact complete replay succeeds;
changed bindings/frontiers or any proper subset of the rows missing at
preparation make the whole plan stale. The global partial rule is intentional:
a concurrently published table-only mapping is not evidence that its index
bindings were atomically published. Tables insert before indexes for foreign-key
order, the caller owns commit/rollback, and neither the plan/apply helper nor an
allocator is a supported root/facade operation. S03-D2a composes the plan with
D1 compilation and immutable full app-schema artifact preparation in one
authenticated no-write token. D2c owns one internal transactional
apply-and-verify attempt;
D2d owns the persistence facade, input snapshot, fixed limits, and bounded
fresh-whole-preparation retry.

S05-A accepts `AppOrderedIndexPhysicalSpecV1` as the replacement app ordered
index contract. A developer access path contains its declared document paths
followed by `systemCreationTime`; `by_creation_time` contains only that trusted
system field; and `by_id` has an empty encoded field tuple and orders directly
by row identity. The creation time is a positive float64 millisecond value
below 2^53 supplied by trusted storage, never read from developer JSON.

Ordered-key codec v1 closely ports Convex's portable order: missing, null,
signed int64, float64 by exact sortable IEEE-754 bits, false, true, binary UTF-8
string, bytes, array, then object. Missing is valid only as a top-level indexed
field result. Nested data is canonical, limited to 64 levels, and object field
names are at most 1,024 non-control ASCII bytes and cannot start with `$`.
`binaryUtf8` is the only app-index-v1 collation; locale-aware ordering requires
a later adapter-owned physical spec and codec version.

The persisted total position is `(encoded_key, row_id)`: `encoded_key` is the
at-most-2,048-byte ordered field tuple and `row_id` is the separate exact
16-byte tie-breaker. Half-open range bounds apply to encoded field bytes;
duplicate encoded keys order by the row identity column. Any change to these
bytes, lowering rules, collation, or ceiling requires a new codec version and
new immutable physical definition. If durable legacy rows are discovered,
unversioned key bytes must be rebuilt from those authoritative rows, never
reinterpreted as v1. Ordered-key codec v1 remains the only byte-order authority;
the separately completed S05-B value
codec lowers validated stored values into this ordering domain when an index
consumer needs it.

Bounds are distinct opaque bytes and may be 2,049 bytes. An exact complete
tuple uses `key || 0x00` as its exclusive endpoint. A partial tuple uses
`key || 0x16`: `0x16` is above every v1 top-level value tag and below the
reserved `0xff` NUL escape. This deliberate Flarex correction prevents a
partial equality such as `"a"` from admitting `"a\0"` (and the equivalent
bytes/empty-object cases). Do not use Convex's broad raw prefix increment for
v1 component equality, `gt`, or `lte` endpoints.

An immutable physical index definition carries its ordered-key codec version.
C3 persists app physical definitions as exact compiled artifacts:

- `fx_control_index_definition` owns the compact physical ID, a discriminated
  access owner, the accepted `AppOrderedIndexPhysicalSpecV1`, domain-separated
  canonical bytes, canonical-codec version, SHA-256, and creation receipt. The
  131,072-byte canonical-spec ceiling is above the closed worst-case v1 field
  envelope; it is unrelated to the 2,048-byte encoded row-key ceiling. SQL caps
  both canonical bytes and the detoasted logical JSON text size through
  `octet_length(physical_spec_json::text)`, and the strict JSON check is
  explicitly `IS TRUE` so missing keys cannot pass through SQL's nullable
  `CHECK` semantics. Public reads expose immutable branded hex snapshots rather
  than mutable typed-array evidence.
- Developer definitions are owned by `(deployment_id, logical_index_id,
  table_id)`. `by_creation_time` definitions are owned directly by the stable
  table and carry no fabricated logical ID. `by_id` is direct row-identity
  access and has no persisted physical definition or build.
- Exact physical bytes for one access owner reuse the same definition ID across
  schema versions. A changed lowering, field list, access kind, codec,
  collation, tie-breaker, or byte ceiling allocates another immutable ID so old
  and replacement generations coexist. Equal digests still require equal
  canonical bytes; a mismatch is a terminal collision/corruption outcome.
- `fx_control_schema_version_index_binding` binds each developer logical index
  to one matching definition. A composite foreign key proves the definition is
  owned by that exact logical index rather than merely existing in the same
  deployment. Current app developer bindings are always required for
  activation; a database check pins the flag to `true`, the read type is the
  literal `true`, and callers cannot supply an optional-index policy.
- The package-internal writer accepts only stable parent identities plus the
  logical app spec. It lowers and hashes before SQL, locks the deployment,
  verifies same-deployment schema/logical parents, allocates or reuses the
  definition, and inserts the binding in the caller-owned transaction. Existing
  bindings are classified before allocation, so even a caller that catches a
  conflict inside its transaction cannot commit an orphan definition. Exact-row
  comparison under the deployment lock uses already prepared canonical evidence
  and performs no Web Crypto. There is no standalone allocator, naked
  definition reservation, or public publication method. D1 now compiles the
  complete normalized requirement set and injects intrinsic creation-time
  requirements; D2c must verify and publish that exact set against the full
  immutable manifest after D2b supplies the missing intrinsic writer.

The old cutline sketch that required non-null `logical_index_id` on every
physical definition was contradictory: intrinsic creation-time access consumes
no logical catalog ID. The discriminated owner above is the accepted correction.
Likewise, independent schema and definition foreign keys are insufficient; the
binding-to-definition owner foreign key must be composite.

Mutable lifecycle belongs only to per-scope build state:

```text
declared -> building -> backfilling -> validating -> enabled -> retiring
```

C4 corrects the older control-table sketch. Build lifecycle is located beside
the authoritative scope clock as `fx_system_index_build_state`, keyed by
`(scope_id, index_definition_id)`. It has a local restrictive foreign key to
`fx_system_scope_clock(scope_id)`, but no copied `deployment_id`, no foreign key
to `fx_control_scope`, and no impossible cross-database foreign key to the
deployment-owned physical definition. D2c must verify the control definition
and binding before D3's idempotent located build-state reconciliation; C4 does
not pretend that split placement can commit both stores atomically.

Each row pins `flarexdb_v1`, positive bigint storage-generation fence, epoch,
nonnegative start commit sequence, and a positive signed-int64 attempt fence.
Cursor codec v1 is the exclusive last fully committed 16-byte row identity in an
ascending exact-snapshot scan; null means no row has been durably completed.
`declared` and `building` rows cannot carry a cursor in either SQL or the
public discriminated read type. `building` means only
pre-backfill physical/write-fanout preparation and is never queryable.

The only C4 root read anchors on the current scope clock in the same SQL
statement and returns `absent | current | stale`. Missing clock authority is an
error. `current` means only exact generation/fence/epoch equality and a start
sequence no later than the clock; it does not mean `enabled`, queryable, or
activation-ready. Stale rows remain readable for recovery and do not foreign-key
their historical pin to mutable clock columns. C4 adds no insert, transition,
claim, cursor-checkpoint, enable, retire, or readiness operation.

S03-D is split across distinct correctness boundaries rather than treated as
one atomic operation:

1. D1 is a pure trusted compiler over the already-bound
   `SchemaManifestAppSchemaV1`. It snapshots the strict manifest, validates
   recursive ID targets and Convex-compatible index-field reachability, and
   derives canonical physical requirements. It emits one table-owned
   `by_creation_time` requirement per app table and one requirement per
   developer logical index; direct `by_id` emits no definition or build.
2. D2a accepts only strict unbound deployment/schema identity plus table/index
   declarations, snapshots them before asynchronous work, and composes the C2
   stable-binding plan, D1 canonical requirements, and immutable full-manifest
   artifact in one frozen package-internal token. WeakMap membership
   authenticates same-process identity. The token is not a durable receipt,
   serializable authority, cryptographic capability, or permission to write;
   preparation performs catalog reads but no catalog writes.
3. D2b derives the complete table-ID-ordered set of identity-only
   `by_creation_time` child tokens from the authenticated D2a state and reuses
   D1's canonical evidence without re-lowering or hashing. Its per-token writer
   locks the deployment, verifies the exact planned app namespace/logical name
   before any definition lookup or allocation, and ensures/replays one
   table-owned definition through the shared C3 high-water allocator. It never
   creates a table, logical index, schema binding, build row, second manifest,
   standalone allocator, or transaction commit.
4. D2c consumes one authenticated preparation inside one caller-owned
   control-database transaction, revalidates/applies the C2 plan, inserts or
   replays the exact full app-schema artifact, persists all required physical
   definitions and schema bindings, and exactly verifies the normalized projection before
   returning. The internal attempt owns no commit or retry and performs no
   canonicalization or hashing under the deployment lock. Exactness covers the
   manifest-projected identities/definitions plus the complete binding set for
   that schema version; unrelated historical catalog rows remain valid.
5. D2d supplies `publishAppSchemaV1` and snapshots its strict declaration
   input once. It makes at most three total attempts, rebuilding all
   database-dependent planning, compilation, canonical bytes, and hashes for
   each attempt; only the combined typed stale-plan error is retryable. The
   protocol's 10,000-table and 10,000-developer-index maxima remain intact,
   while the current serial publication path enforces the lower 256-item
   operational ceiling.
   Conservative pre-clone byte rejection and the exact post-preparation 16 MiB
   check apply at the boundaries above. Focused real-Postgres concurrency,
   near-operational-limit, and late-failure tests close the whole-publication
   race, bounded-work, and rollback matrix.
6. D3 will reconcile required definitions into located build state through a
   durable idempotent protocol. It cannot be part of D2's SQL transaction in
   schema-per-scope or database-per-scope placement.
7. D4 will own validation evidence and readiness computation. It cannot claim
   target-native population/build readiness before the later authoritative
   entry and sidecar slices. Legacy backfill evidence is conditional, and S04
   alone mutates the active-schema pointer.

D1 output is ephemeral derived evidence. It contains no source-manifest copy,
definition ID, lifecycle, cursor, fence, receipt, or readiness state, and the
trusted publication path compiles its own authenticated manifest rather than
accepting caller-authored compiled evidence. App-schema v1 treats its table list as the
closed app ID-target set plus the existing Convex-compatible `_storage`
intrinsic. Arbitrary undeclared/reserved targets fail closed; Payload, Medusa,
and additional system targets require their own later source-driven contracts.
This is a named Flarex v1 divergence from Convex configurations that permit
tables outside an enforced schema.

Current text `scope_id`/epoch columns are prototype boundary representations.
S06 derives stored native UUID projections for canonical
`scope_<uuid>`/`epoch_<uuid>` authorities and uses the scope projection in hot
replacement row keys. Noncanonical prototype values keep null projections;
replacement access fails closed instead of inventing an unrelated mapping. A
one-time compatibility projection is needed only for proven durable rows.

A schema version is activatable only when its required target-native population,
any evidence-triggered backfill, and validation have succeeded. There is one
authoritative active schema pointer per scope;
deployment metadata may reference it, but must not create a second authority.

S05-B freezes Flarex Value Codec V1 before `jsonb` is used as a complete Flarex
value representation. Its logical runtime domain is null, signed int64 bigint,
all float64 values, booleans, valid-Unicode strings, `ArrayBuffer`, dense arrays,
and plain objects. IDs remain strings. Missing is not a stored value; null is a
value; undefined object fields are omitted; and patch deletion remains a later
journal/compiler operation rather than a value encoding.

The canonical JSON tags are `$integer`, `$float`, and `$bytes`, following the
portable Convex value representation. Flarex adds one narrow `$string` tag only
for valid-Unicode strings containing NUL: PostgreSQL/PGlite `jsonb` rejects the
otherwise valid JSON `\u0000` escape. Other strings remain ordinary JSON
strings, so this divergence does not create a second general string format.
Canonical evidence is a versioned UTF-8 JSON envelope, retained canonical
bytes, and SHA-256; object keys are ASCII-sorted before encoding.

The general-value profile permits at most 32 MiB of Convex-style semantic size
and 64 container levels. The app-document profile applies to the complete
logical document, including trusted system fields, and requires an object of at
most 1 MiB and 16 levels. Both profiles cap arrays at 8,192 items, objects at
1,024 retained fields, and object names at 1,024 non-control ASCII bytes with
`$` reserved. Value Codec V1 does not redefine index ordering: its ordered
adapter must pass through S05-A's canonical ordered-value and 2,048-byte key
checks.

The shared protocol codec, non-versioned public SDK conversion facade, ordered
adapter, golden fixtures, and PGlite `jsonb` evidence are implemented. This
does not add replacement row DDL, adopt the codec in existing validator or
endpoint paths, define patch journals, or route replacement data. S06 owns the
first real row consumer and its focused real-Postgres storage proof.

S06 freezes the replacement row identity without changing the permissive
legacy SDK facade. Document ID V1 is a positive compact table ID plus one
canonical lowercase UUID; the UUID's exact 16 bytes are the physical row
identity and carry no ordering meaning. UUIDv7 generation is not selected by
this contract. Canonical `scope_<uuid>` / `epoch_<uuid>` boundary values receive
derived native UUID projections, while legacy noncanonical text authorities
remain unmapped and cannot access replacement rows.

`fx_app_row_rev` is the sole authoritative row-value history. A live revision
stores the complete Value Codec V1 document, including storage-verified `_id`
and immutable positive finite float64 `_creationTime`, plus canonical bytes and
SHA-256. A tombstone is a distinct revision state whose value JSON, canonical
bytes, and hash are SQL `NULL`; it is never represented by encoded Flarex null.
`fx_app_row_current` stores only an epoch-independent pointer protected by a
foreign key to one exact revision. Epoch on a revision is write provenance, not
part of row identity or a visibility predicate. S06 supplies storage history
and caller-transaction primitives. Completed O04 adds the private semantic
point reader: one full `SnapshotToken` plus branded table/row identity selects
the newest verified revision at or before the token's commit sequence. A live
revision returns the canonical document plus a present dependency carrying its
revision sequence. No visible revision and a visible tombstone both return
developer-facing `null`, while the missing dependency distinguishes
never-visible history from a tombstone and retains the tombstone sequence.
This qualified absence is internal OCC evidence, not a public storage state.

O04 uses revision history as the only row-value and visibility source. It first
performs one unlocked scope-clock lookup to validate the scope-to-native-UUID
projection, but acquires no scope/session lock, performs no wall-clock
comparison, and is not continuing attempt authorization. C03 first composes it
with fresh exact-attempt validation and staged read-your-writes; O05 owns pure
conflict decisions. Commit allocation, publication, and retention remain with
their later focused gates. Before O11 removes history, the retained floor must
be checked so compacted history cannot be returned as ordinary absence.
`fx_app_row_current` may be introduced as a read optimization only after
equivalence with the authoritative history lookup is proven.

## App Rows, Indexes, Edges, And Retention

For app/CMS content, the typed row body is authoritative. Index, edge, block,
and unique-key rows are trusted, deterministic products of that body and the
pinned catalog. They are written in the same commit and are never accepted as
physical facts from untrusted user code.

Every relation occurrence needs a stable identity. Repeated targets, localized
fields, and nested block paths cannot be keyed only by source and target:

```text
edge_id / occurrence_key = hash(
  relation_id,
  source row,
  stable nested item or block id,
  field path,
  locale,
  occurrence identity
)
```

Mutable list position is stored for ordering, not used as the occurrence
identity. Block metadata keys include locale.

Engine revision retention must account for active mutation snapshots and,
later, reconnect cursors. These are separate authorities with separate
consumers.

S07 adds only the current-attempt snapshot lease:

```text
scope_uuid
session_id
attempt_fence
snapshot_epoch_uuid
snapshot_commit_seq
lease_expires_at
```

There is at most one lease per scope/session. Every lease is a constrained
projection of the session's exact current attempt: its scope, session, and
attempt fence reference that current attempt. It does not duplicate storage
generation, package, schema, policy, grant, or request authority; those remain
on the session anchor. Plain relational DDL cannot require every active parent
to have a child lease, so that exactly-one-active-lease invariant belongs to
O03-B's atomic activation operation.

O03-B owns atomic anchor/lease creation, exact-fence loading, abort/expiry
terminalization, active-child enforcement, and stale-attempt rejection. Its
required pre-consumer core is divided into O03-B1 atomic activation/exact
active-anchor replay, O03-B2a restart-safe exact-attempt reload, and O03-B2b1
exact abort/expiry terminalization with first-terminal-wins observation. A live
abort records `aborted`; once database time reaches the earliest lease,
hard, or grant expiry, abort and expiry canonically record `expired`. Restart-
safe expiry uses the strict inert exact-attempt selector because live-only B2a
loading correctly refuses expired authority. O03-B does not predeclare
consumer-specific finish, commit, retry, or retention APIs. O08 introduces
retry replacement when trusted OCC
classification exists: it explicitly deletes the old lease, advances the
parent fence, and inserts the new lease in one transaction. The foreign key
restricts parent updates and deletes while the old lease remains; it does not
cascade an old snapshot into a new attempt. S07 owns only the relational shape
and migration proof.

The previously ordered O03-B2b2 renewal gate is a conditional operational
extension, not an O04/O05 or private C02-C07 prerequisite. Convex bounds one
execution attempt and starts retries with a fresh transaction/snapshot rather
than renewing the old attempt. Flarex may still require renewal because its
execution and Postgres-retention owners are separated, but the first real
runtime or retention consumer must prove that a bounded attempt can outlive its
initial lease before that divergence is implemented. That preflight must freeze
the maximum attempt deadline, initial lease relationship, renewal owner and
signal, cadence, jitter/failure and restart allowance, and GC safety margin. If
the initial lease can cover the bounded attempt plus safety margin, O03-B2b2 is
retired without implementation.

GC initially uses the minimum active snapshot-lease floor plus a safety margin
for row, index, edge, commit, and sync change-feed history. Payload user-visible
versions are product data and are not deleted by engine-history GC. Outbox
retention remains separate.

Reconnect retention is a later sync-owned contract, not part of S07. Roadmap 21
must first freeze its identity, duration, history budget, renewal, expiry, and
reset semantics, then introduce its physical lease immediately before O11
consumes reconnect floors or replacement sync admits reconnectable sessions.
A cursor from another epoch or below the retained floor receives an explicit
reset/resnapshot response; partial replay is never presented as complete.

## One Snapshot Token

Do not mix wall-clock time, a global sequence, a row version, and a scope-local
commit cursor. The authoritative token is:

```ts
type SnapshotToken = {
  scopeId: ScopeId;
  epoch: ScopeEpoch;
  commitSeq: CommitSeq;
};
```

Postgres issues the token from the scope clock. Mutation reads mean exactly:

```text
authoritative data as of SnapshotToken
+ the attempt's supported staged-write overlay
```

A cache value produced at commit 105 is not valid for a mutation snapshot at
commit 100 merely because `105 >= 100`. V1 mutation/session reads therefore use
Postgres history. A future cache may serve a mutation only when it can return an
MVCC version valid at the exact snapshot and prove missing rows/ranges.

Live-query freshness is different. A full result may be published from a
snapshot at or after `requiredFreshThrough`, provided the whole result is
snapshot-consistent and the dependency token has been advanced through a
contiguous commit feed.

Epoch rollover is a fencing discontinuity, not a data reset. It invalidates old
sessions and forces clients/subscriptions to resnapshot. Scope-local commit and
outbox sequences remain strictly monotonic and are never reset or reused, so
untouched rows and uniqueness constraints remain valid. Revision, commit,
change, snapshot-lease, outbox, and cursor records still carry epoch wherever a
token is interpreted; an old-epoch session cannot commit even if its sequence
is numerically earlier.
Epoch on a persisted row/change is write provenance, not a filter that hides
untouched data after rollover. Current-row and uniqueness keys remain
epoch-independent.

## Commit Feed Authority

S08 introduces the first target-native commit-feed storage and bounded private
reader. A scope-local commit header is keyed by native `(scope_uuid,
commit_seq)`, carries its write `epoch_uuid`, exact typed-app-row
`change_count`, and finite database-owned `committed_at`, and exposes a unique
`(scope_uuid, epoch_uuid, commit_seq)` projection for its children. Sequence is
the feed order; timestamp is metadata only. O07-B allocates a zero-child header
for every successful point mutation with no material row intent because the
successful result receipt and wake still require one dense immutable commit
token.

Each `fx_system_commit_app_row_change` child is an ordered pointer to one
authoritative app-row revision, not a generic JSON summary or duplicated
operation. Its foreign keys prove both the exact commit epoch and the exact row
revision write epoch. The row-revision table therefore exposes the narrow
unique epoch-provenance projection required for this physical invariant. A
child cannot associate a header from one epoch with a revision written in
another epoch, even if later transaction code is defective.

The package-private S08 `listAfter` reader captures the authoritative scope
clock, inert retained-history floor, headers, and children in one read-only
repeatable-read snapshot. It returns the largest contiguous whole-commit
prefix after an exclusive cursor, bounded by 100 headers and 16,000 total
children, plus an explicit continuation fact. It strictly correlates header
counts, child ordinals, scope/epoch/revision provenance, and the captured
clock. A missing interior or tail header is corruption, never end-of-feed, and
`last_commit_seq` must never advance without the corresponding header in the
same publication transaction.

S08 gives `oldest_available_commit_seq` a physical home but no writer. It must
remain `0`, and the S08 reader fails closed if it observes any nonzero value.
O11 later owns retention advancement and deletion ordering; roadmap 21 owns
reconnect/reset policy. S08 does not infer either policy from the floor column.

## Commit Compiler Trust Boundary

The compiler is a pure lowering boundary, not a new authority:

```text
SessionJournalV1
  local read dependencies and logical app operations

SuccessfulResultEvidenceV1
  separate canonical Value Codec result bytes and digest

CommitEnvelopeV1
  session id, attempt fence, protocol versions, final syscall sequence,
  journal carriage and digest, sibling successful-result evidence

AuthenticatedStoredAttemptV1 (introduced by C04A)
  runtime-unforgeable process-local proof of the exact Postgres-stored seal

AuthenticatedCommitAuthorityV1 (introduced by C04B1)
  same-factory proof of current argument, grant, revocation, pinned schema,
  and immutable proof-only function metadata

VerifiedCommitInput (introduced by C04B2)
  same-factory private-C07 proof of authenticated logical evidence plus pinned
  proof-validator facts; not production activation authority

PointCommitPlannerV1 (introduced by C04C1)
  same-factory database-free logical point/dependency lowering

PreparedPointCommitV1 (introduced by C04C1)
  process-local authenticated dependencies, successful result, and at most one
  final logical row intent; it contains no SQL or publication authority

Conditional physical lowering (C04C2)
  introduced only if the first S08/S09-A/S09-B/O06/O07-B consumers prove that a
  distinct physical/change/outbox lowering capability is useful

O06 point-commit transaction kernel
  executor-owned same-factory capability unwrapping; a detached closed
  persistence command; READ COMMITTED clock/session/lease/sealed-root locking;
  fresh scalar authority revalidation; authoritative point-head loading and
  O05 validation; tentative physical revision/current lowering; and an exact
  forced-rollback proof. It exposes no tentative sequence or published state.

O07-A committed-outcome resolver
  validates and copies a closed structural lookup record that is not itself
  authority; captures the outcome, clock/floor, and optional exact header in
  one statement; and verifies bounded canonical result evidence after SQL

O07-B CommitExecutor
  reuses and extends the O06 kernel with sequence/time allocation, durable
  physical revision/current writes, idempotency outcome, commit/change records,
  freshness atoms, outbox, lease deletion, committed session state, and clock
  advance; O09 later owns multi-row/unique ordering
```

S07 implements a small located Postgres transaction-session anchor containing:

```text
native scope UUID and native UUID session identity
immutable flarexdb_v1 generation and positive generation fence
immutable package, dynamic-worker artifact, source hash, execution module,
  mutation function path/kind, schema version, and policy version
canonical validated-argument JSON, Value Codec V1 bytes, and SHA-256
cryptographic identity/access-policy SHA-256 for matching only
authorization grant identity, canonical grant JSON and Value Codec V1 bytes,
  SHA-256, expiry, and nonnegative revocation epoch
nonblank internal request key bounded to 1,024 UTF-8 bytes for its PostgreSQL
  lookup index, and canonical request SHA-256
lifecycle, current positive attempt fence, protocol version 1, hard expiry,
  and creation/update timestamps
```

The canonical grant evidence contains the minimized authenticated inert claims
and allowed capabilities needed for trusted revalidation. The identity/policy
digest alone never authorizes an operation, and the compatibility FNV identity
fingerprint is not persisted as replacement authority. Package, artifact,
schema, and policy identifiers are trusted copied pins verified before
creation; split placement cannot enforce physical foreign keys to control-plane
rows.

O03-A introduces the missing transaction-grant authority before session
activation. A trusted backend issuer receives an internal `VerifiedAuthContext`
that retains upstream credential expiry and authenticated-provider evidence,
applies an explicit claim allowlist, and produces a strict versioned
self-contained signed grant. Policy version and capabilities come separately
from trusted policy/catalog authority; an authentication result cannot select
its own policy. The grant's domain-separated canonical evidence binds the
scope, execution pins, canonical argument and request identity/evidence,
bounded capabilities, minimized claims, issue/expiry times, and revocation
epoch. When an originating credential has an expiry, grant expiry cannot exceed
it; every grant also obeys the configured platform/session lifetime. Issuer key
custody remains outside the artifact/Dynamic Worker; the executor receives
verification/key-resolution capability only. The accepted first O03-A
checkpoint freezes a strict flattened JWS envelope with fixed `Ed25519`, exact
canonical protected-header and Value Codec V1 payload bytes, bounded inert
evidence, and exact-request retry semantics. It creates no verified authority.
Authority integration is an accepted three-checkpoint sequence without changing
the transaction-grant V1 format, storage generation, or product version. O03-A2a
first preserves backend-private verified-authentication provenance: verified
bearer context retains issuer, subject, credential expiry, and matched-provider/
config evidence; anonymous provenance remains distinct; the initial grant-facing
custom-claim allowlist is empty; and `ExecutionIdentity`/`ctx.auth` remains the
compatibility projection. The trusted dev/test identity path remains
compatibility-only until separately named principal and bounded-expiry semantics
are accepted; it cannot masquerade as verified bearer authority or mint a grant.
The A2a handle proves historical bearer verification only. Issuance must recheck
current time, active provider/config membership, and trusted policy; the handle
contains no scope, policy, capability, signing, or transaction authority.
O03-A2b then owns host-neutral trusted point-policy, issuance/signing,
verification, and key rotation/disablement. Its initial accepted policy is
exactly `policy_point_mutation_v1`: anonymous and verified-bearer auth, empty
custom claims, and canonical `db:get`, `db:insert`, `db:patch`, `db:replace`,
and `db:delete` capabilities; trusted-dev identity cannot mint or verify as
grant authority. The identity/access-policy digest is SHA-256 over the Value
Codec V1 canonical value `{ format: "flarex.identity-access-policy", version:
1, policyVersion, auth, capabilities }`, independently derived by the issuer and
recomputed by the verifier. Lifetime and future-skew limits are explicit
immutable configuration, exact credential expiry caps grant expiry, and neither
the A1 five-minute fixture nor JWT verification leeway is a grant default.

The host-neutral keyring has exactly one active signer plus optional
verification-only overlap, immediate disabled-key rejection, immutable
non-reused key IDs, and issue/verification windows. The backend receives a
signing capability rather than private bytes and never accepts caller-selected
policy, capabilities, digest, time, grant ID, or key ID. The executor selects an
independent deployment key namespace, verifies the exact `kid` and Ed25519
signature, checks time/policy/logical pins, and returns only a process-local
opaque capability.

O03-A2c completes exactly two private boundaries before O03-B: the already
implemented located-current-revocation-epoch admission and schema-neutral,
two-sided point-mutation preparation. The backend and executor each perform an
independent trusted metadata and scope-epoch read. Each validates deployment,
scope, package, artifact/source identity, schema, exact function path, mutation
kind, public visibility, arguments, and the server-prepared request key before
returning its own unforgeable process-local handle. No caller may supply
structural prepared facts. Signature and exact-pin verification retain the
executor-prepared handle, and a fresh current-epoch read produces the final
opaque prepared-start capability consumed by O03-B; O03-B still rechecks epoch
and located storage generation/fence inside activation.

The A2c preparation implementation is deliberately schema-neutral and
test-generation-only. Its private tests use immutable setup-seeded metadata
adapters, persist nothing, add no DDL or active pointer, and fail closed for
absent, inactive, or corrupt metadata. It may not bridge DeploymentDO, legacy
`prepareInvoke`, numeric prototype schema authority, or partition routing.
`validatedArgsSha256` is SHA-256 over Value Codec V1 canonical validated
arguments. `requestSha256` is SHA-256 over the Value Codec V1 canonical value
`{ format: "flarex.point-mutation-request", version: 1, deploymentId,
functionPath, functionKind: "mutation", validatedArgsSha256, requestKey }`.
Auth, policy, revocation epoch, time, and signing-key data remain separate grant
pins.

Both trusted preparers reject arguments before activation when Convex's
implicit outer argument array would exceed 16 MiB: the exact charged size is
`2 + argumentSemanticBytes`. C04B1 independently reapplies the same rule to
the stored argument evidence; this is a transaction semantic, not a transport
limit.

Production preparation is a later adapter owned jointly by roadmap 17 and
S03-D4/S04. It must read one coherent active package, artifact/source,
function-validator, and schema snapshot with an activation revision or fence;
S04's `active_schema_version_id` is schema authority only and is not by itself a
package/function authority. The physical representation and any DDL require a
fresh preflight. The checked revocation command moves to its first operational
or admin consumer, and backend Worker/key/binding adapters move to their first
hosted-production consumer. Those gates do not block O03-B, O04/O05, or the
private C02-C07 proof.

Until that production snapshot exists, C04B1 may reuse the immutable
setup-seeded metadata only as a temporary proof adapter. Its sole consumer is
the private C07 proof; its reason is deferred production activation-snapshot
authority; and roadmap 17 plus S03-D4/S04 publishing one coherent package,
artifact/source, function-validator, and schema snapshot is its mandatory
deletion/replacement gate. It is unreachable from production selection and
cannot consult `activePackageId`, `analysisJson`, or the mutable active-schema
pointer.

C04B2 is the private consumer of that already-authenticated proof metadata. It
performs no database, clock, catalog, active-pointer, or metadata lookup and
cannot promote the adapter into production authority. This private proof
validates complete final overlay documents and the successful result after
execution. Convex normally validates write values at syscall time, so catchable
validator failures are not yet behaviorally equivalent. The later production
activation preflight must decide whether a narrow validator capability moves
into C03 to restore syscall-time validation and catchability while keeping the
coherent activation-fenced schema/function-validator snapshot in Wave 4.

The narrow schema prerequisite S07-A first adds one nonnegative scope-wide
`authorization_revocation_epoch` to the located data-plane scope clock. O03-A
then consumes that authority: a V1 bump conservatively invalidates every
outstanding scope grant. Session activation and commit compare exact equality
against the current authority in their short transactions; any later consumer-
approved renewal must do the same.
There is no per-grant database or premature per-policy epoch registry; those
require a proven independent consumer before changing the V1 authority model.

The anchor owns request-level authority. Its current-attempt snapshot token is
stored only in the constrained snapshot-lease row, avoiding two independent
snapshot or generation authorities. S07 defines these two physical rows.
S07-A supplies current revocation storage, O03-A supplies signed-grant
semantics, O03-B1 owns atomic activation/exact active-anchor replay, O03-B2a
owns restart-safe exact-attempt reload, and O03-B2b1 owns exact-fence
abort/expiry terminalization and active-child enforcement.

O03-B1 generates a canonical native UUID session identity inside the trusted
executor boundary. Under the scope-clock lock, no matching request creates one
`running` fence-1 anchor and lease; one byte-exact matching live `running`
anchor returns unchanged, including its stored snapshot and timestamps.
Changed evidence, multiple matches, stale authority, a missing or expired
lease, or a non-`running` anchor fails closed. This is a logical
one-anchor-per-request invariant under the authoritative lock, not a physical
uniqueness claim and not O07-A committed-result lookup. V1 session hard expiry is
the already platform-bounded verified-grant expiry. Initial lease expiry is
`min(databaseNow + configuredLeaseDuration, hardExpiry)` using one post-lock
database timestamp and must be strictly in the future; exact replay never
extends it. The same activation transaction creates the exact fence-1 C03
journal root with that trusted database timestamp as both its creation-time
seed and cursor. A running attempt without exactly one matching root is corrupt;
abort or expiry deletes the root and its cascading temporary evidence before
deleting the lease and terminalizing the session. O08 must create the next root
atomically with every future attempt-fence/lease replacement.

O03-B2a serializes only deployment, asserted scope, session, and canonical
positive signed-int64 attempt-fence text. The asserted scope is an identity
check rather than placement authority. Each load resolves placement again,
locks scope clock then exact session then exact lease, captures database time
after those locks, and validates current authority and liveness without
mutating authoritative rows. Its fresh process-local capability records the
verified selector and pinned snapshot at that linearization point. B2b
terminalization revalidates in its own transaction. O04 is intentionally a pure
snapshot-read kernel rather than an authorization consumer; C03 must freshly
validate the exact attempt when it first exposes O04 semantics as a syscall.

C02 owns only the strict logical journal/result/envelope representation,
canonical encoding, final-sequence fields, integrity digests, and execution
limit constants. C03 is the first operational owner: it freshly authenticates
the exact Postgres session attempt, enforces monotonic append order and
incremental limits, rejects late syscalls, and stores the exact sealed journal
and sibling successful-result evidence for that attempt.

C03A gives that point consumer only an opaque pinned-table capability. It
resolves `(deploymentId, schemaVersionId, tableName)` from the immutable pinned
manifest, where membership and declared table ID are authoritative, and checks
the stable deployment binding only as corroboration. It never reads the mutable
active-schema pointer. C04B1 owns the broader pinned schema/binding
reauthentication, while C04B2 owns final value/return validation.

C03 persists four exact-attempt tables: one bounded root, one replace-in-place
latest receipt, at most 4,096 qualified point dependencies with deterministic
same-row overlay state, and at most 16,000 ordered material-write events. For
the latest sequence only, exact canonical request bytes replay the exact typed
outcome; different bytes conflict, lower sequences are stale, and values above
`last + 1` are gaps. The executor serializes calls per attempt, so a lost
response for `N` must be recovered before `N + 1` can enter. Catchable missing
or no-op outcomes advance and replace the receipt without growing row
cardinality, while incremental resource-limit failures remain sticky until
lifecycle cleanup.

The root separately accounts the exact canonical bytes of persisted material-
write events and caps their cumulative temporary evidence at 64 MiB. This is a
Flarex storage-amplification guard, not a Convex transaction semantic, final-
journal substitute, lease, or hosted transport promise. Each successful
material write is strictly normalized and canonicalized once; that detached
evidence is charged before any point, event, receipt, or root mutation and is
the evidence inserted into the event row. A no-op or catchable failure creates
no event and consumes no event-evidence bytes. An event that would exceed the
cap advances the accepted sequence into the sticky failed state and stores its
exact failure receipt without changing the point overlay, event table, or the
prior in-range byte counter.

Insert identity is server-only UUIDv4 generated exactly once after replay
classification. Live or historical-tombstone collision fails closed and
replays without another ID. Each attempt seeds `_creationTime` from database
time; every insert consumes the current binary64 value and advances the cursor
with exact `nextUp`, atomically with the accepted receipt, including rejected
post-allocation inserts. Host/user wall-clock values are never accepted.

Sealing first takes a read-only repeatable-read snapshot of at most each child
limit plus one, detached raw row evidence, counters, and the latest receipt,
then closes that SQL transaction. Excess cardinality is rejected before child
decoding. Outside SQL, C03 strictly decodes the children, recomputes cumulative
material-event bytes against the root counter, constructs an independent
private candidate, and validates canonical journal/result encoding and
SHA-256. Caller-visible preparation and result evidence are defensive copies.
A short exact-attempt transaction finally revalidates the candidate and stores
the sealed evidence; stale candidates fail rather than widening lock scope.
C04A reloads that trusted stored evidence through a fresh opaque server-
authority capability, rejects inline carriage before database work, and
compares canonical bytes, journal digest, final sequence, result evidence,
point evidence, and the complete scalar seal identity. It accepts only a live
`running + sealed` attempt for initial planning or `finishing + sealed` for
reconstruction, and returns a runtime-unforgeable process-local
`AuthenticatedStoredAttemptV1`. A committed observation is typed as already
committed and non-plannable; O07-A owns lookup and C06/O08 own its orchestration.
C04B1 extends only that factory-local vault: a genuine same-factory C04A
capability triggers one fresh bounded read-only repeatable-read capture of
stored arguments/grant, current scope revocation and database time, the one
immutable pinned schema artifact, and corroborating stable bindings. It
projects stored lengths before payload selection, transfers JSON as text, and
closes SQL before decoding, canonicalization, SHA-256, Ed25519, or proof-
metadata work. The exact prepared-start grant kernel is shared, but C04B1
cannot manufacture or register a prepared-start handle.

C04B1 returns only private `AuthenticatedCommitAuthorityV1`. Its separate
64 MiB corruption/materialization ceiling charges six stored representations:
argument JSON and canonical bytes, grant JSON and canonical bytes, and pinned-
schema JSON and canonical bytes. This is a Flarex operational resource guard,
not a Convex transaction semantic, hosted transport guarantee, or substitute
for the independent journal limits. C04B2 extends the same factory-local vault:
only a genuine C04B1 capability can trigger zero-I/O validation of complete
live final documents and the recanonicalized successful result against the
already-authenticated pinned proof validators. It mints a frozen, runtime-
unforgeable `VerifiedCommitInputV1` containing logical evidence only. Deletes
and unchanged reads have no final document to validate; unknown or system table
ID targets fail closed. C04C1 then performs database-free deterministic logical
point lowering to private `PreparedPointCommitV1`. It preserves every logical
dependency and at most one net final logical row intent. An insert followed by
delete retains its qualified-missing dependency but collapses to no row intent;
only deletion of a snapshot-present row yields a logical delete intent. The
plan claims no physical rows, SQL lock order, sequence/time, change atoms, or
outbox authority. Any
separate C04C2 physical/change/outbox lowering remains conditional on the first
S08/S09-A/S09-B/O06/O07-B consumers. SHA-256 proves byte integrity only; authenticating the
Postgres session/fence does not authenticate arbitrary inline journal bytes.
C03 seals while the session remains `running`, and that sealed root rejects
later syscalls. C05 later locks and revalidates the detached scalar seal
identity before the exact-fence `running` to `finishing` transition; a recovery
path may rerun C04A from `finishing + sealed`. C06 later orchestrates finish
idempotently through the endpoint.
O07-B atomically deletes the exact current lease and stores committed state with
the server-prepared internal request identity, committed-success result receipt,
committed token, data, feed, and S09-B outbox. Failed or rolled-back executions
create no S09-A outcome. O08 owns retry replacement; O11 first consumes active
floors for history retention.

SessionDO SQLite may hold the read/write journal, but it is temporary. It must
not supply physical scope, table names, lock targets, unique-key rows,
freshness atoms, system outbox rows, actor identity, or schema authority. The
trusted planner derives those from logical writes, the session anchor, the
pinned catalog, and adapter rules.

Through C07 the only operational carriage is `storedForSessionAttempt`: C04A
reloads the exact C03-owned Postgres evidence and rejects an inline carriage
even when its digest matches. C02 may define an `inlineUntrusted` schema variant
for forward compatibility, but it is deliberately dormant and non-consumable.

Only when `C07A` selects the facet-backed path and proves exact supervisor/facet
provenance (or an equivalent non-forgeable host capability) may the dynamically
loaded facet own
that temporary journal in its isolated SQLite database. The supervisor cannot
open or query the facet database directly. After the handler finishes, it asks
the exact current facet through RPC or `fetch` for a bounded sealed envelope
containing canonical journal bytes, separate result evidence, final syscall
sequence, digest, session identity, and attempt fence. The supervisor forwards that
envelope to the trusted executor. The executor does not copy the journal into
Postgres as authoritative data: it revalidates the Postgres anchor and lowers
the logical operations into physical rows, dependencies, commit/change atoms,
idempotency outcome, and outbox work.

Each attempt uses a distinct facet identity bound to the current positive
attempt fence. Commit, abort, expiry, or trusted OCC replacement aborts and
deletes that facet; delayed cleanup cannot reopen a terminal Postgres session.
Facet persistence can preserve a sealed envelope across hibernation, but it
cannot preserve or resume a JavaScript call stack. A crash during handler
execution discards the partial journal, advances the trusted attempt fence,
issues a new exact snapshot, creates a fresh facet, and reruns deterministic
user code. A lost finish response is resolved from the authoritative Postgres
outcome before any rerun.

This journal records syscall sequence, logical read dependencies, supported
staged logical writes, and the bounded final-document overlay required for
read-your-writes. It does not cache or become authority for base application
rows. Base data reads still cross the restricted syscall boundary to the
trusted executor and authoritative Postgres. Moving the journal can remove
Postgres round trips used only to persist this temporary evidence; it does not
remove the service-binding/syscall hop or transfer final commit authority.

Sequence the optimization from evidence: first close the replacement point
mutation's PGlite and real-Postgres correctness gates, then immediately measure
the hosted path with service binding, authoritative data read, journal
persistence, and finish latency separated. Declare the material-improvement
threshold before comparison. If journal persistence meets it, the facet-backed
session move is the next checkpoint before derived index/edge sidecars. Its
proof must compare a custom-binding-only control that retains Postgres
journaling with the supervisor/facet path rather than assuming facets improve
communication by themselves. Otherwise the Postgres-backed journal may remain
permanently. This decision is independent of later `DocCacheDO` and
`QueryCacheDO` work, which mirrors committed values or results and requires a
gap-free freshness protocol.

The trusted boundary validates arguments against the pinned authoritative
argument validator before the attempt runs. It validates the encoded return
value against the pinned return validator before a mutation can commit. Worker
validation is useful feedback but is not the authority.
The short-lived signed authorization grant pins policy semantics through expiry
unless its authoritative scope revocation epoch advances; revocation
invalidates the attempt. The grant encodes scope, function, allowed
operations/capabilities, claims needed by policy, policy version, expiry, and
revocation epoch. Persisted grant bytes or their digest remain inert evidence,
not a bearer capability.

The session lifecycle is explicit and fenced:

```text
atomic activation -> running -> finishing -> committed
                        ^          |
                        |          +-- trusted OCC conflict -> retrying --+
                        +-----------------------------------------------<--+

running or finishing -> aborted | expired
```

The S07 `created` and `committing` literals are reserved for intra-transaction
construction and compatibility. Neither is a durable externally observable
active state in V1: O03-B1 commits the new anchor as `running` with its exact
  current lease. C05's exact-fence transition leaves the durable attempt at
  `finishing`; O06 proves the reusable short transaction kernel only through
  forced rollback, and O07-B either commits the terminal outcome or rolls back to
  that durable `finishing` state.

Requirements:

- C02 defines canonical syscall-sequence fields; C03 owns monotonic operational
  append enforcement, constant-cardinality latest-response replay, raw bounded
  pre-coalescing write events, and trusted read rows/bytes accounting;
- Convex-compatible execution ceilings are 32,000 documents read, 16 MiB of
  document bytes read, 4,096 point-read dependencies, 16,000 user write
  operations before coalescing, 16 MiB of resulting write-document bytes, and
  16 MiB of successful-result semantic bytes. Structurally derivable totals are
  recomputed rather than trusted from an envelope;
- a separate 64 MiB canonical-evidence cap is a Flarex resource/transport
  divergence, not a transaction semantic or a journal-authored lease. C07A must
  re-prove any hosted transport ceiling before inline activation;
- a sibling 64 MiB cumulative material-write-event evidence cap is a C03
  temporary-storage divergence. It is incrementally enforced before mutation,
  recomputed from detached event bytes at seal, and does not replace the final
  canonical-journal cap;
- one fenced attempt owner;
- O03-B1 defines initial activation and exact active-anchor replay; O03-B2a
  defines restart-safe exact-fence load; O03-B2b1 defines abort and expiry;
  O03-B2b2 renewal remains conditional on a proven long-running-attempt
  consumer and is not a prerequisite for bounded private execution;
- C03 sealing is the syscall barrier while the session is still `running`;
  C04A authenticates that stored seal outside the later commit transaction,
  C04B1 reauthenticates current stored argument/grant/revocation/schema facts
  into a second same-factory private capability, and private-proof C04B2
  validates final values/return evidence into `VerifiedCommitInputV1` without
  widening production validator authority; C05 locks and
  revalidates the seal's scalar identity before the private exact-fence
  transition to `finishing`; reconstruction may authenticate the same sealed
  attempt from `finishing`, while C06 owns endpoint orchestration;
- O07-B deletes the exact current lease and enters `committed` only in the atomic
  publication/outcome transaction;
- O08 handles a trusted OCC retry from `finishing` by atomically entering `retrying`,
  incrementing the attempt fence, replacing the snapshot lease, discarding the
  old journal, and returning the same request anchor to `running` without
  changing storage generation;
- canonical journal digest for integrity, never authentication by itself;
- idempotent repeated `finish`;
- O07-A committed-outcome lookup after a lost response, with C06/O08 still
  owning orchestration and retry policy;
- temporary-evidence TTL and sensitive-data cleanup at their owning
  journal/outcome/retention gates. C02 defines no syscall-count, scan-count, or
  lease-time authority.

The first compiler slice supports Flarex app point CRUD and only the query
shapes with a complete overlay implementation. After a relevant staged write,
an unsupported index, relation, scan, Payload, or Medusa read fails closed.
Falling back to Postgres cannot implement read-your-writes because Postgres
cannot see the DO journal.

## Idempotency And Retry Classes

S09-A owns one private committed-success record keyed by
`(scope_uuid, request_key)`. The current `request_key` is the nonblank,
at-most-1,024-UTF-8-byte server-prepared `TransactionRequestKeyV1`; it is not a
public client idempotency namespace. The row binds exact 32-byte identity/access-
policy and canonical-request digests, the exact mutation function path, and an
immutable positive `(epoch_uuid, commit_seq)` receipt.

Every S09-A row denotes a committed success. `available` retains Value Codec V1,
the bounded semantic byte count, canonical successful-result bytes, and their
digest. `expired` clears all result evidence and retains a finite database-owned
expiry timestamp plus the same request match evidence and commit token. There is
no `in_progress` row, error outcome, diagnostic failure, attempt lease, or log
record in this table. Convex likewise records only successful mutations, but the
private C07 proof deliberately retains result evidence without Convex log lines;
public key mapping and log-replay parity require a later activation/API
preflight.

O07-A is the private authoritative lookup primitive for this record. Its
validated/copied closed input is matching evidence, not self-authenticating
commit authority; the production caller must derive it from authenticated
same-factory provenance. One statement captures the outcome, clock, inclusive
retained floor, and optional exact S08 header. It returns `missing`, a matching
`available` result with detached canonical evidence, or a matching `expired`
token without payload; mismatches are typed key-reuse conflicts and malformed
stored evidence is typed corruption. Large canonical decoding and hashing run
only after SQL settles. Old-epoch receipts remain valid, and their epoch is
correlated only with a retained exact header; a missing header is valid only
strictly below a positive retained floor.

O07-B must insert the successful outcome atomically with data, session state,
the S08 commit header, and S09-B outbox evidence. C06/O08 later orchestrate
replay and uncertain-outcome policy. A future retention consumer owns the one-way
`available -> expired` transition.

The immutable commit token deliberately has no foreign key to the compactable
S08 commit header. O07-B proves both in one transaction; O11 may later delete
pre-floor commit/change history without deleting the scope-lifetime receipt or
making its request key reusable. A late retry after payload expiry returns
`CommittedResultExpired` rather than reapplying the mutation. Result-payload,
committed-key, commit-feed, outbox-delivery, reconnect, and Payload-version
retention are separate policies.

S09-B owns one private `deployment_sync_commit_wake_v1` row per committed
scope-local token, keyed by `(scope_uuid, outbox_seq)` and uniquely correlated
to `(scope_uuid, event_kind, commit_seq)`. `last_outbox_seq` remains the sole
scope-lifetime allocation head; S09-B adds no allocator or writer. The row has
only a restrictive scope-clock foreign key. It deliberately has no foreign key
to compactable S08 headers, arbitrary payload, consumer group, generic cursor,
or global surrogate identity. O07-B inserts the exact wake and advances
the clock atomically with the data, result, outcome, and S08 header.

Claims use database time, a monotonic claim fence equal to the attempt count,
bounded retry scheduling, and exact owner/fence settlement. Pending and expired
claimed rows are eligible; delivered and dead-lettered are terminal only for
the current state machine. Failure evidence is a bounded redacted code/summary/
time tuple. Crash after the sink durably accepts but before acknowledgement is
therefore at-least-once: the lease expires, a higher fence reclaims the row,
and the sink deduplicates by the canonical commit token.

Claim-time integrity captures the scope heads, inclusive retained floor,
candidate wake, and retained S08 header in one PostgreSQL statement snapshot.
A missing header is valid only when `commit_seq < oldest_available_commit_seq`;
equality still requires the exact epoch-matching header. Epoch is immutable
write provenance, not an eligibility filter: an old-epoch pending or claimed
wake remains dispatchable after rollover. The deterministic scope sink treats
an old-epoch wake behind its durable cursor as a duplicate and treats a real
epoch discontinuity as a resnapshot boundary.

S09-B defines no GC or redrive API. Pending, claimed, delivered, and dead-
lettered rows remain retained until a later accepted gate freezes consumer
progress, delivery-idempotency retention, dead-letter/operator policy, and safe
deletion. S08 remains canonical recovery authority; an external lag sweep must
still recover a scope even if no wake row is available.

If shipped legacy request keys are discovered, storage-generation cutover must
fence their namespace. Recoverable committed keys are imported with outcomes;
committed keys without a recoverable result become permanent
`LegacyCommittedOutcomeUnavailable` tombstones. An unnamespaced legacy key that
was already GCed or cannot be proven returns `LegacyOutcomeUnknown` and is never
executed after cutover. Under the current clean-replacement declaration there
is no legacy request-key import; target requests start with a server-issued
namespace inside the canonical `request_key`.

Keep three retry classes separate:

1. OCC conflict: discard the journal and rerun user code at a new snapshot.
2. SQL serialization/deadlock before a known decision: retry the same
   deterministic physical plan within a bound.
3. Uncertain connection outcome: look up the idempotency/session result before
   rerunning anything.

All authoritative writers, including migrations, backfills, admin tools,
Payload, and Medusa adapters, must acquire the scope-clock/commit-lane lock or
use a formally equivalent serializable/fencing protocol that participates in
the same conflict validation. Merely writing version/commit/outbox metadata is
not equivalent because a writer could otherwise commit between another
transaction's validation and publication. Bypassing the lane breaks OCC and
sync.

## Payload Boundary

Do not infer the Payload contract from a few handwritten tables. Derive it from
`BaseDatabaseAdapter`, sanitized internal collections, transaction behavior,
and adapter conformance tests.

V1 starts with reserved logical Payload collections over the app row store for
scalar CRUD and request transactions. Later slices add:

```text
relationships and uploads
collection and global versions/drafts
polymorphic document locks and auth owners
preferences, migrations, jobs, and query presets as enabled
access policy and hook ordering
```

Dedicated physical `fx_payload_*` tables are allowed only after parity or
measured performance justifies them. Payload request transactions use a
Payload-owned adapter lane until every required read/write overlay is proven;
they are not automatically compiled by the generic SessionDO journal.

## Medusa Boundary

Medusa schema input is not DML alone:

```text
DML models
+ ModuleJoinerConfig and link schema
+ ModuleMigrationAdapter history, including backfills/triggers
+ custom repository/provider capability declarations
```

Medusa keeps a trusted, short Postgres transaction lane behind its existing
repository, transaction-manager, module, and workflow boundaries. That
transaction also writes Flarex commit/change atoms and outbox records before it
commits. Flarex-native workflow tables must not be claimed as a lossless Medusa
workflow store; Medusa workflow persistence is compiled from its own model or
handled by an adapter-specific schema.

There is no automatic global transaction across `ctx.db` and `ctx.commerce`.
If extension state must be atomic with a commerce invariant, expose the whole
operation through a Medusa-owned facade/workflow and let that lane own the
transaction. Display/custom app state normally references stable commerce IDs
and follows commerce changes through the transactional outbox.

## V1 Sync Engine

Use the smallest topology that can prove correctness:

```text
Postgres per scope
  epoch + scope-monotonic commit_seq
  canonical commit/change feed
  authoritative data and history
  conservative fenced sync-checkpoint mirror for external sweep

DeploymentSyncDO per scope
  durable SQLite appliedThrough cursor
  canonical query definitions
  dependency -> query index
  dirtyThrough, runningAt, generation, and bounded rerun state

ConnectionDO
  WebSocket/session attachment
  client query set and auth/version metadata
  ordered transitions
```

### Conditional Future Facet-To-Sync Flow

The following is a future composition diagram only. It does not describe the
current implemented runtime and does not change the foundation execution order.
The facet-backed session path remains conditional `C07A` work after the
Postgres-backed `C02` through `C07` proof, and the per-scope `DeploymentSyncDO`
replacement remains separately unimplemented. Neither is the immediate next
foundation gate.

If both future paths are selected and proven, the joined flow is:

```text
artifact-runtime Worker
  -> per-session supervisor Durable Object
  -> per-attempt dynamic invocation facet
  -> sealed logical journal/result envelope
  -> trusted executor verification, planning, OCC, and commit
  -> one authoritative Postgres transaction
       data/revisions + result/idempotency outcome
       commit/change feed + transactional wake/outbox evidence
  -> executor-host post-commit dispatcher sends a best-effort direct wake
  -> deterministic DeploymentSyncDO for the committed scope
  -> contiguous Postgres commit-feed catch-up
  -> affected canonical queries rerun through the active artifact runtime
  -> changed results delivered through ConnectionDO
```

The artifact-runtime Worker, session supervisor, and facet never originate an
authoritative "committed" notification. They cannot know that the Postgres
transaction committed merely because user code returned or a finish request
was sent. The trusted executor transaction records the canonical commit/change
and durable wake/outbox evidence atomically; only its post-commit host boundary
may send the low-latency direct wake. Conversely, the sync engine may later use
the active artifact runtime to rerun invalidated queries. Losing that direct
wake is safe because the durable sweep and contiguous Postgres feed recover it.

Direct wake is a latency hint. A queue, cron, or executor-side durable sweep
must wake every scope whose sync cursor trails the latest committed sequence.
The DeploymentSyncDO advances only through a contiguous feed. Receiving commit
`N > appliedThrough + 1` forces Postgres catch-up for the missing interval.

Initial subscription uses two-phase activation:

1. Register a provisional canonical query and cursor in DeploymentSyncDO.
2. Execute at a known snapshot.
3. Install/refine the DeploymentSyncDO dependency set.
4. Replay/refresh through the current contiguous cursor.
5. Mark the generation active and publish only if the token remains valid;
   otherwise rerun. Removal is idempotent in the same coordination authority.

This closes the execute-before-register missed-commit race.

Canonical query identity includes:

```text
scope
scope epoch
active package hash
schema and policy version
function/component path
canonical arguments
identity/access-policy fingerprint
```

The legacy Postgres live-query registry is a behavioral test input, not a
required target migration layer. DeploymentSyncDO SQLite owns the target
canonical-query, dependency, and cursor coordination state. A fenced Postgres
cursor is a conservative operational mirror updated only after the DO commits
its local cursor; it may lag but must never lead. The external sweep reads the
mirror, so lag produces harmless duplicate wakes. Hibernation, reconnect,
replay, and explicit state-loss/reset tests must pass before the legacy registry
is removed; the proof does not require dual registration in a running product.

`VersionDO`, `DocCacheDO`, and `QueryCacheDO` are later measured optimizations.
They are not part of the v1 correctness proof.

## Executable First Slices

The executor-ready, turn-by-turn form of these slices is maintained in
[`../roadmaps/flarexdb-foundation/README.md`](../roadmaps/flarexdb-foundation/README.md),
with separate schema/migration, OCC/transaction, and commit-compiler plans.
That index interleaves the three domains around one vertical app-data proof; it
does not authorize completing the whole physical schema before exercising its
snapshot and commit semantics.

1. Introduce one scope/epoch/commit-sequence token in the existing executor.
2. Add stable catalog identities plus immutable versioned definitions.
3. Build app row revision/current, index revision/current, edge occurrence, and
   unique-key storage behind a trusted activation fence.
4. Prove point CRUD, exact-snapshot OCC, result-bearing idempotency, and atomic
   commit/outbox on PGlite and real Postgres.
5. Prove one indexed live query with two-phase activation and lost-wake
   recovery through a per-scope DeploymentSyncDO.
6. Add a small Payload scalar adapter slice.
7. Add one small Medusa module through its real repository, migration, link,
   workflow, and transaction boundaries.

Do not start by replacing every current table or by implementing all cache DOs.

## Required Correctness Gates

- duplicate `finish`, lost commit response, DO restart, expired/stale attempt;
- same idempotency key with different identity/function/arguments;
- mutation at snapshot 100 while a cache contains a value from 103;
- unsupported read after a relevant staged write;
- row, index-range, edge, insert/delete, and pagination phantom conflicts;
- real PostgreSQL serialization and deadlock behavior;
- commit between initial query execution and registration;
- duplicate, reversed, and gapped commit delivery;
- lost direct wake before a delivery row exists;
- concurrent reruns of one query and simultaneous work for two scopes;
- package activation and identity/policy change against cached queries;
- ConnectionDO and DeploymentSyncDO eviction/hibernation/reconnect recovery;
- unchanged Payload and Medusa adapter/module tests for each claimed feature.

## Provenance

Convex-first references inspected for the design:

- `../../../crates/database/src/committer.rs`
  - validate reads before publishing writes and commit metadata.
- `../../../crates/database/src/transaction.rs`
  - transaction-local reads/writes and read-your-writes behavior.
- `../../../crates/database/src/subscription.rs`
  - dependency refresh against committed writes.
- `../../../crates/sync/src/worker.rs`
  - query tokens, subscription activation, rerun, and ordered publication.

Current Flarex implementation evidence:

- `packages/persistence-postgres/src/schema.ts`
  - current document/index, invoke-session, subscription, and outbox baseline.
- `packages/executor/src/sessions.ts`
  - current session finish, commit, and best-effort post-commit wake boundary.
- `packages/flarex-backend/src/connectionDO.ts`
  - current query execution followed by registration, which exposes the
    activation race.
- `packages/flarex-backend/src/schedulerRoutes.ts` and `schedulerDO.ts`
  - current global scheduler routing and singleton pending/rerun state.
- `packages/flarex-backend/src/worker.ts`
  - current scheduled recovery coverage.

Adapter contract references inspected:

- Payload `packages/payload/src/database/types.ts` and Drizzle transaction,
  version, draft, and lock implementations.
- Medusa DML, repository service, `ModuleJoinerConfig`, migration adapter, link
  migration, and workflow execution models in the local Medusa fork.

## Remaining Risks

The accepted direction is still not a proven database. The largest open risks
are shared-table bloat and isolation, precise range OCC, ordered-key/value codec
compatibility, snapshot-retention cost, Medusa adapter parity, Payload lifecycle
parity, per-scope sync hot spots, and operational recovery under real Postgres
and Cloudflare eviction. Each must be closed by a narrow vertical slice and a
compatibility test, not by expanding the design promise.
