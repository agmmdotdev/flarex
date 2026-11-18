# Native Price Preference update preflight

## Status and complete closure

Status: implemented for bounded private execution. The complete native update
root uses the shared PostgreSQL predicate owner and selected-identity evidence.
Product chunked file import and Product export remain deferred.

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
68-case Boolean/error extension characterize 219 native cases. A separate
63-case empty-fragment extension preserves those original definitions and
characterizes nested empty objects, logical groups and comparison maps.
The frozen v1/v2/v3/v4 runners and their source inventories, reports and read-only audits
remain separate. They execute the original SDK workflow and step, genuine
Pricing/internal services, default MikroORM, ordinary-role PostgreSQL and actual
LocalEventBus lifecycle. No native business correction is indicated.

The observed database uses UTF-8 encoding and C collation/ctype. Native
fulltext explicitly executes SIMPLE `to_tsvector` with `plainto_tsquery`;
the database default English dictionary does not change that SQL. Native regex
uses PostgreSQL POSIX/ARE rather than JavaScript RegExp.

The compatibility PGlite database has C collation and C.UTF-8 ctype. Native ILIKE
there folds accented case that remains distinct under the ordinary C-ctype
PostgreSQL baseline. The workflow delegates to each engine's actual SQL
semantics; compatibility validation does not claim identical Unicode case
matching across these locale configurations.

The accepted connected selector contract includes bounded scalar/array
`id`, `attribute` and `value`, their conjunction, top-level recursive AND/OR,
empty selectors and native successful operator families: scalar equality,
inequality, membership, negative membership, text ranges, LIKE, ILIKE, POSIX
regex, SIMPLE fulltext and existence checks. Preserve raw case, empty strings,
Unicode/combining characters, native escaping and NULL behavior. An ID-only
facade would omit connected native functionality and is not the destination.

Native MikroORM/Knex omits structurally empty selector fragments before SQL
generation, including empty objects, logical groups and comparison maps inside
AND/OR. An empty branch beside an ID selector therefore does not widen its
selection; an all-empty group contributes no restriction. The named adapter
policy preserves that omission after validating every source branch. Actual
SQL predicates such as empty IN and NOT IN retain their false/true semantics
and PostgreSQL's resulting regex error suppression.

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

The complete successful native selector grammar requires PostgreSQL predicates
beyond scalar membership, null checks, text inequality, selected greater-than
and ASCII-only LIKE. Sparse update preimages and inverse upserts also require
an explicit admission distinct from complete Store lookup rows and Store-specific
upserts. Equal scalar assignments must remain native no-ops at the preference
write owner, including Store calls through that same owner.

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

## Connected implementation and gates

The existing Pricing preference constructor has one explicit
`price-preference-updates` admission. It preserves the creation contract and
Store-specific filtering/upsert grammars and ordering. It reuses complete DML
row contracts, shared scalar reads/projection, keyed updates, the existing
bridge/subscriber and one outer settlement. Update results and preimages use
ascending IDs. The shared compiler retains its existing 64 normalized nodes,
depth eight and 256 operands; generated conjunctions and the active-row filter
count toward these bounds. An earlier raw-selector traversal guard of 128 nodes
does not admit 128 normalized nodes. Text values remain at most 256 characters. Runtime membership
arrays containing NULL remain outside the declared public selector contract;
the separately labeled native probes do not admit them implicitly.

Metadata-derived sparse-preimage decoding requires identity and validates
complete rows before selected-field projection. The shared writer compares
actual scalar values so empty/equal assignments remain native no-ops. The
original public TypeScript interfaces and native service algorithms remain
the boundary; the existing preference factory supplies the constrained view
without another participant.

The original workflow and step use the established portable-fork seams with
exact source provenance. A narrow facade selects only native list,
update and inverse-upsert resources, graph access off, up to four matched rows,
and the existing call/event, byte and deadline limits. Native callbacks remain
actual retained callbacks; whole-root failure rollback is a separate proof.

The existing preference receipt owner authenticates exact selectors and
executed read plans, partial preimages, complete results, mutation
membership/order, no-op rows and actual native events. Protected preference
rows and every unrelated Pricing table remain outside the admitted writes.

These reads request shared selected-identity evidence. Hydrated candidate rows
remain dependency observations even when PostgreSQL excludes them; they are not
the selected set. The receipt binds the exact query and core-produced
`orderedIdentities` to complete observed rows, sparse projections and dirty
mutations. Neither candidate counts nor JavaScript text evaluation can replace
that selection proof.

The admitted profile preserves accepted selector families, NULL/Unicode/
escaping/Boolean error behavior, sparse inverses, uniqueness failures, late-parent
cancellation, rollback, replay, caught refusal and existing concurrency ownership.
PGlite and ordinary-role PostgreSQL remain distinct validation lanes; the locale
boundary above applies to their text behavior. Production/hosted activation,
durable external event delivery, cold workflow recovery, scale and destructive
durable-data changes retain separate gates.
