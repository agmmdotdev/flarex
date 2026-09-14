# Shared Candidate Admission

Status: implementation under validation. This is the admission-only part of
[GLS2](./README.md), within the [approved preflight](./01-schema-composition-preflight.md).
It does not complete shared commerce storage, serving activation or migrations.

## Owners And Authentication

[The backend composer](../../packages/flarex-backend/src/schemaComposition.ts)
loads the Application candidate through the authenticated analysis repository.
The repository checks scope authority and the immutable analysis/source binding.
The composer invokes Payload's native collection compiler and the complete
pinned Product compiler. Configuration supplies collection inputs, explicit
read-only view bindings and deployment-authorized dependency declarations; it
cannot supply a replacement Product schema or claim framework producer hashes.
No HTTP or application execution route exposes this construction capability.

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

There is no public developer API or compatibility promise for these private
construction seams. The source manifest remains authoritative for Application
functions; generated schemas do not authorize functions or install executable
code. Runtime policy dispatch, ownership transfer, advanced schema upgrades and
full framework migration engine/table retirement remain gated by their owning
follow-on work, including [deferred evolution](./deferred-framework-schema-evolution.md).

## Decisive Witnesses And Remaining Gates

[The connected test](../../packages/flarex-backend/test/schemaComposition.test.ts)
uses native Application schema definitions, durable Application analysis,
native Payload configuration and the full Product compiler. It checks preserved
IDs, both dependency directions, read-only exposure, canonical reload, replay,
competing candidates, source digest tampering, incomplete Product sets,
conflicting definitions, missing/wrong-owner endpoints, wrong scope and stored
corruption. The PostgreSQL lane exercises concurrent admission with an ordinary
role. A catalog inventory comparison checks that admission creates no tables.

The test is a catalog/producer proof. It does not establish native cross-framework
query execution, writes, generic index enforcement, migration conversion,
Cloudflare deployment or throughput. Those remain GLS3 and later gates. The
existing Application, Payload, Product and physical settlement tests protect
the active paths while those consumers are migrated.
