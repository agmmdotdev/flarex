# Native Tax Rate Rule replacement

## Status and authority

Status: admitted for the private bounded profile on PGlite and ordinary-role
PostgreSQL. The genuine replacement root and list step run through one confined
Tax participant, reusing the admitted Rule creation and deletion lifecycle
owners. The shared fresh-batch scalar identity/receipt and native one-to-one
compiler corrections remain admitted for their connected private profiles;
the compiler correction covers fresh schemas only. No native business
correction has been selected.

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

An empty Rate ID with nonempty Rule templates reaches an original ORM
`RangeError`. That original witness remains outside the bounded profile, which
refuses the shape before native execution. This establishes neither error parity
for that shape nor a correction to the original ORM behavior.

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

## Bounded admission

The private `tax.ruleReplacement` / `flarex-tax-rule-replacement` profile admits
zero to four raw Rate ID positions and zero to two Rule templates, expanding to
at most eight new Rule positions. The complete active old Rule cohort must also
contain at most eight Rules. Raw duplicate selectors and templates retain their
native consequences; complete old-cohort admission occurs before mutation and
does not substitute a truncated page for the native list.

Empty Rate ID strings are admitted only with an empty template array, retaining
the genuine no-match list and `createTaxRateRules([])` dependencies. With any
nonempty template array, an empty Rate ID is outside this profile and is refused
before native execution. An empty Rate ID array may accompany nonempty templates;
its Cartesian expansion is empty. The original ORM `RangeError` witness remains
distinct, with no error-parity claim or native correction.

The promoted root and list step change only import locations. Existing genuine
creation and deletion steps retain both inverses, sequential evaluation and
empty resolution behavior. One Tax module exposes exactly
`listTaxRateRules`, `createTaxRateRules`, `deleteTaxRateRules`,
`softDeleteTaxRateRules` and `restoreTaxRateRules`; these methods borrow one
scalar repository bridge and event owner. Parent CRUD, calculation and graph
capabilities remain denied in this participant. The trusted outer owner alone
settles rows, facts and publication.

The root list retains ascending ID order. Expansion preserves template order
first and every raw supplied Rate position second, with the parent ID overriding
the template. Complete output preserves Rule-local creators, general JSON
metadata, managed values and fresh-batch identity sharing. Canonical writes and
creation events occur once per entity while complete aliased DTOs retain every
native response position. Persisted-ID creation still fails; no cross-call
identity map or upsert substitution is introduced.

The list receipt decodes every complete raw owned-table support body and rejects
contradictory observations of one identity before residual selection. Valid
deleted or other-Rate support bodies do not become selected candidates. The
receipt reconstructs the complete active selected-Rate cohort, then authenticates
its projected IDs, ascending order, exact read recipe and counts. The bound of
eight old Rules applies to that selected cohort rather than the raw support set.
Malformed bodies, foreign tables, unexpected mutations or events, and forged
results or read evidence remain refusals; validation does not rerun native Tax.

Physical cancellation of created Rules reuses the
[creation inverse's approved storage insertion order](./165-native-tax-rate-rule-creation-workflow.md).
Old Rule soft-deletion and retained restore reuse the
[historical lifecycle's approved storage insertion order](./166-native-tax-rate-rule-deletion-workflow.md).
The original SQL witness remains separate from these explicit portable policies.
The retained inverse physically removes the new cohort before restoring exactly
the captured old identities. Predeleted and later unrelated Rules stay intact;
missing retained rows remain absent, active restores are no-ops and restore emits
no events. A restore constraint conflict rolls back the complete inverse graph.

Default limits remain 64 calls, 64 events and the existing ordinary resource
bounds for both the complete root and retained inverse. Caller-selected resource
or publication overrides are refused. Genuine constraint failures, forged
outputs/events and late defects cannot publish a partial graph. A caught refusal
remains sticky under the existing request owner. Interruption reuses the existing
bounded Promise cleanup and fences late calls. Foreign defects retain their full
Cause.
Trusted durable replay returns the committed result without repeating native
replacement and refuses conflicting replay input. Independent cold Tax
calculation observes committed replacement and retained restoration.

The next selected Tax branch is Rate updates and retained upsert compensation.
Rate deletion cascades, Tax Region administration, complete Cart admission,
File import/export, performance acceptance and production/hosted activation
remain separate. The shared one-to-one compiler correction remains confined to
fresh schemas and does not admit populated-schema conversion.
