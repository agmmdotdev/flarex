# Native Store Creation Workflow

## Status And Authority

Status: implemented within the bounded creation admission below.
Store deletion and its separate read-only guard are implemented within their
recorded bounds. Store creation/update, arbitrary Pricing preference mutation,
bootstrap and hosted activation are not implied by those admissions. Chunked
File Product import and Product export remain deferred. Reservation restoration
has a separately approved native correction in preflight 122.

Authority is the accepted design and pinned Medusa 2.13.4 fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. Native sources are
`packages/core/core-flows/src/store/workflows/create-stores.ts`,
`store/steps/create-stores.ts` and
`pricing/steps/update-price-preferences-as-array.ts` in the pinned source tree.
The executing Store and Pricing services are promoted. This workflow uses
separate named creation/preference profiles; existing guard, deletion and Product
Pricing profiles do not gain these mutation capabilities.

## Native Graph And Semantics

`createStoresWorkflow`, ID `create-stores`, accepts an array of Store inputs.
It transforms each currency to code/default for Store, invokes `createStores`,
then transforms ORIGINAL input currencies into Pricing preferences and invokes
the genuine preference array step. The result is the complete created Stores.
There is no Query, Link, hook, separate workflow event, remote effect or pause.

The Store service trims names, lowercases currency codes and removes undefined
fields. It validates duplicate normalized currencies, exactly one default for
nonempty currency arrays, then duplicate locales. Empty currency arrays need no
default. Locale codes retain case; omitted names use the DML default and
whitespace names can normalize to empty. Preserve native error text/order and
do not add catalog membership queries or repair input before native validation.

Store calls internal `upsertWithReplace` with exactly `supported_currencies` and
`supported_locales`. Bind that contract to existing shared `replaceGraphRows`.
The Store policy supplies checked metadata, allowed relations and bounds; the
shared owner retains traversal, generated keys, foreign-key planning, writes,
hydration and performed actions. Independent child CRUD or copied normalization
is not an equivalent integration.

The preference transform uses a Map keyed by RAW currency code. First insertion
sets key order; later occurrences replace the payload. Store can therefore
persist `usd` while Pricing uses `USD`. Preserve this case asymmetry and shared
cross-Store preference effects. Preferences are scoped Pricing rows, not Store
children; Store deletion does not delete them.

Empty Store arrays still call Store and resolve Pricing. The Pricing step
resolves its service before returning its empty response, without list/upsert
calls. Workflow currency arrays are required, even though the service DTO allows
omission. Preserve required providers independently of whether they perform a
data operation for empty input.

## Pricing Participant

For nonempty input the native step validates attribute/value, lists matching
preferences using ordered `$or` pairs, matches BOTH attribute and value, then
upserts. Missing incoming tax flags retain existing flags; creation defaults
them to false. Native upsert partitions by ID and returns created-group rows
before updated-group rows, which need not preserve original input order.

Add a named preference admission through the existing Pricing construction
owner. It exposes only `listPricePreferences`, `upsertPricePreferences` and
`deletePricePreferences`. Existing Product profiles, their create-only receipts
and their two-pair lookup ceiling remain unchanged. This new admission requires
at most four pairs and full checked rows, with no PriceSet/Price/Rule writes or
graph authority. Existing source-selection guards must retain old profile
behavior while authenticating the new explicit branch.

Use existing scalar queries, `compileKeyedUpdates`, physical lifecycle and
complete-row/event owners. Authenticate actual list membership, native grouped
results, update/no-op/delete effects and events before projection. Do not turn
native upsert into a second adapter-owned business algorithm.

## Retained Inverses And Managed Fields

The Store inverse captures actual created IDs and physically deletes them;
absent/empty capture skips resolution. Its complete bounded child history must
be removed through shared lifecycle/FK mechanics. Native physical deletion emits
root Store events, not child deletion events. Creation uses native performed
actions for root and child events.

The Pricing inverse captures complete prior rows and new IDs. Unless capture is
absent, it unconditionally calls upsert of prior rows then physical deletion of
new IDs, including both empty arrays. Full prior DTOs contain managed fields.
The pinned DAL's `applyModelDefaults` in `packages/core/dal/src/metadata.ts`
unconditionally replaces `updated_at`; Drizzle `preparePersistenceRecord` uses
that helper before update. Consuming a prior timestamp without writing it is
therefore native-compatible DTO translation. The preference profile must decode
the full DTO, authenticate immutable/lifecycle fields against the selected row,
and let core own the actual update timestamp. Do not loosen shared managed-field
refusal, introduce another clock or discard unchecked managed data.

The finite runtime does not automatically invoke compensators. Exercise genuine
retained callbacks explicitly in borrowed probes, separately from terminal
failed-root rollback of both participants and all durable evidence. External
saga safety remains outside this admission.

## Source Seams And Ownership

Promote the three genuine runtime files with portable/direct imports and
transaction-covered metadata only. Preserve transforms, Map semantics, callback
order, native responses and compensation payloads. Promote pinned selected
Store/Pricing workflow types and direct Store DTO exports through existing type
facades; relocate broad type-only HTTP imports to selected Store payload types.
Runtime validators remain DML/profile-owned, rather than HTTP-validator-owned.

The existing native `normalizeInput` helper is private static. Store receipt
correlation needs the same algorithm; no existing receipt hook records normalized
DAL input. The narrow internal fork seam exposes only that helper's visibility,
preserving all bodies and call sites. Keep validation private and native-owned.
Guard exact source differences plus emitted runtime equality, and classify this
truthfully as a Store type fork. This grants no new module command, transaction
or public hosted capability.

Selected Store/Pricing DTOs admit the explicit undefined optional fields emitted
by the unchanged native callbacks. The Pricing array step has explicit erased
generic arguments for its empty result and full compensation DTO. These narrow
type adaptations retain identical emitted JavaScript and exact source guards.

Reuse one Store native registration/construction owner across admitted profiles;
retain distinct guard, deletion and creation authorities. Workers prepare bounded
Store, Pricing and native source proposals independently; main integrates shared
changes, correct-owner fixes, connected tests, documentation, review and Git.

## Proposed Bounds And Connected Proof

Start with zero to four Stores, zero to two currencies and locales per Store
(eight of each total), and four DISTINCT RAW currency codes/preferences. Reject
caller Store IDs. Decode complete generated Store/child outputs before returning
them. This graph introduces at most twenty Store-family rows and four preference
rows; it does not establish arbitrary Store support.

The complete graph exceeds the ordinary 64-call admission. Its named trusted
Store creation profile selects 128 calls through the existing identity-bound
composition API; event, byte, row and deadline limits retain their defaults.
Business inputs cannot raise these allowances. Both root and borrowed operation
queues use the existing authenticated FIFO: native Pricing runs its create and
update groups concurrently within one borrowed invocation.

The mixed maximum uses 83 measured entry spans plus the root call. The current
source model attributes 58 spans to Store, 15 to Pricing and 10 to workflow
capture/checkpoint work. Store includes twenty generated-ID probes, eight prior
child selections and two aggregate hydration reads in the shared replacement
owner. These are possible separate optimization work, not a correctness defect
or native business requirement; no optimization is made here. Call units do not
measure SQL count or latency. The full four-Store graph remains unchanged.

Both PGlite and ordinary-role PostgreSQL must cover generated IDs/defaults,
normalization and exact validation order, raw-case keys, cross-Store Map order,
mixed existing/new preferences, omitted flags, required empty calls, complete
native output/event authentication, untouched families and scopes, replay,
refused sibling methods, maximum/overflow and late failure across both owners.
PostgreSQL must additionally prove competing roots cannot publish duplicate
active preferences or partial Store graphs. Retained inverse probes must include
full prior DTOs, empty/nonempty capture and failure after genuine inverse work.

Native Store update follows separately: it adds selector/preimage semantics,
replacement of existing children and input-driven Pricing effects even when no
Store matches. Those behaviors are not covered by creation alone.
