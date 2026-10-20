# Native Price List update preflight

## Status and complete closure

Status: implemented for connected bounded private execution against the
characterized original native contract. Product chunked file import and
Product export remain deferred. No native business correction is introduced.

Authority is Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
`third_party/medusa/SOURCE.json`. Native paths below are relative to
`third_party/medusa/upstream/`:

- `packages/core/core-flows/src/price-list/workflows/update-price-lists.ts`
  stages the original validation and update steps and has an implicit void
  composer result. It does not return the update step's DTOs.
- `packages/core/core-flows/src/price-list/steps/validate-price-lists.ts`
  resolves Pricing, reads requested IDs and retains its native missing-ID guard.
- `packages/core/core-flows/src/price-list/steps/update-price-lists.ts`
  resolves Pricing, derives the union of requested fields/relations, reads the
  actual sparse preimages, calls `updatePriceLists` and retains
  `{ dataBeforeUpdate, selects, relations }`. Its original inverse calls the
  same native update method using those preimages.
- `packages/modules/pricing/src/services/pricing-module.ts`, the original
  Pricing repository, generated/internal services, six DML models and default
  MikroORM own normalization, replacement, sparse results and actual mutation
  events. Public workflow declarations live in
  `packages/core/types/src/pricing/workflows.ts` and are not DML validators.

One existing Pricing participant and internal EventBus handling cover the
complete root. Public resource methods are exactly `listPriceLists` and
`updatePriceLists`, with graph access off. Query, Link, Product/Region reads,
providers, File handling, Locking and remote effects are absent.

Both steps resolve Pricing before their empty checks. An empty outer array
makes no public Pricing calls. A successful nonempty root calls
`listPriceLists` twice, followed by `updatePriceLists`; its inverse calls only
`updatePriceLists`. The root's actual void result uses the existing finite
runtime's stored-null return boundary.

## Authenticated original native evidence

The immutable packet is
`%TEMP%/flarex-153-native-price-list-update-witness`. The frozen v3 runner
preserves all original 79 declarations and adds two reverse-root ordering
probes, for 81 cases. It executes the complete original root and both steps,
genuine Medusa/Awilix containers and resolver registrations, original Pricing
and generated/internal services, default MikroORM, all six Pricing tables,
real LocalEventBus and original SDK retained cancellation on ordinary-role
PostgreSQL. The v1/v2 runners, inventories, source-audit correction evidence and
original 79-case report remain preserved separately.

The executed v3 report is
`unchanged-native-price-list-update-v3-postgres-runs/2026-10-20T00-32-15.003Z-8920/report.json`
inside the packet, SHA256
`39c0a153c822aff2851d7294645afabbd58ab525f6fc49bb98407ee8e7496dfc`.
Runner SHA256 is
`6478d339bfcc9776c1b208ed9efbef9c49ecaf4288921571f00396903601dcbc`.
The independent filesystem result `audit.full81-v3.json`, SHA256
`1e96b15b18152640b7d942aac36a645497ce1eac17cee3b7bd2639a4b8173a8f`,
authenticates 81 case artifacts, 282 native/emitted source pairs, 1952 barrel
records and 37 external entry/manifest records, with no authentication failures
or consistency findings. It records 81 exact schema absences and 81 EventBus
cleanups. Native business validity is an observed outcome, not an audit success
requirement.

Actual ordinary-role flags are asserted false by the authenticated runner
before schema creation; role names are retained, but raw flag rows are not
independently persisted. External hashes cover recorded entry/manifest bytes,
not every transitive package file. SQL traces are native logger diagnostics,
not exhaustive wire-SQL or Flarex command accounting. The report records 81
forward phases, 55 independent retained inverse phases, seven repeated
cancellations and nine required outside-edit phases. The 26 cases without an
independent inverse phase do not establish a successful inverse; original
late-parent compensation can occur inside its forward phase.

Harness proof failures are distinct from native rejection. Projection of a
genuine SDK transaction happens outside the native rejection catch, required
outside actions must fulfill and persist their precondition before inverse,
and partial phase evidence survives a later harness failure. Diagnostic Causes
retain bounded own-data SQL/error chains with explicit omission/truncation
markers and connection/password redaction. The filesystem auditor verifies
mandatory successful public-update/internal-upsert timeline ownership and
retained preimages, rather than allowing missing observations to pass
vacuously. Native business bodies remain unchanged.

## Native contract

The workflow accepts `price_lists_data` with IDs and optional title,
description, status, nullable date strings and generic `rules` records of
string arrays. Description explicitly admits null in the native declaration;
that does not make its stored DML column nullable. Module-only type/price
fields and malformed runtime-null records remain separately labeled probes.

Raw empty/arbitrary IDs, duplicate selector order and duplicate membership
values reach the native owners. Missing and historical roots refuse. Duplicate
root entries can pass validation membership but fail the module's existing-root
cardinality check. No adapter deduplication, root insertion or historical
reactivation is introduced.

Native valid dates normalize to ISO instants; null clears a date and reversed
ranges are accepted. Empty strings, invalid dates and required-column failures
retain their observed refusal branches. Empty titles/descriptions, arbitrary
rule attributes, empty attribute/value strings, empty arrays and repeated
array values remain unchanged. The original rule builder retains the observed
child traversal order when reconstructing records, including duplicate
existing attributes.

Default validation reads return complete native scalar PriceList rows. The
second read returns identity plus the union of supplied mutable fields. When
any input supplies rules, the native preimage read substitutes
`price_list_rules.value` and `.attribute`; original child IDs are also retained
by the native projection. Child reads present active members. The retained
`selects`/`relations` are the original union, not a per-root mask.

Module update outputs are sparse and ordered by raw root input. ID-only input
returns `{ id }`; a title update returns `{ id, title }`. Rules-bearing rows add
`rules_count` and `price_list_rules`; returned new rules contain only ID,
attribute, value and `price_list_id`. Complete storage timestamps and other
unrequested scalars must not be added to these DTOs. The workflow itself still
returns void.

Every successfully supplied root produces a native updated action, including
ID-only and equal-value updates. Existing root `created_at`, `updated_at` and
deletion state remain unchanged even when business fields change. A native
event is therefore not inferred from a durable dirty-row difference. New Rule
rows receive ordinary managed creation stamps.

Supplying rules replaces their members and assigns fresh Rule IDs. This holds
even for equal business rules; it does not preserve old IDs. Replacement
physically deletes omitted old members across active and deleted history.
Omitting rules preserves both active and historical members. An empty rule
record removes the complete old cohort. Original compensation restores only
the selected active business preimage with newly generated IDs; deleted
historical members are not recreated.

The batch union is observable during compensation. For example, a rules update
to one root beside a title update to another retains rules and title for both,
so the original inverse can replace rules on both roots. Scalar-only inverse
restores selected fields while preserving an outside unselected description
or outside rule rewrite. A rules-bearing inverse replaces outside additions
and replacements. Soft-deleted or physically deleted roots make the original
inverse fail rather than being resurrected. These are preserved native
semantics, not compensation repairs.

Events occur in the observed native groups: created ListRules, updated
PriceLists, deleted ListRules. Created members and updated roots follow raw
input traversal. The reverse-root probes supply d,c,b,a, while old child
deletions follow global stored a,b,c,d insertion traversal. Independent
per-root reads cannot establish that global order. This bounded observed
native behavior does not assert a universal PostgreSQL physical-return
ordering guarantee.

Four existing roots with two old and two new attributes each produce eight
created Rules, four updated-root actions and eight deleted Rules: 20 events.
The original retained inverse likewise produces 20 for that fixture. Original
SDK late-parent compensation can produce 40 in one observed phase. Extra
history can increase the deletion cohort under existing shared budgets;
forward attribute limits do not cap inverse/history cleanup. Native calls
settle independently, so this packet proves no Flarex atomic settlement.

## Shared owner mismatches and adaptation

Ordinary managed update advances `updated_at`, whereas this native existing
PriceList upsert preserves it. The correct shared graph mapping reuses ordinary
existing-row upsert through a trusted `existingRootWrite: "upsert"` profile.
It tags only actual selected active root identities, requires their existence,
and keeps root inserts, historical reactivation and caller timestamp authority
denied. Every supplied root still records its authenticated patch attempt,
including equal/ID-only attempts. Equal business fields still permit a real
shared revision and current-pointer advance while preserving the row identity,
complete root body and native managed stamps. Revision publication and native
event accounting remain separately authenticated. Other graph profiles retain ordinary
managed update behavior; no new core clock option or adapter stamp repair is
required.

The generic graph's per-root deletion plan originally supplied a different
global Rule event order under reverse root input. A bounded trusted
`orderedDeletionTables` profile reuses the existing identity-bound
storage-insertion read for the complete planned child-ID deletion cohort,
checks exact row/identity membership and preimages, then deletes in its actual
returned order. It adds no read when that cohort is empty. Receipts bind this
executed read and its protected `orderedIdentities`, rather than guessing a
lexical/per-root order or weakening event equality.

The original root's composer implicitly returns undefined. The portable SDK's
existing direct-step normalization alone cannot express or execute it. The SDK
correction admits synchronous literal composer void through its ordinary
WorkflowResponse capture while preserving every staged node, current-composer
ownership, ordering, reference, hook and resource check. Arbitrary raw objects,
Promises and unsupported references remain refused. Neutral SDK and actual
two-step root validation are separate gates; the native root body must not gain
a synthetic return merely to bypass this requirement.

The private transaction boundary retains its accepted error classification.
Null description is admitted by the workflow/module grammar and reaches the
real nonnullable DML refusal. Original MikroORM maps that to `invalid_data` with
`Cannot set field 'description' of Price list to null`. The logical core owns
nonnullable DML validation and sticky rollback-only failure; the bound native
service Promise and outer workflow both expose `rollbackOnly` after that
latch. This case does not claim a separately observed initial storage cause.
The existing
[Price Preference deletion boundary](./151-native-price-preference-deletion.md)
already records this infrastructure distinction. No ORM message mapper,
duplicate null check or earlier unsupported-profile refusal is copied into
the adapter. Original Medusa business guards retain their own errors.

## Erased type and portable source seams

The promoted root and two complete callbacks retain their executing bodies.
Direct imports select existing portable leaves, and the update step adds only
the required transaction-covered compensation metadata. The root annotation
changes from branded `WorkflowData<void>` to its actual erased `void` return;
there is no runtime return statement. The inverse's non-null annotation on
`buildPriceListRules` reflects the actual defaulted array's defined record and
adds no guard/default algorithm. The portable rule builder keeps the original
native function body; date correlation reuses the original
`GetIsoStringFromDate` leaf. Source guards and type checks own these narrow
declaration/import obligations independently of behavior tests.

## Connected profile and validation boundary

The selected constructor admission is `price-list-updates`, with source profile
`pricing-price-list-updates`. Its commands are `pricingListUpdateRead` and
`pricingListUpdate`, the latter serving both original forward and inverse.
The trusted facade selects existing mixed publication for the one Pricing
participant. Creation, Product, Shipping and preference admissions keep their
own methods, decoders and behavior.

The public bound is zero to four raw roots, two rule attributes per forward
root and two string values per attribute, with raw strings bounded to 256
characters. Module
inverse rule records use the existing shared query/resource bounds so actual
preimages with extra members are not silently truncated. Existing 64-call,
64-event, byte, row and deadline limits remain unchanged. Complete DML rows
are checked before sparse read/output projection, and exact indexed reads,
patch/insert/delete attempts and native event vectors require receipts.

Validation exercises the genuine two-step root and separately its original
retained callbacks, full DTO/preimage masks, no-op actions/stamps, raw ordering,
global historical deletion, outside edits, native refusals, protected data,
atomic late-parent rollback, replay/lost acknowledgement, refusal/revocation
and cancellation. A one-step callback probe does not prove the actual root's
maximum call budget or implicit-void execution. PGlite and ordinary-role
PostgreSQL, affected owner/consumer regressions, types, source/portability
guards, lint and both required reviews gate changes to this
slice. Finite transaction-covered failure rolls back the pending root once;
it does not automatically invoke original compensators. Actual retained
callbacks have independent fresh-attempt authority proofs. Native SDK retained
container binding, repeated cancellation and permanent failure behavior remain
preserved in the packet and do not establish post-completion scheduling,
durable external delivery, cold recovery, hosted activation or arbitrary scale.
