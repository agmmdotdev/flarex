# Product Relationship Workflows

Status: implemented private atomic capability. The shared request call-budget
extension was separately approved and preserves existing callers' limits.

## Outcome And Boundaries

Port the pinned collection-assignment and category-membership workflows and
compose both under one private native atomic root. Read the resulting Product
and Collection relationships through Local Graph Query before settlement.
Keep the existing SDK, scoped service registrations, Product commands, relation
storage, event/fact checks, request identity, bounds and transaction owner.
No additional commerce module, Module Link, Task, lock, schema, generic graph
rewrite, relational OCC, external effect or public-serving contract is added.

The user's approval follows the proposed complete relationship-workflow slice.
This note records its preflight and owns its completion criteria with Topics
06, 10, 11 and 15. A defect exposed in a shared owner still needs its own
diagnosis and correction approval under AGENTS.md.

## Source Evidence And Design Challenges

The source is the checked-in Medusa fork at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` (2.13.4):

- `product/workflows/batch-link-products-collection.ts` and its step retrieve
  all admitted collection members, remove requested IDs, append additions and
  call `updateProductCollections`. Adding an ID also listed for removal wins.
- `product/workflows/batch-products-in-category.ts` and its step list requested
  Products with categories and upsert their complete category ID lists. Removal
  wins for a Product appearing in both input lists. Unselected categories stay.
- Both return void and short-circuit when both lists are absent/empty. Preserve
  these differing overlap rules; do not normalize them to a new common policy.
- The Category fork requests `take: 256` explicitly. Its relation-specific
  method admits at most 256 selected IDs, so all existing selected Products are
  read before updating. Ordinary Product list pagination remains 15; relying on
  that default here would silently omit part of a membership batch. The connected
  16-Product case proves complete selection and update.
- `ProductModuleService.updateCollections_` explicitly disassociates and then
  associates Product rows. Membership changes never delete Product rows.
  Existing collection compatibility checks prove moves, clearing, missing IDs,
  scope isolation and rows beyond the default list page. Category upserts with
  IDs update existing Products rather than authorizing arbitrary creation.
- Existing `product-service.ts` supplies list/retrieve/update/upsert command
  tokens and `product-local-events.ts` checks actual emitted events against
  captured row facts. Workflow methods admit only the relation-specific inputs.
- Collection updates emit both Collection and Product update events. The
  private method registration's singular `moduleEvent` is insufficient even
  though Topic 15's core accepts finite participant event sets. Replace that
  adapter metadata with captured, checked `moduleEvents` sets, include the
  complete method association in execution identity, and select their union.
  Do not select an unused write method merely to admit its event name.

Cross-module links have different storage/lifecycle ownership, as described in
`../flarexdb-framework-integration/05-relations-links-and-references.md`.
Collection/category membership already has authoritative local columns/pivots.
The existing trusted root serializes same-scope commands; concurrent read-modify-
write proof must use that owner, not introduce workflow locking or pretend that
relational facts provide Application OCC evidence. Like the accepted Convex
comparison in Topic 11, reusable function definitions do not own settlement;
Flarex retains sticky whole-root rollback rather than nested savepoints.

## Disposition

| Path | Decision |
| --- | --- |
| Pinned two workflow/step business sequences | Port; relocate imports, mark compensation transaction-covered, make Category's bounded selection page explicit. Retain original compensation bodies as inactive source compatibility evidence. |
| SDK child composition, graph planning, Product services/repositories | Keep and reuse. |
| Private singular method event metadata | Replace with finite captured sets; update all current consumers, no compatibility fallback. |
| Parent relation workflow and typed method/input/output boundaries | Author behind existing shared host. |
| Atomic request call allowance | Extend trusted preparation with an explicit profile-bounded selection; keep omitted defaults and identity unchanged. |
| Lifetime accounting, SQL statement ceiling, schema, relation storage, settlement, event publication/delivery | Keep unchanged. |
| Source-island references | Keep immutable; promotion manifest records copied and adapted files. |

## Implementation And Proof

1. Register relation-specific method schemas and finite event sets; pin capture,
   invalid/duplicate/oversized declarations, inference and replay association.
2. Promote both real workflows and steps; assemble a collection-then-category
   parent with pending Product/Collection graph reads. Each child remains usable
   independently through the generic host.
3. Run connected PGlite and ordinary-role PostgreSQL cases: add/remove/overlap,
   preserved memberships, moves, clearing, missing IDs, no-op, final graph state,
   one commit, exact internal events/facts, replay without mutation, late failure
   rollback, malformed input/refusal, and finite bounds. On PostgreSQL prove
   outside-transaction invisibility and competing membership updates without
   lost changes. Keep original assertions and existing default resource ceilings.
4. Run original Product/Currency and existing workflow regressions, affected
   typechecks, promotion/source/portable guards, lint and both custom reviewers.
   Reconcile this note and the workflow index, commit only owned files, stop
   owned database processes and remove owned workspace database artifacts.

Completion means actual imported relationship workflows compose with native
atomic semantics and correctly admitted events. It does not claim full Product
workflow, general Module Link, durable workflow or deployed Cloudflare parity.

## Connected-System Finding: Request Call Budget

Reproduction: run `test/product-relationships-workflow.test.ts` with the adapter's
`vitest.config.ts` (PGlite) or `vitest.postgres.config.ts` (ordinary-role PostgreSQL).
The `composes real children` case seeds three Products, two Collections and three
Categories. One root moves one Product into a Collection, removes another,
preserves its remaining member, then adds/removes the corresponding Category
memberships and reads both pending relationships.

Expected: the approved complete root commits once with both relationship changes,
six internal events and graph output. With the default 64-call host on both
drivers: `rollbackOnly`
retains `limitExceeded` from `boundedRequestLifetime.ts`'s `enter`, where the
65th charged entry exceeds the existing 64-call ceiling. Each original child
passes independently through the default host. The late-failure assertions
require proof that both children finished and the late callback/output boundary
was reached. The PostgreSQL concurrency witness races its observation gate
against root completion, so it cannot hang after early root refusal.

The default refusal occurs after the Category child's input capture, before its
return and the final graph reads. It is a shared call-budget limit, not evidence
of missing workflow locks.

Owner: `packages/persistence-postgres/src/atomicCommerce/host.ts` chooses the
minimum of `commerceLimits.calls` and every admitted profile's calls. Its
checkpoint/capture, participant entry, event capture, table lookup, nested
service work and store operations all use the shared
`packages/persistence-postgres/src/boundedRequestLifetime.ts` counter. That
counter is also used by other domains. Existing resource contracts describe
higher call limits, but the historical atomic host capped every profile at 64.

Disposition: preserve the failing success assertions and existing ceilings.
Do not split the root, substitute direct SQL, skip validation, add a new lifetime
per child, or change the shared owner incidentally. The owning finding is also
recorded in Topic 09. The user has now explicitly approved work on the shared
request-budget contract; the correction below is within that authorization.

### Approved Correction Preflight

Keep the existing `BoundedRequestLifetime` and every charge unchanged. Introduce
one optional `requestCallLimit` on trusted atomic host preparation, validated
against the existing Commerce resource call ceiling (1..4096). Omission keeps
64. Intersect the selected limit with every authenticated participant profile's
call ceiling. An explicit selection enters request policy identity, so replay
cannot silently cross a resource-policy change; omitted configurations retain
their current identity bytes. The host snapshots this primitive before async
preparation. Request arguments and child definitions cannot select it.

Explicit-limit identity hashes have a private non-JSON domain prefix. Without
it, an arbitrary legacy policy shaped like `{ policy, requestCallLimit }` could
collide with the new wrapper. The real-host regression commits that legacy shape
and proves the explicit-limit host refuses its replay, while its fresh execution
still enforces the smaller budget.

The Product relationship host explicitly opts into 256 calls and an installed
Product workflow profile with the same call allowance. That profile retains all
ordinary row, fact, byte, event and value limits. Other Product profiles and all
existing host defaults stay unchanged. This is a finite conformance profile,
not a promise that every structurally valid 256-ID input fits its budget.
Pin old-default refusal, explicit-budget exhaustion, participant
ceilings, policy replay conflict, rollback and successful connected execution.

An observation-only wrapper around the real lifetime methods measured
94 entries for the mixed composition including its final test observer: one root,
87 operations and six participant entries. The 16-Product Category scenario used
77 entries. The wrapper preserved all arguments, effects, limits and settlement
and was removed after measurement. Ordinary Effect tracing alone saw only the
outer runner, because Medusa callbacks use their own scoped Promise bridges;
that partial count was not treated as total accounting.

The SQL statement budget remains a separate aggregate 64-statement ceiling.
`requestCallLimit` cannot widen it, the 1 MiB aggregate byte limit, the 64-event
limit, the fact limit, the 10-second request deadline or database timeouts.
An existing installation must explicitly admit the workflow resource profile;
preparing a workflow never changes an installed profile or activates a binding.
Trusted host composition selects the allowance once:

```ts
prepare: composition => makeAtomicCommerceHost({
  ...trustedHostInputs,
  ...composition,
  requestCallLimit: productWorkflowResources.calls,
})
```

A test-local missing-ID scenario originally reused `missing-category` and
`missing-collection`, which another case had created. Unique absent IDs corrected
that fixture error; both failure and whole-root rollback assertions remain.

The default and explicitly smaller host profiles retain their refusal witnesses.
Connected tests cover whole-root budget rollback, participant ceiling intersection,
configuration capture, replay policy changes, full event admission, pending graph
visibility, final-output refusal, competing additions and absent references.
Unchanged Product/Currency cases and prior workflow consumers remain regression
gates. There is no diagnostic wrapper, legacy singular-event fallback, per-child
budget, secondary transaction or Task implementation to retain.

### Validation Diagnostics

Overlapping validation workloads exposed a PostgreSQL timeout in the unchanged
Product case `images > should retrieve images ordered by rank`: `57014`,
`canceling statement due to statement timeout`, while `writeCommitHeader`
inserted `fx_system_commit`. The expected behavior is ordinary successful
publication inside the existing one-second statement bound. PGlite workflow
fixture installations also exceeded their existing setup budgets under that
overlap. Keep validation workloads separate without relaxing assertions or
deadlines; repeatability under concurrent load remains unproven.
Concurrent load is a hypothesis, not an established root cause. No publication,
store or migration-owner correction is authorized or made from this evidence.
