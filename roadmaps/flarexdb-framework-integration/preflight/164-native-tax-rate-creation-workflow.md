# Native Tax Rate creation

## Status and authority

Status: admitted for the private bounded profile on PGlite and ordinary-role
PostgreSQL.
The independent workflow is `tax/workflows/create-tax-rates.ts` and its
genuine `createTaxRatesStep`, including the retained physical deletion inverse.

The executing reference is Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. Accepted shared logical storage,
framework ownership and workflow lifetime boundaries remain authoritative.
Standing approval covers necessary core corrections. The scoped portable
inverse ordering below is explicitly approved. This preflight selects no other
native business correction or resource allowance.

The [item and shipping Tax child](./163-native-item-tax-lines.md) supplies the
complete four-model Tax schema, SQL-real lowering, portable native constructor
and local provider construction. Its read profile remains separately confined;
it grants no creation, deletion or Tax administration capability.

## Connected native contract

The native root accepts an array of Rate creation values. The step resolves Tax
and invokes the genuine `createTaxRates`, including empty input. Its complete
returned DTO array is the workflow result; created Rate IDs are retained for
compensation. Empty retained IDs skip Tax resolution, while nonempty retained
IDs invoke genuine `deleteTaxRates`.

`TaxModuleService.createTaxRates` retains scalar/array service normalization,
manager/event decorators, its transaction-managed `createTaxRates_` and native
serialization. The internal method separates each parent's Rules from its
remaining fields, creates Rates, then associates Rules with returned Rates by
parent ordinal. Native Rule construction overwrites child `created_by` and
`tax_rate_id` from the corresponding parent. It makes one nonempty batched Rule
create call and preserves the omitted/empty Rules distinction.

The complete DML remains authoritative: nullable SQL-real Rate values,
non-null code/name, default false Boolean fields, Region references, metadata,
managed identities/timestamps, active default-Rate uniqueness and active Rule
uniqueness on `(tax_rate_id, reference_id)`. Physical Rate deletion cascades to
Rules. Actual event contents/order, relation initialization and complete native
serialization are characterized below; DML and DTO declarations alone do not
establish their runtime results.

The public creation DTO permits omitted/null code although the model is
non-nullable, and omits `is_combinable` although the native runtime forwards
remaining parent fields. Characterize those actual native calls before choosing
the bounded decoder or an erased type correction. Preserve native success or
failure without introducing adapter normalization.

## Characterized native behavior and owner gaps

The original workflow returns Rates in creation order with `rules: []`, even
when its separate Rule insertion persisted children. Missing nullable fields
become null, Boolean defaults are false, empty code is accepted, and omitted or
null code fails. Runtime `is_combinable`, supplied IDs and supplied managed
timestamps are preserved. Rule association follows returned parent ordinal;
the parent creator overwrites the child creator. Unknown scalar fields are
discarded by the native repository. This bounded profile may refuse unknown
fields explicitly; it must preserve admitted native fields.

The maximum creates four Rates and eight Rules, emitting twelve creation events.
The retained physical inverse removes the complete created graph and emits only
four Rate deletion events. A repeated cancellation has no new deletion effect;
missing created roots do not prevent deletion of the remaining cohort. Existing
Providers, Regions and unrelated Rates/Rules survive. Native late failures roll
back both inserted parents and children. Deleted Region references are accepted;
an extra active-Region lookup would change this behavior. Active default
uniqueness and Rule uniqueness apply exactly as declared, including identical
reference IDs under different reference names.

Immediate returned values retain the submitted Rate number. SQL-real storage and
cold native reads use the database conversion: `16777217` becomes `16777216`,
and `1.0000000596046448` becomes `1.0000001`. Decimal and subnormal conversion
must use the actual SQL owner; JavaScript float rounding is not equivalent.
`1e-45` and `3.4028235e38` are accepted, while `1e-46` and `3.5e38` fail without
publishing a partial graph. Both the immediate and stored values require
authentication; comparing only the unchanged fields would weaken receipts.

The shared persistence owner binds submitted-to-converted REAL values through
its existing authenticated activity evidence, preserving cursor, source and
lifetime boundaries. The shared Medusa scalar owner preserves the native
immediate entity representation after successful insertion and admits checked
supplied timestamps explicitly for this profile. Other scalar profiles retain
their existing managed-field refusal. These owner corrections use standing core
approval; no native business correction or larger resource allowance is selected.

The original native runtime executes the creation again when invoked twice with
the same supplied transaction ID. Cancelling the first retained run removes
only its first cohort. This is distinct from Flarex's trusted durable command
replay contract; the native baseline must not be relabeled idempotent.

The original physical inverse uses unordered SQL `DELETE RETURNING`. Its
characterized Rate deletion events follow creation/storage insertion order,
which differs from ID order for the original maximum. The current shared
lifecycle root selection uses ID order. The approved portable profile selects
the complete retained Rate cohort by authenticated storage insertion order and
keeps the existing cascade traversal, physical writes and Rate-only events.
Its receipt verifies the exact ordered root identities and complete child
queries; other lifecycle profiles retain ID ordering. The original unordered
native witness remains separate from validation of this approved choice.

## Original-native questions

Preserve a separate original baseline before any corrected candidate:

- Empty creation and retained inverse, including Tax resolution and native
  internal calls.
- Complete default/null/empty/zero behavior, metadata, caller-owned values,
  managed fields and actual runtime grammar.
- Immediate returned numbers, SQL `real` storage and cold native DTOs as three
  distinct observations, including decimal ties, maximum/subnormal values and
  native refused values.
- Parent ordinal/Rule association, inherited creator values, omitted/empty
  Rules and native relation serialization.
- Complete maximum forward and retained inverse, including all Rates/Rules,
  events, timestamps, returned order and resource observations.
- Existing/in-batch default collisions, deleted defaults and Rule uniqueness,
  including repeated reference IDs under different reference names.
- Missing, deleted and valid Region references, using actual native reference
  behavior rather than an invented active-Region lookup.
- Physical deletion of the complete created cohort, repeated/missing inverses,
  preservation of existing Regions/Providers and unrelated Rates/Rules.
- Rule failure after parent insertion, late parent failure, replay, complete
  rollback and independent cold calculation using committed created Rates.

Observer or materialization failures remain harness failures. Preserve their
evidence separately from native outcomes; a successful rerun does not identify
an intermittent failure's cause.

## Bounded admission

The separate `tax.rateCreate` profile admits zero to four Rates across at most
two existing Regions, with zero to two Rules per Rate and eight Rules total.
Its forward and retained physical inverse retain the default 64 calls and 64
events. The calculation profile remains read-only. Genuine native callbacks,
complete returned DTOs, SQL-real presentation, managed values, creation events,
cascade deletion and approved inverse ordering are preserved at the existing
owners. Late foreign defects retain the complete Cause under the accepted
[Promise/Cause contract](./161-native-promise-cause-preservation.md).

The admission obligations are:

1. Characterize the genuine original workflow callbacks, service, repositories,
   serializer and physical inverse on ordinary-role PostgreSQL. Keep native
   preimages/results and any separately proposed corrected witness distinct.
2. Select a complete bounded creation cohort: zero to four new Rates across at
   most two existing Regions, zero to two Rules per Rate and eight Rules total.
   Refuse larger cohorts before a partial result. These proposed workflow bounds
   do not change general native Tax configuration limits.
3. Promote the exact native workflow/step through existing source-provenance and
   portable-fork owners. Preserve native calls, result shape, empty callbacks,
   event behavior and retained physical inverse. Reuse genuine construction and
   existing shared scalar/graph write, relation, mutation/event, Promise/Cause,
   receipt and physical lifecycle owners.
4. Add a separately confined Tax creation profile with the required native
   creation/deletion methods. Keep the calculation profile read-only and let
   only the existing trusted outer owner settle. Do not add provider bootstrap,
   remote effects or a second transaction authority.
5. Measure the complete forward and retained inverse against the existing
   64-call/64-event and other resource limits. Retain defaults until a measured
   refusal and a separate decision authorize a named allowance.
6. Validate the connected forward, inverse, late failure, constraints, malformed
   input, ownership, replay, complete events and resources on PGlite and focused
   ordinary-role PostgreSQL. Run owner and calculation regressions for necessary
   shared corrections, affected strict types/builds/source/portable checks and
   lint, both required reviews, cleanup and one scoped commit.

Complete Cart admission and its four pending business decisions, Tax Region
creation/bootstrap, other Tax administration, remote providers, chunked File
import, Product export, performance acceptance, general schema upgrades and
production/hosted activation remain outside this slice.
