# Payload Content Relations And Rebinding

## Status And Recommendation

Status: implemented privately for the exact optional-one profile below. Scalar
CRUD and preference publication remain compatible; broader relation behavior
and production/public promotion retain their separate gates.

The private runtime delivers one non-reactive relationship through actual Payload Local API
operations, including a scalar-to-relation Application successor and exact
content/lifecycle rebinding. The first fixture adds optional `relatedPost` on
`posts`, targeting `posts`, at depth zero. Complete candidate admission, activation,
rebinding, CMS relation materialization, and conformance in one implementation
capability; these are execution steps, not separate approval checkpoints.

This closes the first real Payload consumer of the native relation core. It does
not complete the broader one/many, population, and reverse-join milestone required
by the adoption plan, or advance Medusa past its remaining prerequisites.

## Evidence And Design Challenges

Repository paths below are relative to the workspace root.

| Boundary before this capability | Required correction |
| --- | --- |
| `packages/analysis/src/applicationWritePolicy/model.ts` and `schemaCompatibility.ts` accept only the scalar configuration and required scalar validators | A relation configuration needs an explicit strict profile and exact validator/relation agreement; changing only the adapter is insufficient. |
| `packages/persistence-postgres/src/applicationWriteOwnership/Policy.ts`, `retainApplicationManagedTableClaims` | Any changed configuration or policy digest returns `ownershipChanged`, even with the same table and Payload owner. The roadmap's successor cannot currently activate. |
| `packages/persistence-postgres/src/frameworkSchema/binding/content.ts` and `cmsTransaction/admission.ts` require zero relations | Exact relation readiness and policy evidence must be admitted together. Removing the count check alone would grant unsupported behavior. |
| `packages/persistence-postgres/src/payloadPreferences/binding.ts` reconstructs the exact scalar content digest | Rebinding only the content overlay still fails combined preference admission. The physical preference schema can stay the same, but the admitted content contract must be extended explicitly. |
| `packages/persistence-postgres/src/pointCommitTransaction.ts`, `enterCmsApplicationCommit` | The CMS participant materializes rows and passes an empty adjacency-change list. It does not yet run native relation planning, target validation, edge maintenance, or restrict checks. |
| `packages/persistence-postgres/src/applicationRelationCommit/Policy.ts` | Optional one-valued relations permit an absent property; a present null is invalid. Many-valued relations require a present array. |
| `packages/persistence-postgres/src/cmsTransaction/documents.ts` | Patch merges fields. Dropping a null from a patch would leave an old relation in place; clearing must construct the correct final document. |

The ownership refusal is an intentional boundary, not an incidental bug to
remove. Reproduce it with an existing retained Payload claim and a successor
policy over the same table/name/policy ID/provenance but a new configuration and
policy digest. Original result: `ownershipChanged`. The implemented exception admits only
the authenticated additive successor described below. Arbitrary configuration
changes, ownership transfers, and stale-head activation remain rejected. The
affected owner is Application write-ownership retention and activation.

The existing [native relation contract](../../flarexdb-foundation/04-payload-relational-contract.md)
already owns final-document authority, derived edges, target liveness, restrict,
scope-clock serialization and adjacency publication. Reuse those semantics.
Convex-style document mutations and exact committed snapshots remain the model;
CMS keeps its accepted SQL request profile and never acquires a logical journal
or callback replay loop. No second edge writer or framework transaction engine
is warranted.

Pinned upstream references remain `payload@3.88.0`, release commit
`fea6f8a47a50ff1330d8a5071b43e7dcffb97b22`:

- [Relationship validation](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/fields/validations.ts#L818-L892)
  checks required values, array bounds and ID representation, then filter options.
  It does not establish the native duplicate-free, live-target or restrict policy.
- [Population](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/fields/hooks/afterRead/relationshipPopulationPromise.ts#L60-L97)
  uses the request data loader when depth permits and otherwise retains identity.
  Keep depth zero for the first proof; population needs its own bounded access,
  loader, query and response contract.
- The installed pinned `payload/dist/fields/validations.js` only queries filter
  options when configured. Keep `filterOptions` absent; SQL target integrity must
  be enforced by Flarex even when Payload accepts the ID representation.

## First Mapping And Compatibility Contract

| Surface | Admitted behavior |
| --- | --- |
| Payload field | Top-level `relatedPost`, `type: relationship`, `relationTo: posts`, `hasMany: false`, optional, nonlocalized; no filter options or custom field callbacks. |
| Native declaration | Optional one, monomorphic `posts` target, reverse-many, target-delete restrict, existing occurrence codec and stable relation identity. |
| Stored document | Absent field or one decoded Application document ID naming the bound `posts` table. Document data is authoritative. |
| Input | Create omission leaves no edge. Update omission preserves the field. Explicit null clears it. Numeric IDs, populated objects, wrong-table IDs and unsupported options fail. |
| Clearing | Construct the final document without `relatedPost` using the existing request-owned read/replace capability, preserving system identity, timestamps and unrelated fields. Do not teach the generic native relation codec to accept null. |
| Output | Depth-zero identity; use a fixed null representation for an absent optional relation at the Payload boundary and prove it through the pinned Local API. Do not store that null in Application data. |
| Integrity | Missing/tombstoned/other-scope targets fail; final same-request row state determines liveness. Restrict checks observe the final edge set. Self-reference and cycles require no recursive traversal. |
| Failure contract | Expected invalid relation values/targets and restricted deletion remain distinguishable typed CMS failures with preserved native causes. Do not classify them as stored corruption. Pin the Local API projection and rollback behavior. |

Existing scalar documents remain valid because the new field is optional. The
first successor therefore needs no content backfill. A many-valued field cannot
be added by assuming old documents contain `[]`: native extraction requires the
array to exist. Its later admission must specify a compatible candidate/data
transition. Required relationships, repeated targets, localization, arrays/blocks,
polymorphism, populated writes, reverse joins and recursive population remain
unsupported. A self-relation keeps every content deletion within the existing
`posts` preference selector; it does not claim cross-collection conformance.

## Authenticated Successor And Rebinding

1. Preserve the scalar configuration's exact encoded bytes and decoder branch.
   Add a strict `payload.content-relations` configuration profile with explicit
   field, endpoint and relation-policy metadata. Keep format version 1 only as
   the existing envelope with a distinct profile branch; do not reinterpret
   `payload.scalar` bytes. Derive provenance/configuration digests independently
   of the later Application head and readiness digests.
2. Retain the existing persisted `payload.scalar` policy ID as the established
   owner identity for this exact successor. Its historical spelling is not a
   feature selector: the authenticated configuration profile grants the admitted
   shape. A new policy ID or owner transfer is outside this transition.
3. Admit only an authenticated additive scalar-to-optional-one successor: same
   table identity/name, Payload owner, policy ID and pinned provenance; unchanged
   prior scalar fields, validators, indexes and uniqueness; exactly the declared
   optional relation addition. Match the new configuration to canonical validators
   and relation declarations, including requiredness, target and delete policy.
   No caller-authored successor Boolean or digest-only exception grants authority.
4. Carry old and new authenticated policy evidence into retention validation.
   Append the new current claim under existing activation/history ownership,
   preserving its original establishing identity and immutable prior records.
   Recovery validates each claim against its own readiness and the admitted
   transition. Exact historical replay remains available; replay cannot regress
   the active head. Reuse the existing bounded history budget.
5. Publish and build through Application Analysis, schema binding, managed
   readiness and activation. Verify existing scalar rows and complete relation
   readiness before activation. Ordinary Application writes to `posts` stay
   denied before, during and after the successor.
6. Activate the exact new Application head under existing locks/CAS. The old
   Payload overlay becomes unusable immediately. Then activate the new combined
   content/lifecycle binding through the existing binding owner. A fail-closed
   serving gap between these decisions is acceptable; no dual-writer interval or
   cross-database atomicity claim is needed.
7. Keep the existing preference artifact, installation and bounded cleanup/fact
   contract. Explicitly recognize the new authenticated content profile in its
   binding validator. New CMS admission and retained-result lookup must match
   the new configuration, policy, active Application and relation readiness.
   Reject copied/stale/mismatched overlays before entering Payload callbacks.

The Application reference already carries relation-set readiness and exact
schema/publication commitments. Resolve stable relation identities through that
authenticated chain; do not add a caller-authored duplicate relation catalog to
the Payload overlay. No new physical schema or migration is expected here. If
the existing encoded retention contract cannot represent the admitted transition,
return to this owner decision before introducing a new persisted contract.

## Retained Evidence And Resource Boundary

Initial admission and historical restoration use the same successor verifier.
It reads canonical published manifests, checks the prior and next readiness
commitments during recovery, and compares the existing validated closed unique
sets over the publication-pinned schema versions. Configuration/index equality
alone cannot prove uniqueness preservation.

The admitted Application selection retains its original readiness/catalog
composition. Binding and CMS recovery use that composition, while ordinary
point commits reuse their nominal unique-definition port. Activation recovery
reuses the held catalog lease before releasing the target transaction. Target
metadata is never a fallback control catalog. Missing or changed evidence fails
closed; no new persisted envelope, schema or migration is introduced. Catalog
availability is required to restore a history containing this successor. A writer
that commits after candidate readiness can invalidate that candidate: activation
returns `notReady` and retains the old binding. A fresh ready successor is needed.
If activation holds the lock first, the waiting old-overlay writer is refused
before its Payload callback; exact rebinding enables subsequent requests.

All restored evidence consumes one aggregate 64-record/1 MiB history budget.
The transition adds two manifest records and, per unique set, one closure plus
a binding and definition per member. Bytes are reserved before payload reads.
For the exercised two-activation history with one unique member on each side,
recovery uses 15 records: reserving the remaining 49 succeeds and reserving 50
fails. Longer histories remain subject to both record and byte ceilings; the
older scalar-only maximum is not a relation-history guarantee.

## Runtime Flow And Owned Changes

```text
authenticated combined binding + scope-clock lock
  -> actual Payload Local API and fixed request hooks
  -> CMS pending final documents (including explicit clear)
  -> native relation definitions + prior/final transition plan
  -> native final-target checks + Application row/index/unique materialization
  -> native edge/adjacency maintenance + final incoming restrict checks
  -> existing row + adjacency + preference facts / retained result / wake
  -> one physical transaction commit
```

Keep the scalar runtime and its conformance branch compatible. Extend the
private adapter/profile composition only for the exact new shape; share its
existing request bridge and lifecycle instead of copying another scalar engine.
Extend the CMS participant to consume the existing relation owner using the same
transaction and authenticated final document closure. Reuse native planning and
maintenance helpers through a narrow owner-local operation; do not fabricate an
Application logical journal or accept adapter-authored edge actions.

Retain existing scope, call, identity, byte, statement, deadline and cleanup
limits. Relation preparation also enforces the native occurrence/action/target
budgets; it must not multiply them per nested operation. All row, relation,
preference and publication effects roll back together on failure or interruption.
No new retry policy or commit publisher is introduced.

First proof reads forward identities through Payload documents. Verify committed
reverse identities through the already-authenticated native query path as an
independent storage consumer. Do not expose a CMS reverse API, promise pending
reverse reads, or wire Payload joins in this capability. These remain later
steps in the broader native-relation adoption milestone.

## Completion Evidence And Execution Order

Implement strict profile/transition validation, candidate activation/rebinding,
then CMS/native materialization and the Payload boundary. Keep them within the
same approved capability and coherent commit after the full proof passes.

- Pure cases: exact old/new digest agreement, malformed relation declarations,
  forged transitions, changed owner/provenance/table/index/scalar definitions,
  stale replay, null/absence mapping and limit failures. Preserve scalar decoding.
- One reusable PGlite scenario and the same scenario on ordinary-role PostgreSQL:
  create scalar rows, build/activate the additive successor, prove old-overlay
  refusal, bind the new profile and invoke real Payload CRUD. Assert identity
  output, set/retarget/clear/source-delete, self-reference, valid cycles, target
  restrict, nested target creation, nested removal plus target deletion, and
  invalid-target rollback. Verify rows, edges, adjacency versions, facts,
  preference cleanup, retained result and wake agree on one commit.
- Inject failure after row, edge, restrict, fact and publication boundaries;
  prove full rollback. Replay executes no callback twice. Native tests cover
  interruption, lost-COMMIT acknowledgement recovery, competing target deletion
  versus relation insertion, and activation/rebinding versus an admitted writer.
  Use barriers and both holder orders; retained replay cannot revive a stale
  binding. Keep unrelated scopes independent.
- Run the existing manifest-owned Application preservation lanes once for the
  affected shared owner, plus focused scalar/preference regressions. Use one
  shared scenario/fixture per driver, pure tests without database startup,
  serial bounded typechecks, core/diff/staged lint and both standing reviewers.
  No broad PostgreSQL/PGlite rerun per individual test case.

The exit criterion is working optional-one Payload relation CRUD with an actual
scalar-to-relation successor, continued ordinary-write denial, atomic native
publication and exact combined binding. Update living status only after that
proof. Many relations, cross-collection population/reverse behavior, Medusa
integration, live sync, dashboard, public packages and production retain their
own remaining gates.
