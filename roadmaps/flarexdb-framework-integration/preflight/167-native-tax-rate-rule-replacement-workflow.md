# Native Tax Rate Rule replacement

## Status and authority

Status: the original-native replacement root is characterized; the portable
replacement profile is prepared and remains unadmitted as the next selected
branch. The shared fresh-batch scalar identity/receipt correction and native
one-to-one compiler correction are admitted for the connected private profiles.
The compiler correction covers fresh schemas only. Necessary shared-owner
corrections use standing approval; no native business correction has been
selected.

The reference remains Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The selected root is
`setTaxRateRulesWorkflow`, composing `listTaxRateRuleIdsStep`,
`deleteTaxRateRulesStep` and `createTaxRateRulesStep`. This closes Rule replacement
administration after [creation](./165-native-tax-rate-rule-creation-workflow.md)
and [deletion](./166-native-tax-rate-rule-deletion-workflow.md); it does not close
Cart admission or introduce a direct Cart dependency.

## Connected native contract

Input contains `tax_rate_ids: string[]` and
`rules: Omit<CreateTaxRateRuleDTO, "tax_rate_id">[]`. The result is the complete
created Rule DTO array. The native list step always resolves Tax and calls
`listTaxRateRules({ tax_rate_id: input.tax_rate_ids }, { select: ["id"] })`.
It returns all active matching IDs in ascending ID order. No default page limit
is supplied: the separate seventeen-old-Rule diagnostic lists, soft-deletes,
retains and restores all seventeen IDs.

The native deletion step skips resolution for an empty listed cohort. Otherwise
it soft-deletes those IDs and retains them for restore. The transform expands
templates first and supplied Rate IDs second, spreading each template before
overwriting `tax_rate_id`. Creation always resolves Tax and calls native Rule
creation, including an empty array. The created IDs become its physical inverse.
Compensation physically removes the new cohort before restoring the captured
old cohort, allowing same-reference replacement under active uniqueness.

Native calls are sequential even though deletion's output is unused. The root
requires no parent retrieval, Query graph, Module Link, Product/Type lookup,
provider calculation or external effect. Native generated list/create/lifecycle
services, their decorators, serializers and repositories remain in the closure.

## Original-native observations

Old listing and retained IDs use ID order. Actual old deletion maps/events use
observed storage insertion order. New DTOs and creation events use rules-first
Cartesian order and preserve template-local creators. The original SQL ordering
remains distinct from the explicitly selected portable lifecycle policies.

Predeleted Rules are excluded from the captured old cohort. Cancellation must
preserve them and later unrelated Rules. Missing retained rows keep native
no-match behavior. Restore emits no events. A restore uniqueness conflict can
fail original compensation after new Rules have already been physically removed.

Native late failure restores old content but advances timestamps and leaves
already-delivered deletion events. Flarex's accepted whole-root rollback and
atomic publication remain separate from those native step transactions. Native
transaction-ID repetition executes replacement again; trusted durable replay
must retain its existing authenticated owner rather than reproduce that behavior.
Independent native calculation observes replacement and retained restoration.

## Shared scalar identity and one-to-one correction

One supplied-ID template expanded across two Rates succeeds in the original
MikroORM path. It returns two identical full DTOs referring to the first Rate,
persists one entity, emits one creation event and retains duplicate created IDs.
Physical compensation removes that entity once. Duplicate Rate IDs without a
supplied Rule ID instead fail active uniqueness and compensate.

`id` is not declared by `CreateTaxRateRuleDTO`; the original runtime nevertheless
propagates it. Direct standalone Rule creation characterization confirms the
same identity sharing. The admitted shared scalar/receipt correction replaces
the former distinct-returned-identity assumption; the unsupported duplicate-ID
refusal expectation does not define native behavior.

PostgreSQL's unique physical-write guard remains correct. Native scalar creation
uses the MikroORM entity factory and identity map before persistence, then
serializes every response position. The correct portable owner is shared Medusa
scalar creation and its consumers' receipt contracts. No Tax SQL workaround,
upsert substitution, cross-call identity cache or native business change is
authorized by this observation. Direct scalar probes establish first-non-nullish
hydration before model defaults: omitted or null fields can receive a later
non-null value; false, zero, empty strings and whole non-null JSON values remain.
Every raw position returns the final canonical entity. An existing persisted ID
still fails creation. Existing upsert planning has different response semantics
and cannot be substituted.

The shared native seam retains `manager.create` for every raw input, in order,
with its real ORM normalization and positional return. The admitted portable
flat-scalar planner is confined to one fresh batch and separates the canonical
write/event cohort from response positions. It establishes neither a cross-call
identity map nor general ORM graph compatibility. Receipt correlation
authenticates explicit identity sharing, distinct generated identities, equal
complete alias DTOs and the exact canonical persistence/event cohort.

Connected consumers include Tax Rates and their nested Rules, standalone Rules,
Shipping Profiles, Shipping Option Types, batch Shipping Option Rules, Inventory
Items, Sales Channels and Stock Locations/Addresses. Their creation paths use
the shared correction. Stock Location relation planning selects root identities
before creating nested Addresses, so ignored later Addresses do not become
orphan writes. Its native relation identity and immediate presentation remain
distinct from flat JSON-field hydration.

The original Stock Location also rejects two active roots sharing one Address.
The portable DML compiler now preserves the native active unique foreign-key
index for a `belongsTo` whose inverse is `hasOne` or `hasOneWithFK`, before
logical lowering and shared constraint enforcement. Nullable references remain
distinct; soft-deleted owners release their claim. A conflicting restore rolls
back its whole cohort.
Owning `hasOneWithFK` and many-to-one references retain their native nonunique
behavior. This connected correction covers fresh schema construction; it does
not admit populated-schema conversion or production activation.

## Remaining replacement admission

The original-native witnesses above remain separate from the prepared portable
replacement profile. Admission of its shared creation/compiler dependencies does
not admit the replacement root, its lifecycle ordering or its complete graph.

1. Keep the prepared Tax participant confined to list, Rule creation, physical
   inverse, soft-delete and restore. Reuse one bound scalar owner and the
   Tax-owned `tax_rate_id` predicate; authenticate complete projected ID
   selection without constructing two separate Tax registrations.
2. The prepared profile proposes zero to four supplied Rate IDs, zero to two
   templates, at most eight expanded new Rules and at most eight complete active
   old Rules. Preserve raw duplicate inputs and native failures; refuse oversized
   old cohorts before mutation. Keep default 64-call/64-event and other resource
   limits; complete graph measurements and explicit ordering disposition remain
   admission gates.
3. Promote only the genuine root and list step through existing private exports,
   source-pair/callback guards and the atomic host, reusing genuine creation and
   deletion steps. Preserve empty dependencies and both retained inverses.
4. Establish complete forward/inverse and failure behavior, cold calculation,
   constraints, replay, scope refusal and both database lanes before admission.
   Source provenance, portable execution and the connected resource bounds remain
   part of that gate.

Rate selector updates/upsert compensation, Rate deletion cascades, Tax Region
administration, complete Cart admission, File import/export, performance
acceptance and production/hosted activation remain separate.
