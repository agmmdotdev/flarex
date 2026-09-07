# Payload Many Installation And Migration Boundary

## Status And Recommendation

Status: researched proposal; implementation requires capability approval.
The optional-one successor and standalone depth-one population remain the
implemented profiles. No many profile or data-migration authority is enabled.

Recommend one private **fresh-install many-relation conformance capability**
next. Prove the actual Payload operation path through the shared Application
row, relation, transaction, publication and binding owners. Keep an existing-row
upgrade separate until an explicit supported upgrade or durable-data obligation
justifies its conversion authority.

This refines the ordering proposed in
[the many-transition preflight](./21-payload-many-transition-and-bounded-population.md).
That document correctly identifies a conversion requirement for an existing-row
successor. It does not establish that every many-valued consumer proof needs
such a successor. An empty installation alone proves little; the proposed
capability must create real posts through Payload, mutate populated arrays,
reopen retained state and prove native invariants on both drivers.

## Why This Order

The stated outcome is a shared Flarex core proven by both frameworks. The
[three-lane plan](./05-core-first-three-lane-readiness.md#payload-native-onemany-relations)
requires real one/many behavior before Medusa promotion. It does not require
general Payload migration or dashboard parity. The capability map records
private Node evidence, no public export and no production authorization. No
supported deployed-data or live-traffic obligation is recorded there. This is
repository evidence, not an assertion that no external deployment exists.

[Repository compatibility policy](../../../AGENTS.md#replacement-design-authority)
requires evidence before adding compatibility machinery. Preserve the existing
scalar and optional-one tests and their exact persisted meanings. Do not delete,
reset, silently upgrade or reinterpret an existing database to obtain a fresh
fixture. If an actual deployment or supported upgrade requirement is identified,
revisit the conversion decision before selecting this capability for it.

## Source Findings

Paths below are relative to the repository root; symbols identify the owning
code rather than creating a second API inventory.

| Owner and source | Finding and implication |
| --- | --- |
| `packages/analysis/src/applicationRelationAnalysis.ts`, `sourceValidatorMatchesDeclaration` | Native many storage needs a present array. `minItems: 0` allows `[]`; it does not allow an absent field. |
| `packages/persistence-postgres/src/applicationRelationCommit/Policy.ts`, `lowerApplicationRelationCommitResult` | One definition set lowers both prior and final documents. Applying a new many definition directly to an old row fails on the absent prior array. |
| `packages/persistence-postgres/src/applicationRelationBuild/` | E01 builds derived edge/adjacency state. It is not a document conversion writer. |
| `packages/persistence-postgres/src/cmsTransaction/documents.ts`, `write` | CMS final documents are validated against the authenticated active Application schema. A candidate-validator token alone cannot authorize adding an unknown active-schema field. |
| `packages/persistence-postgres/src/appSchemaCandidateValidation.ts`, `applyAppSchemaCandidateWriteGuardInTransactionEffect` | Candidate validation tracks readiness/failure for committed rows. It grants neither migration writes nor an offline serving fence. |
| `packages/persistence-postgres/src/pointCommitTransaction.ts`, `enterCmsApplicationCommit` | Existing CMS commits share row history, index/unique maintenance, relation lowering and publication. A later conversion participant must reuse the materialization owner without fabricating CMS admission or an Application journal. |
| `packages/persistence-postgres/src/applicationWriteOwnership/Successor.ts` | Only the exact scalar-to-optional-one policy transition is admitted. Same Payload owner or an empty current table does not authorize another successor. |
| `packages/persistence-postgres/src/cmsTransaction/host.ts` and `applicationQuerySnapshot.ts` | CMS locks/admission and Application snapshot reads have distinct entry points. A CMS-only maintenance flag is not a complete fence against observing transitional document shapes. |
| `packages/persistence-postgres/src/migrationCoordination/` | Framework structural execution has its own physical collision identity and ledger. Its existence does not grant scope-bound Payload document conversion. |

The pinned [Payload relationship validator](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/fields/validations.ts)
and [database adapter types](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/database/types.ts)
remain primary consumer evidence. Flarex's duplicate rejection, canonical IDs
and narrower null/input policy are explicit profile constraints. Payload's
migration method surface does not authenticate a Flarex migration capability.

## Proposed Implementation Capability

### Exact Profile And Admission

Add an explicitly discriminated private configuration profile,
`payload.content-many`, preserving the old scalar and optional-one canonical
bytes and decoder meanings. Keep the stable Payload owner/policy identity;
configuration and write-policy digests change. The new profile contains the
existing scalar fields, `relatedPost`, and a distinct `relatedPosts -> posts`
relation. Do not reuse the optional-one relation identity for the new field.

The new field is top-level, nonlocalized, monomorphic, ordered, duplicate-free,
inverse-many and target-delete restrict. Its Application validator is a required
array of canonical posts IDs; the relation declaration uses `minItems: 0` and
the private profile admits at most 32 items.
Payload input remains optional: create omission supplies `[]`, update omission
preserves the stored array, and explicit `[]` clears it. Reject explicit null,
sparse arrays, duplicates, populated objects, numeric IDs, wrong-table IDs and
unadmitted shapes before Payload normalization can erase the distinction.

Admit the profile only when the normal authenticated managed-table initialization
path establishes a fresh claim, with no prior Payload ownership lineage to
upgrade. An empty table with a retained scalar/optional-one claim is still an
upgrade and must be refused. Use existing readiness, ownership initialization
and exact combined content/preference binding, never a caller's `fresh: true`
flag. No new successor exception belongs in this capability.

### Execution Flow And Bounds

```text
exact new configuration -> Application analysis/publication
  -> normal managed-schema and relation readiness
  -> fresh managed ownership + Application activation
  -> exact combined content/preference binding
  -> pinned Payload Local API and authenticated CMS request
  -> pending documents + native relation lowering
  -> one shared commit publication
  -> depth-zero identities / bounded standalone depth-one population
```

Exercise create, update, retarget, reorder, clear and delete, including nested
request rollback and atomic preference cleanup. Preserve the existing optional-
one behavior within this profile. Native reverse identity reads independently
prove many edges; Payload reverse-join configuration remains a subsequent
response/query capability and is not claimed by those native reads.

Extend the existing request population ledger to account for both relation
fields and preserve each array's order. The existing aggregate ceiling of 32
distinct targets is per request across all roots and fields, not per array.
Also bound occurrence accounting before allocation; 32 roots with up to 32 many
references plus one optional-one reference each allow at most 1,056 references.
Each repeated output copy counts against the existing 1 MiB output budget.
Keep the existing page, document-size, loaded-identity, time and native commit
limits. Fail the request before an over-budget target fetch; do not silently
truncate or raise budgets to make a fixture pass. Writes and nested reads stay
at depth zero; standalone reads may use depth one.

### Change Classification

| Path | Classification and intended change |
| --- | --- |
| Analysis write-policy model and schema compatibility | **Port** exact field/relation validation to a third explicit profile; retain strict old branches and canonical meanings. |
| Private Payload contract/profile/runtime/adapter | **Port** admitted array input and output handling; keep provenance, access execution and request ownership. |
| Private population ledger | **Port** ordered many references into existing batching, lifetime and aggregate budgets. |
| CMS pending documents, commit materializer and native relation owners | **Keep** authority and transaction semantics; exercise through the new consumer. A discovered owner-contract defect needs its own decision, not an adapter workaround. |
| Ownership successor, candidate validation and E01 builders | **Keep** current contracts; no conversion bypass or blanket successor admission. |
| Structural migration coordinator and platform schema | **Keep**; no new migration ledger, DDL or execution family in this slice. |
| Existing private scalar/optional-one callers and tests | **Keep** as active conformance profiles, not temporary migration bridges. |

No generic migration engine, public adapter export, hosted route, arbitrary
hooks, reactive relation semantics, polymorphism, repeated targets or cross-
domain mutation authority is included.

## Existing-Row Conversion Contract: Deferred

This is the concrete boundary a later conversion preflight must satisfy, not
an approved persisted schema or an implementation promise. First identify the
actual supported source installation and data/traffic obligation. With durable
data and no live traffic, prefer one offline conversion plus a verified backup
and restoration procedure. Online dual-schema operation requires separate
evidence and approval.

1. **Identity and authority.** Authenticate the located physical target,
   deployment/scope, storage generation/fence, exact old/new publications,
   configuration and write policies, source table, transformation digest and
   attempt generation. A persisted selector locates evidence; only a trusted
   owner can reissue process-local authority. No raw database handle, digest
   pair, maintenance Boolean or Payload CLI method is authority.
2. **Durable serving exclusion.** Establish exclusion under the scope-clock
   lock before conversion. Enumerate every admitted CMS and Application read,
   write, retained-result replay, snapshot acquisition and activation path that
   can observe or replace the affected schema. Already admitted work must drain
   or remain on a proven immutable compatible snapshot. New work fails closed.
   Old CMS writers cannot recreate missing arrays between conversion pages.
   Unrelated publications must either be excluded or invalidate/restart the
   existing readiness proof; a stable frontier cannot simply be assumed.
3. **Transformation authority.** Permit only the exact addition of
   `relatedPosts: []` to an authenticated old-shape row. Preserve row identity,
   creation time and existing fields. Validate the prior against the old
   publication and the final against the candidate. Materialize through the
   existing row/index/unique/publication owner with an explicit conversion
   participant. Preserve old relation semantics during conversion; the new
   empty relation has no edges. Do not feed absent prior arrays into the new
   many lowerer, normalize absence globally, or write documents in E01 SQL.
4. **Progress and uncertainty.** The scope-local durable attempt must bind the
   identities above, fence ownership, bounded cursor, phase, page request
   identity, committed outcome and failure evidence. Row publication and page
   progress must commit in the same located transaction. Restore only from
   authenticated retained evidence. Lost-commit acknowledgement triggers exact
   outcome resolution; it does not rerun an arbitrary callback. Takeover
   invalidates the old claimant. Progress is not a readiness receipt.
5. **Cutover.** After all rows satisfy the candidate, run normal candidate,
   index/unique and relation readiness at the required frontier. Authenticate
   an exact new ownership successor, including retained-history restoration.
   Activate the Application head, then bind the exact combined content/lifecycle
   overlay, then release serving exclusion. A head-to-binding gap remains
   fail-closed; control and located databases are not one transaction.
6. **Recovery.** Before data changes, cancellation may release exclusion only
   after verifying unchanged old state. After any converted page, keep exclusion
   and resume/repair forward or restore a verified consistent backup. After head
   activation, complete exact binding or perform a separately proven restoration;
   a source-code rollback cannot undo changed documents. Missing/tampered history,
   cursor, generation or backup evidence must fail closed within explicit read
   and byte budgets. Do not increase the current 64-record/1-MiB ownership-history
   budget incidentally.

Suggested conceptual phases are `fenced -> converting -> validating ->
activated -> rebound -> complete`; failure keeps exclusion until an authenticated
recovery decision. These are design states, not new protocol enum values.
Their eventual storage contract and complete admission coverage require the
later conversion capability's approval.

### Alternatives Challenged

| Alternative | Decision |
| --- | --- |
| Build a general migration host before any many consumer | Defer: no recorded obligation justifies adding a cross-owner serving fence and durable conversion protocol to the immediate core proof. |
| Fresh installation counts as an existing-row upgrade | Reject: it proves only the new profile; same-owner successor and recovery remain unimplemented. |
| Adapter defaults or E01 backfill perform conversion | Reject: future input defaults cannot repair stored documents, and E01 has no document-write authority. |
| Native `minItems: 0` silently admits absence | Reject: this changes native validation and prior/final semantics for other consumers. |
| Temporary active schema permits both shapes | Defer: requires another authenticated profile, activation/binding transition, writer policy and retention obligation; it is not a free workaround. |
| Operator stops one Payload process | Insufficient as a reusable fence: Application readers, other writers and restarts must also be accounted for. A genuinely exclusive offline target must be established and tested explicitly. |

## Completion Proof For The Recommended Capability

- Pure profile/input/ledger tests establish deterministic identity, exact old
  profile preservation, omission versus clear, rejected shapes, ordering and
  aggregate budgets. Verify refusal of scalar/optional-one-to-many ownership
  changes, including an emptied table with retained history.
- One reusable scenario runs the actual pinned Payload Local API against PGlite
  and ordinary-role PostgreSQL: fresh activation/binding, populated many CRUD,
  target liveness, restrict deletion, retarget/reorder/clear, pending reads,
  nested rollback, one publication and atomic preference cleanup.
- Prove bounded depth-one population across roots and both fields, shared
  targets, response ordering, output limits and native reverse identities.
  Cold reopen must reconstruct exact configuration/binding/ownership evidence
  and preserve populated rows and edge state.
- PostgreSQL owns both concurrent writer orderings, restrict/delete races,
  read/write consistency, interruption and uncertain settlement claims. PGlite
  functional tests are not substitutes for those database proofs.
- Use the existing manifest-owned fast/native test lanes and shared database
  fixture lifecycle. Add many behavior to reusable scenario helpers; avoid a
  database bootstrap per case or a broad compiler/DB suite for pure validation.
  Run focused affected-owner checks and Application/scalar/optional-one
  preservation once, then broaden only for a demonstrated failure or risk.
- Complete scoped TypeScript/lint checks and the repository-required code
  quality and TypeScript reviewer passes for implementation. Reconcile this
  preflight, the three-lane plan, adoption roadmap and capability map to actual
  results. Fresh-only evidence must remain labeled fresh-only.

The next remaining consumer gate after this capability is bounded Payload
reverse-join behavior and reconciliation of the complete non-reactive relation
milestone. Existing-row upgrades stay visibly deferred; public/production and
Medusa promotion still require their owning gates.
