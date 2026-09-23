# Shared Candidate Admission

Status: implemented private candidate admission; serving cutover remains unready. This is the admission-only part of
[GLS2](./README.md), within the [approved preflight](./01-schema-composition-preflight.md).
It does not complete shared commerce storage, serving activation or migrations.

## Owners And Authentication

[The private Medusa integration composer](../../packages/medusa-adapter/src/schemaComposition.ts)
loads the Application candidate through the authenticated analysis repository.
The repository checks scope authority and the immutable analysis/source binding.
The composer invokes Payload's native collection compiler and the complete
pinned Product compiler. Configuration supplies collection inputs, explicit
read-only view bindings and deployment-authorized dependency declarations; it
cannot supply a replacement Product schema or claim framework producer hashes.
No HTTP or application execution route exposes this construction capability.
The composer detaches authority coordinates and captures the repository method
and receiver at construction; asynchronous compilation cannot change its target.

[The protocol contract](../../packages/flarex-protocol/src/logical-schema-candidate.ts)
owns qualified identities, definition/reference distinction and graph checks.
Document validators, ordered indexes and native relation declarations retain
their existing protocol owners. The complete relational definition grammar,
normalizer and stored-definition reconstruction now live in protocol; physical
artifacts no longer own these pure semantics. Product retains all thirteen
tables, including its three implicit pair-key pivots, predicates, enum/FK
constraints, defaults and capability requirements.

[Analysis preparation](../../packages/analysis/src/logicalSchemaCandidate.ts)
checks the complete producer-frame digests and detaches immutable candidates.
Digest verification proves integrity, not native provenance by itself. The
trusted backend's source loading/compilation is essential; the preparation
function is not an untrusted schema-upload API. Copied preparation handles are
refused. Inspecting persisted metadata does not issue a serving handle.

One Payload binding can reference an existing Application table, with compatible
fields and unchanged Application write authority. It allocates no table ID and
installs no rows, index or relation. Additional view relationships/indexes are
refused pending their explicit capability. Dependency extensions record exact
qualified field endpoints and their originating source; they do not modify a
native Product model or prove executable traversal/constraint enforcement.
Extensions explicitly select `strongReference`; they are not native Module Links.
Application ID fields resolve their declared target through producer bindings,
so two different table IDs are not interchangeable merely because both are IDs.
Non-global Application placement is explicitly refused until typed partition and
colocation requirements are supported; it must never disappear in projection.

The relational grammar retains the pinned native types, predicates and constraints.
It is not a complete execution comparison contract: collation, exact ordered
numeric keys and unique-null enforcement remain unready under the
[query/constraint contract](./02-query-and-constraint-acceptance.md). No reader may
infer those capabilities from this candidate or silently choose an ordered codec.

## Catalog And Stored Data Diff

[Admission](../../packages/persistence-postgres/src/logicalSchemaAdmission.ts)
reuses `fx_control_table` and `fx_control_schema_version`. **There are no SQL
table, column, constraint or FK changes in this slice.** Existing rows, active
heads, histories and framework installation metadata are not rewritten or reset.

The new schema-version manifest is an explicit `logicalSchemaAdmission` envelope
containing the `logicalSchemaCandidate` graph and resolved catalog table IDs.
The existing canonical manifest codec remains responsible for JSON/bytes/digest
agreement and exact artifact replay. This is a new semantic kind, not a new
interpretation of existing Application or framework artifact bytes. Neither
an Application manifest decoder nor a commerce profile accepts it as serving
authority. Existing version/ID conflicts reject; identical admissions converge.

The catalog transaction locks the deployment, verifies/locks its scope binding,
reuses the stable table allocator and persists one immutable schema artifact.
Compilation and native source loading finish before SQL. Bounded owned metadata
encoding/digest work occurs during admission after IDs resolve. The existing
control settlement/recovery implementation has moved to
[catalogControlSession](../../packages/persistence-postgres/src/catalogControlSession.ts);
both framework artifact admission and shared candidates use it. There is no
new journal, allocator, transaction/recovery implementation or active head.

New admissions check retained schema evidence under the same deployment lock.
Prior shared definitions cannot change producer owner or write profile through
another version or by omitting and later reintroducing a table. Existing ordinary
Application schema artifacts cannot be claimed by a framework. Bound V3 Payload
policy evidence is authenticated by its existing binding reader and refused as
an unsupported baseline: its ownership cutover requires a connected core slice.
This conservative refusal includes inactive V3 bindings. It avoids copying the
active ownership engine or assuming the control database also holds data-plane
state. It does not certify activation, data conversion or current write authority.

This first control-plane check bounds resulting retained history, including the
new artifact, to 64 artifacts/16 MiB; overflow refuses new admission atomically.
It is not an ordinary query/request-path scan.
Exact immutable replay verifies its own evidence without replaying history or
reclassifying a later ownership baseline. Future readiness must independently
revalidate current authority. The Application ownership-history reader validates
candidate envelopes and excludes them from previously writable tables. Candidate
integrity reads have a separate bounded metadata allowance; they cannot consume
the unchanged 1 MiB serving ownership-evidence allowance. A stored JSON preview
selects only accounting, and never permits skipping canonical/semantic checks.

The initial private profile bounds a candidate to 256 source bindings and 4 MiB
of canonical candidate JSON. These bound construction/admission work, not shop
row counts. Large-catalog query performance remains a later execution proof.

## Internal Breaking Changes And Retirement

- Relational value imports move from persistence's `relationalSchema` files and
  value facade to `flarex-protocol/internal/relational-schema`. Source lineage
  types move to `flarex-protocol/internal/schema-source`; physical artifact
  capture types stay in persistence. Old pure-owner files/re-exports are removed.
- Catalog control session types/functions replace the framework-artifact-prefixed
  transaction seam. All affected internal consumers and tests move together.
  No compatibility forwarding module remains.
- Native Product model exports and semantic compilation move to
  `product-definition.ts`. Deployment-specific artifact/profile capture consumes
  that definition. Its active Product/Link/Pricing consumers remain until their
  shared-row execution cutover; the candidate path never calls physical capture.
- Shared admission consumes independent producer/policy references. The old
  Application V3 embedded Payload policy bundle remains with existing active
  runtime consumers. The new composer refuses that mixed-source input instead
  of silently importing its ownership assumptions; native Application V1/V2
  analysis and independently compiled Payload contributions form this candidate.
- Dependency extensions now require their explicit strong-reference policy.
  Caller admission identities are captured and decoded strictly; extra authority
  fields cannot redirect artifact persistence. This private candidate format has
  no supported old reader or durable environment requiring a compatibility decoder.

There is no public developer API or compatibility promise for these private
construction seams. The source manifest remains authoritative for Application
functions; generated schemas do not authorize functions or install executable
code. Runtime policy dispatch, ownership transfer, advanced schema upgrades and
full framework migration engine/table retirement remain gated by their owning
follow-on work, including [deferred evolution](./deferred-framework-schema-evolution.md).

## Decisive Witnesses And Remaining Gates

[The connected test](../../packages/medusa-adapter/test/schemaComposition.test.ts)
uses native Application schema definitions, durable Application analysis,
native Payload configuration and the full Product compiler. It checks preserved
IDs, both dependency directions, read-only exposure, canonical reload, replay,
competing candidates, source digest tampering, incomplete Product sets,
conflicting definitions, missing/wrong-owner endpoints, wrong scope and stored
corruption, retained ownership refusal and unsupported placement. The PostgreSQL
lane exercises identical/conflicting admission races and lost-COMMIT recovery
with an ordinary role. PGlite also checks that failed quarantine preserves an
uncertain decision. A catalog inventory comparison checks that admission creates
no tables. A shared history witness proves candidates confer no prior writes.

The test is a catalog/producer proof. It does not establish native cross-framework
query execution, writes, generic index enforcement, migration conversion,
Cloudflare deployment or throughput. Those remain GLS3 and later gates. The
existing Application, Payload, Product and physical settlement tests protect
the active paths while those consumers are migrated.
