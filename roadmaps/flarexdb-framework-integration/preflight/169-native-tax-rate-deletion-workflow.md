# Native Tax Rate deletion and retained restore

## Status and authority

Status: implemented, validated and reviewed as a private bounded Rate lifecycle
profile on PGlite and ordinary-role PostgreSQL. The original native workflow and
complementary history branches are characterized. The scoped portable ordering
below is approved for this Rate root. Earlier physical-inverse and Rule-only
lifecycle approvals are separate contracts.

The reference is Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The selected root is
`deleteTaxRatesWorkflow`, following
[Rate selector updates](./168-native-tax-rate-update-workflow.md).
Only the trusted outer owner settles and publishes. Native step transactions,
compensation and already-delivered events remain distinct from private atomic
rollback, authenticated replay and durable publication. Necessary shared-owner
corrections retain standing authorization; native business divergence requires
an explicit decision.

## Connected native contract

The genuine workflow and `deleteTaxRatesStep` call `softDeleteTaxRates` with the
raw ID array, including `[]`. The workflow returns void and retains the requested
IDs. Empty retained compensation skips Tax resolution. Nonempty compensation
calls `restoreTaxRates` with the raw request, preserving duplicate and missing
positions rather than substituting the forward affected cohort. Generated native
service methods own the affected maps and Tax joiner/linkable-key mapping.

The four-model Tax DML remains installed. Rate deletion cascades to Rule
descendants, including already-deleted children. The native forward query selects
active Rates beneath active Regions. Restore selects requested active and deleted
Rates beneath active or deleted Regions, then their current complete Rule
history. The two calls therefore may select different graphs. A forward no-op
does not imply an empty retained restore.

Receipt validation distinguishes complete indexed dependency observations from
the rows returned after visibility filtering. Historical requested Rates and
historical Region support bodies may be observed without joining the active
forward selection. Every observed body and identity remains authenticated;
selection, counts and current cascade membership follow the command prestate
and exact admitted predicates. Restore retains its historical visibility.

Generic native cascade traversal and repository writes remain their owners.
Neither the standalone Rule lifecycle root nor physical deletion/upsert is a
substitute for this graph. The workflow requires no Region/provider mutation,
remote effect, graph query or independent Tax calculation authority.

## Characterized native behavior

Empty, missing and empty-string IDs produce empty affected maps and no row
changes. Empty forward input still calls the native service. Duplicate/missing
raw positions remain in retained compensation while actual affected identities
and events are deduplicated by the native operation.

An ordinary Rate and its Rules share the forward deletion timestamp. A
previously deleted child is included and retimestamped; its genuine mutation
event is `updated`, while newly deleted rows emit `deleted`. Restoration emits
no module messages in this construction. Successful cancellation restores the
current graph, preserves business content and retains native timestamp effects.
Already-deleted requested Rates are skipped by forward deletion but can be
restored by the raw retained inverse. Active restore can restore a deleted
child; repeated active restore can return affected identities without writes.

Current membership is selected again at inverse time. A later active Rule is
included. A separate genuine native intervention creates a later Rule, restores
and re-deletes its whole Rate graph, then cancels the original workflow. That
original retained cancellation restores the Rate and all three now-historical
Rules. The earlier direct child-delete control remains a no-op beneath a deleted
Rate and does not establish that historical state.

Physically missing Rates or Rules are not recreated. Rate-default and Rule-key
occupiers can make native cancellation fail with `invalid_data`; the inverse
transaction leaves complete cold tables unchanged, including a conflict in a
multi-Rate graph. Unrelated Rate/Rule rows and all Region/Provider content remain
unchanged. Late-parent failures genuinely compensate, while previously delivered
native deletion events remain separate from outer atomic publication.

The maximum original successful cycle selects four Rates across two Regions and
eight Rules. Independent genuine Tax calculation observes the matching Rate
before deletion, no matching lines after deletion and the same Rate after SDK
cancellation. An unmatched calculation control remains empty throughout. A
separate original-only graph with nine historical/current descendants is outside
the proposed eight-Rule bound.

Native ordering is not a SQL guarantee. Maximum Rate creation uses `c,d,a,b`,
while the observed affected Rate map is `a,b,c,d`; the selection has no `ORDER
BY`. Rule maps can follow a different order from IDs and can change after
historical updates. ORM flush events interleave Rates and Rules rather than
concatenating the affected maps. Neither caller order nor immutable creation
order is a valid general replacement for these observations.

## Bounded private implementation

One confined Tax instance exposes only genuine `softDeleteTaxRates` and
`restoreTaxRates` workflow methods. The profile admits at most four raw ID
positions, four selected Rates across two Regions and eight complete Rule
descendants, including active and deleted rows. Keep raw positions unchanged for native retained
callbacks. Each forward and separately committed inverse keeps the existing
64-call/64-event limits and all other limits. No extra transaction, lifetime,
fallback or resource allowance is selected.

Reuse checked Tax DML contracts, native generated service behavior, the scoped
bridge and mutation subscriber, `medusaLifecycle.plan`/apply and the shared graph
receipt. Translate the distinct forward and historical restore root queries;
read-only Region support may establish native visibility, but Region/provider
repositories and writes remain denied. Select and bound the complete eligible
graph before its writes, including all historical children and empty per-Rate
child reads. Do not page or silently truncate the graph.

Receipts must decode complete support rows, authenticate exact root/child query
recipes and counts, reconstruct current membership, and correlate complete
preimages, managed changes, unchanged restores, affected maps and native events.
Supply each actual prior `deleted_at` to the unchanged native event interceptor;
the Rule-only adapter's fixed active preimage is unsuitable for historical
children. The native flat message aggregator can retain the selected event order
without replacing action classification or event construction. Restoration
retains its absence of module messages.

The approved portable order is Rate affected IDs and events by Rate ID ascending,
then Rule affected IDs and events by parent Rate ID and Rule ID ascending, with
all Rate events before Rule events. It fits the existing
shared lifecycle's ordered traversal and topological table writes; it does not
claim parity with native SQL/ORM flush order. Other profiles keep their existing
orders. No shared-core defect is established by this preflight.

## Admission and deferrals

The private profile includes the genuine source-pair promotion, confined native
module, repository and receipt correlation, and separately committed retained
compensation. Original native witnesses remain separate from the approved
portable ordering contract. The admitted graph covers maximum forward and
retained inverse roots, mixed/current history, Region visibility, missing and
duplicate inputs, active no-ops, later descendants, physical absence, uniqueness
conflicts and late-parent rollback.

Complete-body corruption and forged read/map/event evidence refuse. Scope and
resource boundaries, authenticated replay, interruption settlement and method
revocation remain enforced. Failed atomic roots publish no durable outcomes;
native retained compensation and previously delivered messages retain their
separate lifetimes. Forward and retained inverse each use the default limits.
The profile does not establish arbitrary graph size or hosted activation.

Tax Region/provider administration, general Tax workflows, Cart admission,
remote providers, populated-schema conversion, performance acceptance and
production/hosted activation remain separate.
