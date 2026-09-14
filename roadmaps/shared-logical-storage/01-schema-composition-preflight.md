# Shared Schema Composition And Candidate Admission Preflight

Status: proposed implementation contract; source investigation is complete for
this first slice, but implementation approval and runtime work are pending.
This is the first part of GLS2, not completion of GLS1's whole-system inventory
or of the shared-storage redesign.

## Outcome And Boundary

Admit one authenticated logical candidate composed from an Application schema,
supported Payload collection definitions, a Payload view of an existing table,
and the complete pinned Medusa Product model set. Resolve their qualified table
identities and declared relationships in the shared catalog. Reject conflicting
definitions, missing dependencies, false provenance and unauthorized ownership.

The candidate is inspectable metadata, not serving readiness or a write
capability. Preserve complete index/constraint/value requirements even where
execution is not implemented; readiness must refuse unsupported requirements.
Do not drop a Product predicate or pivot to make the candidate appear supported.

This slice changes protocol/analysis/catalog admission and producer compilation
seams. It does not implement generic commerce row execution, full Product/Link
workflow parity, new public APIs, ownership transfer or advanced migrations.
Those remain the connected follow-on gates in the [core roadmap](./README.md)
and [deferred evolution note](./deferred-framework-schema-evolution.md).

## Current Paths And Concrete Mismatches

| Current owner and source | Observed boundary | Required correction |
| --- | --- | --- |
| [Application authoring](../../packages/application-schema-definition/src/ApplicationSchema.ts) and [catalog protocol](../../packages/flarex-protocol/src/app-schema-catalog.ts) | App document validators and ordered index declarations feed Application-shaped schema contracts. | Retain native authoring behavior; produce the shared candidate definition without requiring framework models to become handwritten Application declarations. |
| [Manifest V3](../../packages/analysis/src/applicationAnalysisV3.ts) and [analysis registration](../../packages/persistence-postgres/src/applicationAnalysisRegistration.ts) | One Application source artifact anchors function/schema analysis. The policy-bearing manifest adds Payload authority; it does not authenticate independent Medusa producers. | Preserve the Application function-source root and add explicit authenticated schema-producer dependencies at backend composition. Never fabricate an Application source root for framework outputs. |
| [Write-policy model](../../packages/analysis/src/applicationWritePolicy/model.ts) | Ordinary ownership is Application or a pinned Payload profile; the policy bundle contains Payload configuration/provenance. Slug normalization and relationship-target admission are Payload-specific. | Keep native configuration verification in its profile owner; shared admission consumes verified producer/policy references without requiring Payload configuration for every table. |
| [Payload compiler](../../packages/payload-adapter/src/collections.ts) | Compiles collections into Application declarations and Payload write policies. Relationship targets are mapped from collection slugs. It does not provide a general existing-table overlay. | Preserve compiled collection behavior; distinguish definition production from a validated reference to an existing table. Cross-producer references use shared identities, not ad hoc slug rewriting. |
| [Semantic manifest](../../packages/flarex-protocol/src/schema-manifest.ts), [table bindings](../../packages/persistence-postgres/src/schemaManifestTableBindings.ts), [index bindings](../../packages/persistence-postgres/src/schemaManifestAppSchemaBindings.ts) | Table definitions require `namespace: app`; binding assembly writes that value for tables and indexes. | Generalize the actual admission/binding owner, not just the SQL namespace check. Preserve already allocated IDs and collision/exclusion behavior. |
| [Catalog tables](../../packages/persistence-postgres/src/schema.ts) | `fx_control_table` already keys identity by deployment/table ID and names by deployment/namespace/logical name. Namespace labels alone carry no producer or write authority. | Reuse that stable identity owner. Explicitly bind schema provenance and policy; never infer authorization from a namespace. |
| [Product capture](../../packages/medusa-adapter/src/product-schema.ts), [DML lowering](../../packages/medusa-adapter/src/schema/lower.ts) | Ten native Product models produce thirteen tables including implicit pivots, then a relational artifact and physical layout/profile. | Separate native semantic capture from the physical artifact destination so the shared candidate consumes the full output without acquiring physical layout authority. |
| [Framework artifact model](../../packages/persistence-postgres/src/frameworkSchema/artifact/model.ts) and [relational value model](../../packages/persistence-postgres/src/relationalSchema/model.ts) | Framework artifacts exclude Application; relational identities include owner/lineage/local names and target physical installation. | Reuse canonical/dependency guarantees where appropriate, but do not simply add Application to an owner union and keep a second logical catalog. |

The executing Product compiler comes from the workspace `@medusajs/drizzle`
package and native model exports. The [pinned source receipt](../../third_party/medusa/SOURCE.json)
owns provenance. Original source snapshots remain comparison evidence; do not
edit them to accept a weakened candidate.

## Proposed Core Contract

### Definitions And Identity

- Extend existing protocol/definition owners with one shared logical candidate
  contract. Move/reuse pure value and constraint primitives from their present
  owners where needed; do not wrap an opaque physical artifact and call it a
  generic table. Do not introduce another package or schema-provider registry.
- Each producing contribution identifies its authenticated deployment, source
  coordinate and revision/digest. Each table identifies its schema owner,
  stable qualified identity, immutable definition and ordinary write-policy
  reference. Source coordinates and catalog IDs are different identities.
- Reuse `(deploymentId, tableId)` for admitted table identity. Preserve existing
  Application IDs; a Payload view points to them. Recompilation is idempotent.
  Independent deployments and same-name tables remain isolated. An intentional
  alias/reference is distinct from competing declarations of one identity.
- Preserve document validation semantics and all Product field, primary/pair
  identity, null, enum, timestamp, soft-delete, index predicate and FK/relation
  requirements in typed definitions. A pivot without a native primary ID must
  retain its unique endpoint contract; do not invent a public Medusa ID.
- Express references as qualified endpoint identities and exact requirements,
  resolved against the candidate or retained authorized definitions. No module
  import order, coincident name, runtime global registry or arbitrary SQL decides
  a target. Missing or conflicting endpoints reject the candidate.

### Authentication And Persistence

- Trusted backend composition invokes the existing source-verification and
  compiler owners, checks the contribution digests and candidate closure, then
  requests catalog admission. Caller-supplied producer labels, hashes or copied
  process-local handles are not sufficient authority.
- Keep Application source/function analysis authoritative and unchanged in
  meaning. Bind generated schema contributions explicitly to the candidate;
  they do not authorize functions, install code, or become a second active head.
- Use one catalog transaction owner to allocate/reuse identities, persist the
  immutable candidate/dependency/policy references and return admission evidence.
  Preserve existing physical-session settlement and uncertain-COMMIT recovery.
  Replays and concurrent identical admissions converge; conflicts do not merge.
- Candidate admission, dependency validity, storage readiness and active serving
  are separate states. The new candidate cannot pass existing serving entry
  points by casting it to an Application manifest or a physical commerce profile.
  No write capability is issued by this slice, including through a Payload view.
- Add only the metadata required to durably bind these facts at existing catalog
  owners. The implementation must provide an exact schema/FK/reader-writer diff
  and migration tests. No new migration journal, framework row family or generic
  background coordinator belongs in this contract.

### Scope Of Existing-Table Exposure

The first overlay is a private read-only configuration binding to an existing
Application table. It checks identity, field/relationship compatibility and
unchanged write authority; it creates neither rows nor a duplicate definition.
This does not activate a dashboard, new Payload Local API profile or ownership
transfer. A supported declaration plus safe serving refusal is the first proof.

## Connected Witness And Refusals

Use real producer outputs, not a test-only recreation of admission:

1. Compile a native Application table with an ordered index, supported Payload
   collections and the complete Product model/pivot set. Compose all producers
   through the same trusted admission path.
2. Include a Payload view of the Application table and an explicit declared
   reference into Product. Include a private owner-authorized extension reference
   out of the commerce contribution; do not mutate native Product's model shape.
3. Persist/reload the candidate and compare all semantic requirements, qualified
   endpoint resolutions and policy/provenance bindings. Repeat admission and
   race identical/conflicting candidates in ordinary-role Postgres.
4. Reject missing models/pivots, mismatched digests, competing schema owners,
   colliding overlay definitions, wrong deployment/scope, unresolved references,
   attempted ownership transfer and attempts to use admission as serving authority.
5. Verify no module business tables are created by the new admission path, no
   Application row history is duplicated, and the existing active Application
   and commerce profiles retain their current authority until their cutover.

This proves a persisted candidate graph, not runtime relation traversal or
generic commerce writes. GLS3 must subsequently exercise native APIs, indexed
forward/reverse queries, mutation constraints and publication on shared rows.
Do not report those capabilities from this admission-only checkpoint.

## Retain, Extend, Replace And Delete Inventory

| Component | Disposition in this slice | Retirement/completion condition |
| --- | --- | --- |
| Application authoring, native Payload sanitation, native Product compiler/models | Retain semantic behavior; extend their private contribution seams. | All three real outputs reach the shared owner with no copied model definitions. |
| App-only catalog binding and schema/write-owner assumptions | Replace for the new shared admission contract; migrate affected candidate producers. | No independent identity allocator or per-framework admission algorithm for the target. Preserve active supported readers until their connected cutover. |
| Producer-local canonical/hash/identity reconstruction introduced during this work | Delete in favor of the existing authoritative codec/catalog owner. | Exact replay/corruption witnesses use the same owner as production code. |
| Current Application V1/V2/V3 and relational artifact codecs with active consumers | Retain only for their inventoried current readers. Do not silently reinterpret serialized formats. | Retire each with its consumers; a genuinely incompatible encoded contract needs an explicit format/version decision, not opportunistic renaming. |
| Product physical layout/profile and framework installation coordinator | Retain for the current running Product/Link/Pricing baseline; the new candidate path must not call them. | Remove after shared row execution and readiness cut over those actual consumers in GLS3/GLS4; never a fallback for unsupported target semantics. |
| Existing Application validation/build/activation and platform DDL | Retain safeguards and current authority; extend only where candidate admission requires it. | Unsupported advanced transitions remain refused; existing behavior stays covered. |

No named durable environment, issued public compatibility obligation or safe
reset target has been established by this investigation. This proposal authorizes
no destructive reset. Before a schema edit, inventory affected current data and
readers; use an additive metadata migration unless an exact replacement/reset
has been separately justified. Full framework-migration table retirement remains
GLS4/GLS6, not an excuse to delete live baseline consumers during this slice.

## Alternatives Challenged

- Widening a namespace/owner enum does not authenticate contributions, preserve
  native constraints or remove Application-only binding assumptions.
- Flattening Product into permissive JSON loses null/index/pivot semantics;
  duplicating models by hand creates a second schema owner.
- Extending the physical framework installer into another universal engine
  preserves the wrong destination and duplicates logical admission.
- Implementing full generic commerce execution in this first slice mixes
  admission with row/index/constraint enforcement before identities are settled.
  Keep this checkpoint small in authority, then continue the connected gates.

## Validation And Approval

Required implementation checks include protocol/analysis/producer typechecks and
tests, catalog corruption/identity/replay tests, both PGlite and ordinary-role
Postgres admission lanes, unaffected Application/Payload/Medusa regressions,
source/boundary checks, core/diff lint and both project reviewers. Exact affected
commands must come from current package configs, not a broad workspace run.
No throughput, hosted Cloudflare or production claim follows from these tests.

Baseline commands for the source paths inspected here:

```text
pnpm --filter @flarex/application-schema-definition exec vitest run test/ApplicationSchema.test.ts
pnpm --filter flarex-protocol exec vitest run test/app-schema-catalog.test.ts
pnpm --filter @flarex/payload-adapter exec vitest run test/collections.test.ts
pnpm --filter @flarex/medusa-adapter exec vitest run --config vitest.config.ts test/product-schema.test.ts test/shared-schema.test.ts test/sales-channel-schema.test.ts
```

Approval requested: implement this shared candidate-admission contract with its
producer/catalog migration, connected refusal proofs and scoped cleanup. Approval
does not include serving activation, advanced schema evolution or replacing the
Application OCC/commerce transaction profiles. A materially different authority,
identity or compatibility requirement returns to the user with evidence.
