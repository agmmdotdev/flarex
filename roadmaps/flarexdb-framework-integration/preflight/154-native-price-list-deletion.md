# Native Price List deletion preflight

## Status and closure

Status: implemented private bounded profile. The complete native root and
retained callbacks use the approved portable ordering and named 128-call
allowance below. Product chunked file import and Product export remain deferred.

Authority is the accepted [Medusa boundary](../../../design-notes/flarex-db-accepted-design.md#medusa-boundary),
[commerce adapter design](../../../design-notes/flarexdb-medusa-commerce-adapter.md),
[source promotion contract](./04-medusa-fork-source-island-and-package-convergence.md)
and Medusa 2.13.4 at `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`,
recorded in `third_party/medusa/SOURCE.json`. Native paths below are relative to
`third_party/medusa/upstream/`:

- `packages/core/core-flows/src/price-list/workflows/delete-price-lists.ts`
  stages the actual Pricing deletion and common Link cleanup, returning the
  Pricing step's undefined result.
- `packages/core/core-flows/src/price-list/steps/delete-price-lists.ts`
  always calls `softDeletePriceLists(ids)`, retains the raw requested IDs and
  calls `restorePriceLists` on cancellation unless that array is empty.
- `packages/core/core-flows/src/common/steps/remove-remote-links.ts`
  groups those same raw IDs under `pricing.price_list_id`, calls genuine
  `Link.delete`, retains the grouped input and calls `Link.restore` on inverse.
- The generated Medusa service, original Pricing/internal services, six native
  Pricing DML models, default MikroORM repository and LocalEventBus own
  lifecycle selection, traversal, return maps, dirty detection and events.

The genuine compiled SDK graph executes Pricing before Link. Cancellation
executes Link restoration before Pricing restoration. Source statements alone
do not establish parallel steps. Empty IDs still call both resources; the
Pricing inverse skips empty IDs while the grouped Link inverse still runs.

The complete root needs existing Pricing and a genuine empty-family native
Link resource. Its selected Link registry and routing maps contain no module
families; real delete/restore/executeCascade calls remain observable. The native
Link return is `[null, {}]`. Query, Product/Region endpoint reads, providers,
Files, Locking and remote effects are absent. The public root returns void;
the existing finite SDK can represent the genuine direct staged-step return.

## Authenticated original evidence

The immutable external packet is
`%TEMP%/flarex-154-native-price-list-delete-witness`. Its frozen v2 runner
executes the original root, both complete callbacks, genuine containers and
resolver registrations, original Pricing/generated/internal services, all six
Pricing tables, default MikroORM, LocalEventBus and original SDK retained
cancellation on ordinary-role PostgreSQL. All 52 declared cases execute with
no filtered cases. Runtime malformed-input probes are separately labeled and
do not widen the declared `ids: string[]` contract.

The decisive report is
`unchanged-native-price-list-delete-v2-postgres-runs/2026-10-20T01-56-32.841Z-14804/report.json`
inside that packet, SHA256
`2cf9885ca24c40b796dd4d9e870c02fe878cd79cebe6a843608e36418089b06b`.
Runner SHA256 is
`9bff34386e5028d7c65e4cf888fbcb88600622870171a9b0f145e086a77bcb2a`.
The independent filesystem result `audit.full52-v5.json`, SHA256
`bae94d2d1085fd0e41aed1a26fd8f7763a1667d7a3a0f08c295fb0fe87593877`,
authenticates 52 case artifacts and 284 native-source/emitted pairs, with
52 owned schema absence proofs and 52 EventBus cleanups. Its auditor SHA256 is
`74e1883caebf947a560345ced448f70e6603474b8338a19dfca7754269ec4a98`.
It reports no authentication failures or semantic consistency findings and
retains 500 coverage notes. Those notes are evidence boundaries, not a claim
that every native business operation succeeded.

Actual forward states are 43 done and nine reverted. The 43 independent
retained inverse phases contain 40 reverted and three failed states. A reverted
forward can already include original child compensation; it does not establish
a separate successful inverse. Required historical/outside fixture setup is
proved in persisted rows before the native phase it is meant to exercise.
Native rejection is separate from harness/bootstrap, projection and cleanup
failure. The original baseline remains unchanged and must survive any candidate
portable behavior decision.

Role flags are asserted false by the authenticated runner before schema
creation, but raw role query rows are not independently retained or refreshed
by the filesystem auditor. Recorded dependency hashes cover actual entries and
nearest manifests, not every transitive package file. SQL logger records are
diagnostics, not exhaustive wire SQL or Flarex command accounting. Native calls
settle independently: this evidence proves no Flarex atomicity, adapter capacity,
production activation or cold recovery.

## Native lifecycle and retained inverse

The public workflow input is `{ ids: string[] }`; the deletion step and module
receive its raw `ids` array. Empty and arbitrary missing IDs,
empty-string IDs, raw order and duplicates reach native Pricing/Link calls and
retained callbacks. Soft deletion selects active existing roots; missing and
already-deleted roots contribute no forward mutations or events. Matched
identities are not duplicated by repeated selector IDs.

An active root owns its PriceListRules, Prices and those Prices' PriceRules.
The descendant traversal includes deleted history. Newly deleted identities
emit native deleted events; historical descendants that are retimestamped
emit updated events. Preserve non-lifecycle fields and native managed timestamp
behavior. PriceSets, external base Prices and their Rules, preferences, the
unrequested List graphs and unrelated protected data remain unchanged.

The original step retains requested IDs rather than the returned deleted map.
Its inverse reads current roots with deleted history and can restore a root
that was already historical before forward execution. It restores current
descendants, including historical children and later additions, rather than
reconstituting only the original forward graph. Already-active rows can be
selected in result maps without a dirty update. Physical removal leaves no
root to restore. Outside business-field edits survive because inverse is
lifecycle restoration, not snapshot replacement.

Original restore registers no soft-delete event subscriber and emits zero
module events in the characterized inverse phases. Do not synthesize restored
events from changed rows. Restoring historical PriceRules can violate the
active partial unique index when an active twin or outside collision exists.
All three observed inverse failures are preserved; the native Pricing inverse
transaction rolls back while the earlier independent empty-family Link inverse
has already completed. This is not authorization for a business repair.

Successful repeated native SDK cancellation invokes no new callbacks. Repeating
a permanently failed native cancellation rejects rather than retrying its
callbacks. The finite atomic host's committed-success replay, fresh-attempt
revocation/error behavior and whole-root rollback need their own existing
contract proofs; they do not claim post-completion native scheduler semantics.

Generated public return maps include `price_list_id`, `price_id` and
`price_rule_id`; the unmapped `PriceListRule` key contains actual native ORM
entities rather than an invented linkable-ID array. Public/internal lifecycle
returns are captured from enumerable own data without invoking getters,
`toJSON` or a native serializer. IDs and their actual before/after row
correlations are authenticated. ORM accessor omission markers remain explicit:
this is not proof of complete serialized ListRule DTO equality. A portable
result boundary must validate its complete admitted data without claiming that
those omitted native fields were observed.

Four selected roots with two Prices, two ListRules and four PriceRules each
produce 36 forward events in the maximum ordinary graph. Restoration emits
none. Historical or outside descendants require their own complete bounded
closure, rather than inheriting a forward create-shape cap. The existing
64-call default refuses the actual maximum adapter root on both PGlite and
ordinary-role PostgreSQL at call 65, before Pricing completes. This also prevents
the maximum retained inverse and late-parent witness from reaching their intended
operations. The approved deletion profile selects a named 128-call allowance
through the existing identity-bound resource API. Its 64-event allowance and all
other limits and profiles remain unchanged. The original 64-call failures remain
separate evidence. The named allowance covers the complete root, genuine
retained callbacks and maximum parent composition; it does not authorize an
unbounded graph or additional resources.

## Ordering owner gap

The original default MikroORM traversal mutates an entity's deletion state
before fetching its cascade relations. Its automatic flush before those reads
can emit that pending entity while traversal is still in progress. Actual
cross-root vectors therefore interleave models; they are not one global batch
per table. Root queries have no explicit ordering, and descendant discovery
also uses asynchronous recursion. Return-map ID arrays depend on actual read
and completion order. A universal SQL physical-return order must not be
inferred from these bounded observations.

The shared `medusaLifecycle` owner instead plans complete bounded membership
before mutation and applies groups in dependency order. A table-order flag
cannot reproduce the original flush schedule. Do not add a fake ordering
option, emulate MikroORM's unit of work, copy its cascade algorithm into an
adapter, sort native outputs/events after the fact, or use direct SQL to make
a fixture appear equal. A named portable lifecycle profile must state the
observable difference rather than change shared publication or invent an
adapter event-order repair.

There are separate ordering obligations. The native public related-ID-map
documentation promises identities without specifying an order for those arrays.
That absence does not relax workflow causality, full result shape, event
identity/multiplicity or the actual emitted sequence. The accepted
[event contract](../../workflow-foundations/07-durable-workflow-events.md)
stores observed emission order and distinct identical messages in ordinal-bound
canonical envelopes; it does not promise global subscriber completion order.
The [promotion contract](./04-medusa-fork-source-island-and-package-convergence.md#reuse-and-promotion-classification)
requires seam adaptation to preserve event order. Existing scoped membership
validators and previously selected portable Product contracts do not approve
a membership-only Price List deletion comparison.

## Implemented portable contract

The `price-list-deletions` admission uses the existing Pricing owner,
exposing only native soft-delete and restore commands with graph access off.
The root input is `{ ids: string[] }`, with zero to four raw strings of at most
256 characters, including empty, missing and duplicate IDs. Reuse
`PriceListDeletionIds`; stored-ID validation
must not replace the workflow's raw-ID grammar. The genuine empty-family Link
resource uses the same construction as Price Preference deletion with the exact
`pricing.price_list_id` endpoint grammar. Other profiles retain their contracts.

Reuse current `medusaLifecycle` unchanged. Its complete indexed reads use core
text-ID ascending order. Filter soft-delete roots to active rows; restore
selects matching active and historical roots. Visit selected roots sequentially.
The pinned PriceList relationship order visits Prices first, each Price's Rules
next, then that root's ListRules. Include history, deduplicate table/key identity
and complete every read/plan before mutation. The exact module catalog is
`[PriceList, Price, PriceListRule, PriceRule]`: Price and ListRule both depend on
List, so that explicit catalog resolves their otherwise unordered dependency
tie. Do not derive a different order by filtering the six-table metadata array.

The approved apply, event and result orders are:

| Family order | Planned rows within family | Native public result member |
| --- | --- | --- |
| PriceList | Selected root IDs ascending | `price_list_id`: IDs |
| Price | Root order, then each root's Price IDs ascending | `price_id`: IDs |
| PriceListRule | Root order, then each root's ListRule IDs ascending | `PriceListRule`: complete DML objects |
| PriceRule | Root order, Price order, then each Price's Rule IDs ascending | `price_rule_id`: IDs |

These are authenticated grouped parent traversals, not a global descendant
sort. The repository returns selected roots and nonempty model groups in its
native tuple, including selected active restore no-ops. No matches returns
`[[], {}]`. Keep the original generated Medusa service's `mapObjectTo` call.
Unmapped ListRule objects retain exactly id, attribute, value, price_list_id,
created_at, updated_at and deleted_at; use complete DML decoding rather than a
forward creation-shape cap. Omit only core document metadata through the
existing `projectNativeRow` edge. This is the accepted private JSON/DML
representation, without native getters or a populated ORM relation; accessor
omissions in the original evidence remain unproved rather than reconstructed.

After successful apply, dispatch each model's rows through the existing native
`afterUpdate` event dispatcher in that table/key order. Supply the true complete
preimage indexed by `(table, id)`, because IDs need not be unique across models.
The unchanged native classifier chooses deleted for active-to-deleted rows and
updated for retimestamped historical rows. Keep each action at its row position;
do not regroup by action or sort messages. Restore retains its original
unsubscribed boundary and emits zero events, including for restored rows.

This deliberately changes the characterized soft-delete event sequence. For
example, native flushes can yield List(a), Prices(a), ListRules(a), List(b),
Rules(a), while the approved profile emits all Lists, all Prices, all ListRules, then
all PriceRules. Identity/action membership, multiplicity, historical semantics,
required calls and original inverse behavior remain strict obligations.
Actual producer order still enters unchanged ordinal/digest publication.

Reuse `correlateLifecycleGraphReceipt` for managed transitions, no-op restores
and per-table ordered identities. Authenticate complete returned ListRule
objects against final row evidence before supplying an ID-only proof projection
to that helper; do not change the actual method result. Pricing still owns
complete reads/FKs, preimages, exact ordered events and protected data. No new
global fork/cascade abstraction, ordering API, ORM scheduler or core exception
is introduced. The original source-only proposal is
`%TEMP%/flarex-154-outcome-analysis/portable-policy.proposed.v1.md`, SHA256
`8fe29d11cecc1db433ee3c2a7731f2a17b83074b4531ef7bc6a7edb41c27faac`.

The explicit approval covers only this named154 event sequence in place of the
captured native flush sequence. Specifying an order for native-unspecified
ID-map arrays is part of the stated portable contract.
This is no broad timing/failure waiver: unique collisions must still refuse
with complete inverse rollback under the existing typed core error boundary.
Existing private managed-time, full-plan-before-write, JSON and atomic/replay
boundaries remain explicit; no per-flush wall-clock or independent native-call
settlement equivalence is claimed. The event-order approval is separate from
the standing core-change approval. Preserve the unchanged 52-case baseline
and separately label portable contract tests. The implemented profile retains
the genuine root, native callbacks and original cancellation inputs.

## Ownership and remaining gates

Pricing reuses unchanged shared `medusaLifecycle` for complete indexed reads,
history traversal, managed transitions and planning before writes. The module's
receipt authenticates relational reads, table-qualified preimages, current
membership, complete native output and exact scalar event positions through
the existing graph correlator. Historical restamping, active restore no-ops,
outside additions and edits, physical removal and unique-conflict refusal retain
their native lifecycle semantics. Complete private DML output validation does
not fill accessor omissions in the original ORM evidence.

The trusted facade authenticates the exact module/profile and admits only the
two lifecycle methods plus genuine empty-family Link deletion/restoration.
Its frozen resource selection changes only calls to 128. The existing core
binds both participant and request selections into replay identity; callers
cannot supply allowance knobs or a different complete resource profile. Other
Pricing admissions and their default 64-call refusal remain unchanged. No core
profile, transaction, event-accounting or settlement extension is introduced.

The supported closure includes raw empty/missing/duplicate selectors,
retained and repeated restoration, maximum root/parent composition, rollback,
changed replay identity, revocation and cancellation. Hosted activation,
durable external delivery, arbitrary graph scale and cold scheduler recovery
remain separate gates.
