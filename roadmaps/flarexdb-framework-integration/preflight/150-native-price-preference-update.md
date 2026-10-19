# Native Price Preference update preflight

## Status and complete closure

Status: native preflight complete; the required neutral PostgreSQL predicate
extension is implemented for bounded private relational reads. Full native
workflow integration remains pending. Product chunked file import and Product export
remain deferred.

Authority is Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
`third_party/medusa/SOURCE.json`. Native paths below are relative to
`third_party/medusa/upstream/`:

- `packages/core/core-flows/src/pricing/workflows/update-price-preferences.ts`
  owns `update-price-preferences` and returns the genuine step result.
- `packages/core/core-flows/src/pricing/steps/update-price-preferences.ts`
  derives selected preimage fields from the update object, calls native
  `listPricePreferences(selector, { select, relations })`, then calls native
  `updatePricePreferences(selector, update)`. It retains the actual selected
  rows and compensates with `upsertPricePreferences` when those rows are nonempty.
- `packages/modules/pricing/src/services/pricing-module.ts` owns selector
  normalization, scalar/array service results and genuine inverse upsert.
  Its original internal services and default repository own actual native
  persistence and dirty detection.
- `packages/modules/pricing/src/models/price-preference.ts` requires attribute
  text, permits nullable value text, requires the Boolean tax flag and defines
  active partial uniqueness on `(attribute, value)` with nulls distinct.
- `packages/core/types/src/pricing/common/price-preference.ts` and
  `packages/core/types/src/workflow/pricing/index.ts` declare the public selector
  and mutable fields. Type declarations are not DML or runtime validation.

The complete workflow needs one existing Pricing participant, selected reads,
selector updates, retained inverse upserts and internal event handling. It
requires no Region lookup, Link, Query resource, provider, File, Locking,
remote effect, new model/table or independent preference module.

## Native semantics and proof boundary

The immutable packet is
`%TEMP%/flarex-150-native-price-preference-update-witness`. Its original
81-case baseline, separate 70-case text-semantics extension and separate
68-case Boolean/error extension characterize 219 native cases. The frozen
v1/v2/v3 runners and their source inventories, reports and read-only audits
remain separate. They execute the original SDK workflow and step, genuine
Pricing/internal services, default MikroORM, ordinary-role PostgreSQL and actual
LocalEventBus lifecycle. No native business correction is indicated.

The observed database uses UTF-8 encoding and C collation/ctype. Native
fulltext explicitly executes SIMPLE `to_tsvector` with `plainto_tsquery`;
the database default English dictionary does not change that SQL. Native regex
uses PostgreSQL POSIX/ARE rather than JavaScript RegExp.

The accepted connected selector contract includes bounded scalar/array
`id`, `attribute` and `value`, their conjunction, top-level recursive AND/OR,
empty selectors and native successful operator families: scalar equality,
inequality, membership, negative membership, text ranges, LIKE, ILIKE, POSIX
regex, SIMPLE fulltext and existence checks. Preserve raw case, empty strings,
Unicode/combining characters, native escaping and NULL behavior. An ID-only
facade would omit connected native functionality and is not the destination.

The pinned native backend rejects field-level `$not`, scalar-property AND/OR,
array-valued `$eq` and the characterized array-containment/overlap operators on
text columns. Those observations do not authorize successful replacement
semantics. Invalid patterns retain their actual PostgreSQL error behavior. The
characterized trailing LIKE escape completes with an empty selection; it is not
an unconditional failure contract. Runtime-null/omitted inputs outside public declarations are separately
labeled in the packet rather than silently widening the public contract.

Selected preimages contain identity plus only the requested mutable fields;
an empty update retains identity alone. Native updates return complete rows.
The original inverse receives those sparse retained rows and performs a genuine
upsert; a complete-row-only decoder cannot represent it. Raw attribute/value
strings remain unchanged, nullable values remain nullable, and active uniqueness
or required-column failures remain native business outcomes.

An empty update, undefined-only fields and same-valued scalar assignments do
not write rows, advance timestamps or emit update events. A mixed selection
returns both unchanged and changed rows while events correspond only to actual
dirty rows. Successful inverse upsert restores the selected business preimage;
it does not invent an exact historical timestamp restoration. Repeated SDK
cancellation short-circuits rather than invoking compensation again.

Native PostgreSQL can suppress an invalid regex under structural empty-IN false,
empty-NOT-IN true under OR, and contradictory same-column equalities. NULL-only,
absent-identity, historical-identity and no-active-row cohorts still report the
invalid regex error. Whole-query evaluation is required: eager leaf evaluation
or skipping an empty candidate batch would change those outcomes.
The text/Boolean extensions preserve actual SQL, parameters, full raw histories,
selected DTOs, retained inverse inputs and events. These bounded observations
do not establish arbitrary collations, hosted activation, durable external event
delivery, cold workflow recovery or scale.

## Shared owner mismatch and disposition

The existing relational compiler supports scalar membership, null checks,
text inequality, selected greater-than and ASCII-only LIKE. It cannot represent
the complete successful native PostgreSQL selector grammar. The existing
preference repository additionally assumes complete Store lookup rows and
Store-specific upserts, and patches any supplied mutable field even when equal.

The required correction belongs to shared relational query execution and the
existing Pricing preference owner. Preserve this expected/actual mismatch;
do not compensate with adapter SQL, JavaScript query filtering, copied regex/
fulltext behavior, another transaction or a reduced selector profile. Standing
approval covers necessary core work. The neutral prerequisite is owned by
[PostgreSQL relational predicates](../../shared-logical-storage/68-postgres-relational-predicates.md).

The core compiler validates the whole tree once, retains authentic selected
index/point/null demand and issues an immutable PostgreSQL program when needed.
Complete captured candidates are evaluated together through one closed,
parameterized tree. Issuer-owned batches bind original metadata and actual
catalog ID. Ordinary checked transactions and installed finite captures reuse
the same materialized candidate/matching WHERE body, with an ordinal left join
for every Boolean result. Existing source, running-attempt, snapshot/fence,
fresh authority and protected header/body/tail checks remain mandatory.

The named finite `relationalPredicate` operation requires one short explicit
protected transaction. PostgreSQL can plan an invalid regex before a rejected
header in one statement, so accept the existing static ownership-fence header
before sending the dynamic complete predicate. Installed capture uses the
existing physical driver's `runInitialTransactionEffect` as the direct
BEGIN/COMMIT/ROLLBACK, cancellation, drain and quarantine owner for one checkout.
Its callback only performs protected admission/entry/body/tail and local closure;
it does not nest a Drizzle transaction in a read callback. Acquire the actual
co-located installation admission, decode exact body results, then require a
fresh header tail and matching command-local metadata epochs before settlement
and release. Callback rollback, cleanup failure and noncommit preserve complete
Causes. Uncertain settlement withholds all results, preserves initial settlement
and quarantine failures, and adds no retry/recovery protocol. Existing relational
command, lock and cleanup limits apply to this operation. Full-artifact execution
retains its sole protected transaction-settlement bridge with actual current
installation and read-only cancellation drain. This named exception is recorded
in the accepted design; other finite captures retain their implicit-statement
contract. No native/untrusted
callback runs inside this transaction. It adds no generic finite read fallback,
independent transaction, database function, migration, query-specific verdict
cache or new SQL capability.

## Connected implementation plan and gates

Extend the existing Pricing preference constructor with one explicit update
admission. Preserve the creation contract and Store-specific filtering/upsert
grammars. Reuse complete DML row contracts, shared scalar reads/projection,
keyed updates, the existing bridge/subscriber and one outer settlement.

Add metadata-derived sparse-preimage decoding with required identity, selected
field projection and complete row validation before projection. Compare actual
scalar values before shared writes so empty/equal assignments remain native
no-ops. Keep the original public TypeScript interfaces and native service
algorithms; any narrower callable typing seam belongs at the actual foreign
boundary. Do not add another preference factory or participant.

Promote the original workflow and step through the established portable-fork
seams with exact source provenance. A narrow facade selects only native list,
update and inverse-upsert resources, graph access off, up to four matched rows,
and the existing call/event, byte and deadline limits. Native callbacks remain
actual retained callbacks; whole-root failure rollback is a separate proof.

Authenticate exact selectors and executed read plans, partial preimages,
complete results, mutation membership/order, no-op rows and actual native events
through the existing preference receipt owner. Preserve protected preference
rows and every unrelated Pricing table.

Before implementation is described as admitted, complete the neutral prerequisite
on both database lanes, then prove the full connected native workflow on PGlite
and ordinary-role PostgreSQL. Cover every accepted selector family, NULL/Unicode/
escaping/Boolean error behavior, sparse inverses, uniqueness failures, late-parent
cancellation, rollback, replay, caught refusal, concurrency and affected Store,
Pricing, Product and other predicate consumers. Complete affected types/builds,
source/provenance/portability guards, lint, both required read-only reviews and
temporary-resource cleanup. Production/hosted activation and destructive durable
data changes retain separate gates.
