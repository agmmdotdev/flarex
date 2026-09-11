# Shared-Installation Atomic Commerce And Stored Link Gates

Status: proposed; implementation is not approved. This refines Gate B of
[the Product workflow foundation](./50-product-workflow-sales-channel-foundation.md).
Gate A is complete. Approving B1 below does not approve B2, B3 or Gate C.

## Outcome And Recommended Next Slice

Allow separate, explicitly confined commerce participants to execute in one
atomic request against the same physical installation. Keep the existing host
construction API, command tokens and single outer transaction/publication owner.
This is a shared persistence correction, not a Sales Channel or Link branch.

Implement B1 first. It removes an independently demonstrable core limitation and
advances the Product + Sales Channel + Link transaction without guessing Link
upsert semantics. Characterize those native semantics before approving the
subsequent key/lifecycle/publication contract. Do not build a new workflow engine.

## Governing Evidence

- [Accepted Medusa boundary](../../../design-notes/flarex-db-accepted-design.md#medusa-boundary),
  [commerce Link semantics](../../../design-notes/flarexdb-medusa-commerce-adapter.md#2-commerce-owned-link-entity)
  and [package ownership](../../16-package-boundaries.md).
- [Adoption and commerce-link commit admission](../06-medusa-adoption.md#commerce-link-commit-admission),
  [Gate A binding correction](./51-commerce-installation-profile-bindings.md)
  and [workflow foundations](../../workflow-foundations/README.md).
- Native paths below refer to the inert source island at fork commit
  `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
  [SOURCE.json](../../../third_party/medusa/SOURCE.json). Static source evidence
  is not an executed ORM compatibility result; the island stays outside root
  runtime imports.

## Confirmed Core Limitation And Witness

`packages/persistence-postgres/src/atomicCommerce/participants.ts` rejects any
second participant with the same `installationSha256`, before authenticating its
profile. Distinct Product and Sales Channel tokens with disjoint, bound profiles
on the completed fourteen-table candidate therefore cannot compose atomically.
Separate transactions are already admitted by Gate A.

The existing adapter test `test/atomic-commerce.test.ts` rejects `[first, first]`,
but that also repeats the participant name. It does not isolate the physical
installation restriction. B1 must first retain a focused witness with distinct
authentic participant names and disjoint profiles sharing one exact reference;
the current implementation refuses it with `invalidAuthority`.

Removing the digest check is insufficient:

- Preparation currently calls `prepareInstallationRuntime` for every member.
- `atomicCommerce/admission.ts` calls `withCommerceAdmission` for every member;
  that owner repeats installation acceptance and active binding verification.
- Member ordering currently uses only the installation digest. Replay evidence
  includes the ordered participant names, exact references, profile contract
  digests and allowed command names in `atomicCommerce/request.ts`.
- Execution creates per-call stores and authenticated contributions. Publication
  accepts additional contributions from the same transaction, authority, clock
  and binding head; it must not collapse them merely because their installation
  digest matches. Facts retain table/key identity and global change ordinals.

## B1: Shared Physical Admission, Separate Logical Authority

### Contract And Owners

Extend the existing `atomicCommerce` and `commerceTransaction/admission` owners:

1. Keep the caller's existing `participants` list. Each entry still selects an
   authentic participant token, profile, exact installation reference, commands
   and event policy. No module-kind switch, new registration DSL, extra caller
   assembly or version-suffixed host API is needed.
2. Capture caller-owned configuration before suspension. Authenticate every
   logical participant and retain its own descriptor, allowed commands and event
   selection. Sharing storage must never union their execution capabilities.
3. Group only exact matching installation references for physical preparation
   and acceptance. Equal installation digests with conflicting references or
   artifact/layout/placement evidence fail closed. Prepare each physical
   installation once; revalidate its evidence inside every accepting transaction.
4. Preserve scope-clock-before-installation lock order and canonical installation
   ordering. Order members within a physical group by participant name using the
   existing UTF-16 comparator. Input permutation must not change replay identity.
   The ordering of previously admitted distinct installations remains unchanged.
5. Validate active binding/profile membership for every member. Share only
   transaction-local physical evidence within the existing admission owner;
   retain separately authenticated, revocable per-profile admissions. Do not
   expose physical admission data, a database handle or settlement authority to
   adapters. Standalone/cross-domain callers keep their existing admission path
   over the same owner, not a copied fallback implementation.
6. Initially require disjoint table capability sets within each shared-installation
   group, including read capabilities. Reject duplicate participant names and
   overlapping table grants instead of inventing read/write overlap resolution.
   This bounded rule admits the endpoint/Link ownership split; overlapping
   profiles require a later explicit capability decision.
7. Preserve the existing logical-participant ceiling, total command-definition
   bound, aggregate call/byte/statement/fact/event limits and most-restrictive
   profile resource limits. Grouping physical installations does not create new
   budgets or bypass an existing count limit.
8. Preserve per-call stores, pending reads, event-to-participant evidence,
   rollback-only failure behavior, escaped-context refusal and closure ownership.
   Publish all contributions exactly once through the existing common finalizer,
   commit feed and outbox. Preserve replay and uncertain-outcome recovery.

This changes admission capability, not schema, migration, binding encoding or
public Application APIs. No new protocol version or compatibility runtime is
proposed. If implementation reveals a necessary persisted identity change,
different trust boundary or unsupported publication contract, stop for a revised
preflight rather than hiding it in this slice.

### B1 Validation And Completion

- First add the distinct-participant failing witness described above at the
  shared owner. Use neutral table/profile fixtures, not Medusa entity names.
- Prove three disjoint profiles on one installation and a mixed request with a
  second installation. Assert confined reads/writes, pending visibility, complete
  facts with distinct table/key identities, one commit and exact event ownership.
- Refuse forged tokens, duplicate names, overlapping tables, conflicting pins,
  unbound or revoked profiles, wrong scope/placement and stale prepared evidence.
- Prove deterministic preparation and lock order, one physical acceptance per
  installation, stable replay under input permutation and refusal when a selected
  profile, command or event contract changes. Use owner-level observations; no
  public diagnostic capability or production counter API.
- Prove late/caught failure and budget exhaustion roll back every contribution;
  include unused members, repeated calls, concurrent attempts, escaped lifetimes,
  exact replay and uncertain commit outcome. Retain existing limits/assertions.
- Add the connected Product + Sales Channel witness using existing admitted
  commands on the fourteen-table candidate. No Link tables or new Sales Channel
  lifecycle commands are needed for this proof.
- Run affected owner and consumer regressions on PGlite and ordinary-role real
  PostgreSQL, plus affected strict typechecks, source/import guards and lint.
  Run both required project reviewers on the exact final code checkpoint, then
  staged lint and one scoped commit. Neither database lane proves hosted scale.

## B2: Native Characterization Before Key And Publication Approval

Native Link needs a distinct, source-backed contract; B1 does not authorize it.
Relevant source paths under `third_party/medusa/upstream/packages/`:

| Native owner | Consequence for the next contract |
| --- | --- |
| `modules/link-modules/src/definitions/product-sales-channel.ts` | Many-to-many endpoints; no extra fields or endpoint `deleteCascade: true`. Do not admit other cardinalities by implication. |
| `modules/link-modules/src/utils/generate-entity.ts` | Endpoint pair is the physical primary key. Generated `id` is separately indexed; managed timestamps, soft deletion and active endpoint indexes are real storage requirements. |
| `modules/link-modules/src/repositories/link.ts` | Create generates an ID, clears `deleted_at`, calls `upsertMany`, then returns the constructed objects rather than the upsert return value. Repeated attach/reattach identity and timestamp outcomes require native characterization. |
| `modules/link-modules/src/services/link-module-service.ts` | Native service owns normalization, serialization, attached/detached events and lifecycle return maps. Event inputs differ between create, dismiss, hard delete and lifecycle operations. |
| `modules/link-modules/src/services/link.ts` | Create forwards `transactionManager` in a narrowed context. Prove existing scoped manager propagation; do not patch lost authority with an adapter-local fallback. |
| `core/modules-sdk/src/link.ts` | Native Link owns routing and cascade traversal. Explicit loaded modules avoid global fallback. `delete` invokes soft-delete traversal; it is not repository hard delete. Cascade errors are returned as data and need explicit boundary treatment before atomic success is admitted. |

Characterize first attach, repeated attach, same-pair duplicates in one batch,
attach after dismiss, repeated dismiss/restore, missing endpoints and concurrent
same-pair operations. Observe returned versus stored IDs, all managed timestamps,
visible/deleted rows, event payloads/counts and lifecycle return maps. Preserve
native routing tests, but do not claim their mocked services prove persistence.
Native Link create neither declares physical endpoint FKs nor validates endpoint
existence; adding liveness checks is a compatibility decision, not an automatic
core safety fix. Scope isolation remains mandatory.

Then freeze the narrow shared declared-key mutation/conflict/lifecycle contract.
`commerceTransaction/profile.ts` currently restricts update/lifecycle to scope
plus one primary-key component; the Link needs scope plus two. The existing
relational key codec supports multiple ordered components, but that alone does
not admit upsert or lifecycle behavior. No surrogate-key rewrite, adapter SQL,
local limit bypass or borrowed Product-pivot semantics is acceptable.

The adoption roadmap still requires transaction-bound commerce-link receipts,
typed facts and exact event admission before the first stored Link write. B2 must
explicitly decide whether existing authenticated relational closures and fact
encoding can fulfill that contract with checked Link evidence, or which minimal
shared extension is actually necessary. This preflight does not waive that gate,
authorize a new feed family, or add a second finalizer. Resolve the representation
and reconcile its owning design before implementation approval.

## B3 And Gate C: Connected Proofs After Their Prerequisites

B3 promotes the finite native Link closure with guarded provenance and a cohesive
module construction entry point. Install a fresh fifteen-table Product + Sales
Channel + ProductSalesChannel candidate; preserve confined profiles. Prove the
characterized attach/dismiss/lifecycle, endpoint traversal, read aliases, events,
rollback and concurrency through the existing host. No existing-row module-set
upgrade, arbitrary Link registry, derived adjacency or public Query promise.

Gate C then promotes the actual
`core/core-flows/src/sales-channel/steps/associate-products-with-channels.ts`:
empty input returns before resolving `LINK`, nonempty input calls native create,
and compensation calls dismiss. Bind the native Link resource through the existing
workflow host. A short all-database atomic proof does not admit remote effects,
workflow suspension or general cross-commit compensation. Full Product creation
still requires the Pricing, Inventory/Stock Location, shipping-profile and
transitive dependency work identified in preflight 50; Customer is not required.

## Retain / Extend / Replace / Delete

| Action | Boundary and retirement gate |
| --- | --- |
| Retain | Native pinned source and original assertions; existing standalone and multi-installation atomic consumers; confined profiles and trusted settlement. These are active proof consumers, not parallel legacy engines. |
| Extend in B1 | Existing physical installation/admission owners and logical participant preparation, with neutral and connected tests. No schema or native Link promotion. |
| Replace in B1 | The one-installation-per-participant assumption and repeated physical preparation/acceptance with shared physical grouping inside the same owner. |
| Defer to B2/B3 | Composite-key mutation/lifecycle, Link receipt/event admission, portable native Link storage and query translation. Each needs its frozen semantic contract before code. |
| Delete in the owning slice | Temporary duplicated admission helpers, diagnostic scaffolding and displaced assembly once decisive assertions live at the real owner. Keep no dual path without a demonstrated compatibility obligation. |
