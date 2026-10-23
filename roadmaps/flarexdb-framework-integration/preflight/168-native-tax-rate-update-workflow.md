# Native Tax Rate selector update

## Status and authority

Status: the private bounded Tax Rate selector-update profile and its retained
preimage upsert compensation are admitted on PGlite and ordinary-role
PostgreSQL. Original native branches remain separate comparison authority,
including field grammar and projection-dependent historical-Region visibility.
No native business correction or resource allowance is selected.

The reference remains Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The selected root is
`updateTaxRatesWorkflow`, following
[Rule replacement](./167-native-tax-rate-rule-replacement-workflow.md).
`upsertTaxRates(prevData)` is its retained Rate-update inverse, not a standalone
Tax upsert workflow or a general upsert grant.

Accepted shared logical storage, framework ownership and workflow lifetime
boundaries apply. Necessary shared-owner corrections use standing approval.
Postgres owns committed rows and durable outcomes; only the trusted outer owner
settles the private atomic root. Original native step transactions, compensation
and already-delivered events remain distinct from whole-root rollback,
authenticated replay and atomic publication.

## Connected native contract

The native root is `tax/workflows/update-tax-rates.ts`; its Rate step is
`tax/steps/update-tax-rates.ts`, under the pinned core-flows source. The root
clones input through the genuine transform and removes truthy `update.rules`
before the Rate step. That step derives preimage selection from the cleaned
update, calls `listTaxRates(selector, { select, relations })`, then calls genuine
`updateTaxRates(selector, update)`. It retains the actual projected result and
passes it unchanged to `upsertTaxRates` during compensation. Empty retained
preimages skip inverse Tax resolution.

The root derives Rate IDs from the returned updated Rate array. Its inline
`maybeListTaxRateRuleIdsStep` skips Tax resolution when Rules are omitted or
falsy. A supplied empty array is truthy and lists active Rule IDs with
`select: ["id"]`. Native default selection uses ascending IDs without a default
page limit. The existing deletion step soft-deletes nonempty captured IDs and
retains them for restore. The existing creation step always resolves Tax and
calls `createTaxRateRules`, including `[]` when Rules are omitted.

Replacement expands raw templates first and returned Rate IDs second. Each
template is spread before `created_by: update.updated_by` and `tax_rate_id`
overwrite its values. This differs from standalone Rule replacement's creator
policy; do not substitute that workflow or normalize the templates separately.
Raw template order and supplied identity-sharing behavior retain their native
owners. Existing approved Rule lifecycle and physical-inverse ordering profiles
remain distinct from native SQL ordering observations.

The workflow returns the earlier updated Rate DTO array, before Rule
replacement. Native cancellation physically deletes the created Rule cohort,
restores the captured old Rules and then upserts the retained Rate preimages.
Actual compensation failures and progress remain part of the contract;
whole-root rollback does not replace this retained callback graph.

The native `TaxModuleService` retains manager/event decorators, transaction-managed
Rate update, generated list and Rule lifecycle services, internal services,
repository dispatch and serialization. The update root removes Rules before
the Rate service call, so that service's separate direct nested-Rule update
algorithm is not a substitute for the workflow graph. The retained upsert calls
the internal Rate repository directly rather than custom nested Rate creation.

The complete four-model Tax DML remains installed: SQL-real Rate values,
non-null code/name, nullable metadata/creator, Boolean defaults, Region foreign
keys, active default uniqueness per Region and active Rule uniqueness on
`(tax_rate_id, reference_id)`. No Query graph, Module Link, Product lookup,
provider calculation, Region write or remote effect belongs to this root.
Existing native local provider construction supplies no additional authority.

## Characterized native behavior

The original branch establishes ordinary scalar updates, empty updates, no
matching Rate, actor fields, nested and heterogeneous metadata, empty and
nonempty Rule replacement, sparse retained inverses and late-parent failure.
The characterized maximum selects four Rates across two Regions, retains eight
old Rules and expands two templates into eight new Rules. Creation, request and
ID orders differ. The complementary branch covers duplicate/missing raw selector
IDs, Region/code selection, SQL-real rounding and range refusal, default/Rule
constraint failures, supplied Rule identity sharing, historical and later Rule
preservation, retained restore conflict and repeated cancellation. The separate
field branch establishes nullable Rate/metadata, empty name/actor/metadata,
singleton default selection and combined code/combinable updates.

Preimages are sparse native DTOs, not complete snapshots. A name update retains
`{ id, name }`. Empty update requests empty selects/relations and retains the ID
plus native Region identity/scalar reference. A no-match selector returns and
retains empty arrays. Original empty update and its inverse make no raw change.

The original ORM accepts dotted metadata selections and returns the complete
metadata column. It ignores unknown selected root properties such as
`updated_by`, while retaining primary keys. Thus selecting name and actor
retains only ID/name; actor alone retains only ID. These are successful native
projections, not the preimage failures hypothesized from the selector helper.
The framework projection translation must preserve these exact outcomes from
checked model metadata. Do not fix the native helper, fetch extra scalar fields
or substitute a complete snapshot.

Native Region visibility depends on that projection. Narrow name, actor-only
and metadata preimage reads retain an active Rate whose Region is deleted. The
full Rate read used by the forward update excludes that Rate, as does an empty
select that includes the native Region relation. A retained preimage cohort can
therefore exceed the actual updated cohort; neither an unconditional active-Region
guard nor a shared filtered cohort preserves the native contract. The sparse
retained upsert for such a Rate fails required `code` validation rather than
restoring or recreating it.

With four retained name preimages split between one live and one historical
Region, the genuine forward updates only the two Rates in the live Region. Its
inline Rule list captures their four old Rules and two templates create four
new Rules; Rates and Rules under the historical Region stay unchanged. Native
cancellation removes the new Rules and restores those old Rules before the
retained Rate upsert fails required `code`. That Rate transaction rolls back,
including attempted restoration of the two live Rates, while the earlier Rule
compensations survive. Preserve this partial native compensation progress and
its failure. The adapter's trusted outer atomic rollback and publication remain
separate guarantees.

`updated_by` is absent from Rate DML but is assigned as a transient native entity
property. It appears in the immediate Rate result when supplied, while cold
reads and storage omit it. The Rate's persistent `created_by` stays unchanged.
Rule replacement uses that actor as its new Rule creator. When it is omitted,
the template creator is overwritten and the stored Rule creator becomes null.
An empty-string actor remains an own immediate `updated_by: ""` value without
changing stored Rate content or its timestamp.

Immediate Rate results contain complete native scalar values and
`tax_region_id` with `tax_region: { id }`; they omit `rules` entirely. Cold reads
with explicit Rule population observe the resulting active Rule graph. Creation's
empty-collection DTO contract cannot be reused for this update output.

The native field branch accepts null Rate and metadata values, an empty name,
setting one selected Rate as default and changing code together with
`is_combinable`. The composite Region/code selector retains the selected cohort
even when the update changes its code. A null code instead fails the native
non-null model constraint despite the public DTO's nullable declaration. An
empty metadata object preserves the original metadata and update timestamp,
emitting no update event. These successful field updates retain their genuine
preimages and restore their original business content during compensation.

Native internal update prepares metadata before repository assignment. Top-level
empty-string values remove keys, while a supplied nested object replaces that
nested value in the characterized update. For multiple selected Rates, the
internal service mutates a shared update object while walking them. Distinct
original metadata can cross into other selected Rates: both characterized
two-Rate updates finish with the first Rate's owner value and a union of keys
from both Rates. The four-Rate maximum also preserves shared forward metadata
and its distinct retained preimages alongside Rule replacement. Preserve this
forward behavior through the native normalized update pairs; independent
per-Rate adapter merges would change it.

Each retained metadata preimage nevertheless contains its own complete original
object. The genuine inverse repository assigns without the forward
`mergeObjectProperties: true` option. Characterized nested and two-Rate inverses
restore the original metadata exactly, removing introduced keys and restoring
removed values. Original Rules, creators and unrelated tables also return to
their original content. Generated update-time differences do not establish
compensation content loss. These outcomes do not authorize a general exact
snapshot-restoration API.

A retained name-only inverse after independent physical removal or soft deletion
of its Rate fails native recreation: the sparse input lacks required `code`.
The physically removed Rate remains absent; the soft-deleted Rate remains
deleted with its later content. Preserve these native failures rather than
inventing complete reconstitution, resurrection or an early active-only guard.
The characterized late-parent failure invokes the genuine retained upsert,
restores business content and leaves original native delivered update events.
Accepted atomic-root publication remains a separate execution guarantee.

Native SQL-real update returns the submitted immediate value while cold storage
uses the actual database conversion. Rounding and minimum-subnormal success
remain distinct from finite underflow/overflow refusal. A supplied Rule ID
expanded across four selected Rates retains positional aliases while creating
one canonical Rule; cancellation removes that identity once. Predeleted Rules
are excluded from the captured old cohort, and later unrelated Rules survive
the retained inverse. Genuine independent calculation observes the matching old
Rules, their replacement and retained restoration. These outcomes do not establish
general selector, graph or resource support.

## Private bounded profile

The profile admits zero to four projected Rate preimages and zero to four
actual updated Rates across at most two existing Regions, zero to eight complete
active old Rules, zero to two replacement templates and at most eight expanded
new Rules. The finite selector/update grammar preserves no-match and
omitted/empty branches, raw identities, native ascending selection, metadata
behavior and complete output presentation. Each native projection's Region
visibility applies before its complete selected-cohort limit; preimage and
full-update cohorts are authenticated separately. Complete preimages are bounded
at their read before Rate updates. The genuine root updates Rates before its
inline old-Rule list. An oversized complete old cohort is refused before Rule
writes, and the existing atomic owner rolls back preceding Rate writes and
publication without another transaction or a changed native call order.

The genuine forward root and separately committed retained inverse each keep
the default 64 calls, 64 events and all other resource limits. A synthetic
composition that runs the forward root and all three manual retained callbacks
in one request lies outside that root allowance. It is atomically refused with
the original limit failure and rollback-only Cause; it grants no larger budget,
extra transaction, hidden lifetime or fallback.

One confined Tax instance and Rate-and-Rule participant is constructed through
the existing `modules/tax/module.ts` entry. Checked Tax DML row/default contracts,
scalar read/serialization, scoped bridge, mutation subscriber and events retain
their existing owners. Rule creation, physical inverse, soft-delete and restore
repositories borrow the same bridge/events, as in Rule replacement. Only the
connected projected Rate list, selector update, retained preimage upsert and
Rule list/create/delete/soft-delete/restore methods are exposed. Region and
Provider repositories remain denied and calculation grants remain separate.
Checked Region support reads through the same persistence bridge authenticate
visibility without exposing a Region repository or adding a native Region
service call to the genuine root.

The Rate update/inverse surface belongs at the framework repository boundary
and reuses keyed update, query/projection, native JSON-assignment, mutation/event
and receipt owners. This named extension does not admit arbitrary update/upsert.
Receipts authenticate complete stored rows and raw support bodies, exact
projected preimages, separate actual update cohorts, normalized update pairs,
transient actor presentation and immediate versus stored SQL-real values.
Native business algorithms remain with their native owners.

The native internal service's metadata preparation block is extracted unchanged
as `@medusajs/utils/modules-sdk/prepare-update-metadata`. The service and receipt
owner reuse that same mutating `prepareUpdateMetadata` operation, retaining
entity order, shared update-object identity, `isPresent` and `mergeMetadata`
behavior. Receipt evaluation uses detached causal preimages and preserves the
aliases between normalized update pairs; it must not copy the merge algorithm
or normalize each Rate independently. This is an exact native helper extraction,
not a native business correction.

The workflow's creator override also retains an own `created_by` property whose
value can be undefined. The narrow authoring-time type correction admits that
existing value through the Rule-step boundary without changing emitted JavaScript,
omitting the property or replacing it with null. Storage defaults and the native
creator overwrite continue to own the resulting Rule value.

Only the genuine root and Rate-update step are promoted through private
exports, source-pair and complete callback guards, reusing the inline conditional
Rule list and existing Rule steps. Comparison snapshots remain unchanged.
Shared-owner defects require their preserved failing witness, correct owner and
owner/consumer regressions. Native business corrections remain separate explicit
decisions.

## Verification and deferrals

This admission is confined to the connected selector/update grammar, complete
bounded cohorts and genuine retained callback graph. Extensions must preserve
the native comparison contracts, projected selection completeness, complete
receipts, events/no-ops, constraints, borrowed-resource and scope refusal,
authenticated replay/conflicts, full failure Causes, sticky rollback-only state
and no failed-root publication. Both PGlite and focused ordinary-role PostgreSQL,
affected owner/consumer regressions, types/builds, source/provenance and browser
guards, lint and both required read-only reviews remain required change gates.
Independent cold Tax calculation keeps its separate read-only grant.

The next selected Tax branch is Rate deletion with cascade and restore
compensation (169). Tax Region/provider administration, complete Cart admission,
remote providers, chunked File import, Product export, performance acceptance,
populated-schema conversion and production/hosted activation remain separate.
