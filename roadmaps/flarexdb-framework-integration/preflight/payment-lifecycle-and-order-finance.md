# Payment authorization, capture and refund with Order finance

## Status and selected outcome

Status: implemented as a bounded private System-provider profile, including the
approved Order-finance prerequisites. Existing native System session workflows
remain supported; authorization, linked capture, single refund with credit-line
confirmation and atomic batch refund extend the same Payment owner. Network
providers, independently committed best-effort batches and hosted activation
retain their separate admission gates.

The pinned Medusa revision is `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.
Preserve native authorization and cancellation compensation, capture/refund
steps without automatic financial compensation, exact amounts, collection
totals/status, native events, replay and trusted outer settlement. The local
System provider is eligible; network providers still require a durable effect
boundary outside database transactions.

The genuine capture root reads Order–PaymentCollection links and conditionally
adds Order transactions. The genuine single-refund root additionally requires
the Order summary, refund reasons and the native Order-change/credit-line chain.
Those branches must not be pruned or replaced with fabricated absent links.
Order finance uses new `modules/order/finance-*` files and existing native Order
construction/metadata. The concurrent Order Change cancellation profile retains
its own repository, service, input and receipt. Native Order finance extraction
must compose with its exact restoration correction and source guard.

## Native version insertion and request bounds

Native Order confirmation copies the existing shipping detail, including its
creation, update and deletion timestamps, then removes its identity to create
the next version. The financial repository distinguishes this insertion from
an existing-row merge using its same-manager identity read. Fresh rows use the
existing logical insert operation; existing rows use the preserving merge.
Insertion retains native supplied timestamps and storage-owned defaults for
omissions, rejects occupied identities, includes pending writes and retains
negative-read dependencies for settlement. The confirmation receipt checks the
complete native result and copied fields. No timestamp permission, storage
policy or reconstitution capability is added.

The linked financial roots select a named 512-call allowance through the
existing trusted atomic owner. That owner binds the selection into request
identity and enforces its unchanged ceiling. The ordinary default remains 64;
a root retaining that default refuses atomically before linked capture can
complete. The allowance applies only to capture, single/batch refund and their
retained financial callbacks. Four-entry cohorts, row, byte, event, statement
and deadline limits retain their existing owners.

## Inverse-one query prerequisite

The native authorization step retrieves `PaymentSession.payment.captures`.
Native DML declares Session.payment as an inverse `hasOne`, backed by Payment's
unique active `payment_session_id` reference. The existing shared adapter query
relation owner supports owning `belongsTo`, `hasMany` and pivots, but cannot
represent or project an inverse singleton. Payment's current query profile
therefore refuses the native relation selection.

Witness: `payment-lifecycle-contracts.test.ts` retains the native DML and exact
authorization selection. Expected: one related Payment object or null, with
complete bounded nested captures and duplicate-cardinality corruption refused.
Actual: `unsupportedProfile` before execution.

Proposed owner correction: extend the existing shared query descriptor,
population, projection and authenticated assembly owners for inverse `hasOne`.
Preserve active filtering, complete cohorts, one-manager execution and failure
semantics. Any newly fallible pure assembly must use Result and migrate existing
callers, rather than choosing an arbitrary first related row. Neutral query
fixtures and the native Payment consumer must prove the correction, including
absence, nesting and cardinality refusal, on both database lanes.

Disposition: the user explicitly approved this shared query correction,
including the fallible assembly caller migration and both database lanes.

## Generated serial prerequisite for Order credit lines

Native `createOrderRefundCreditLinesWorkflow` calls `addOrderAction` without an
`ordering` value. Its DML column is non-null `serial`; the native Drizzle owner
allocates omitted values with `coalesce(max(ordering), 0) + 1`. The previous
Order foundation explicitly admitted preservation only, with no allocator.
Shared lowering consequently gives this column an integer type and no default,
and shared logical row normalization refuses the unchanged native input.

Witness: the omitted-ordering case in `order-generated-serial-contracts.test.ts`
checks genuine Order metadata and invokes the existing shared logical row owner.
Expected: trusted generated serial allocation before complete-row validation.
Actual: missing required integer, reported as `documentInvalid` by that owner.
Supplying a fabricated action ordinal, omitting the native column, using custom
adapter SQL, or seeding around creation would bypass the missing owner contract.

Proposed correction: add generated serial semantics to the shared relational
schema and logical storage/default owner for fresh installation definitions.
Allocation must preserve the selected native max-plus-one behavior, explicit
preserved values, signed int32 exhaustion, scope/table/column identity,
pending-write ordering, concurrent calls, rollback and durable replay. Existing
trusted settlement remains the authority; adapters gain no raw SQL, counters or
settlement capability. Preserve the prior preservation-only witnesses. Prove
neutral and native Order consumers on both database drivers, and retain the
populated-schema upgrade gate.

Disposition: the user explicitly approved this shared-owner correction. The
generated profile reuses the existing complete bounded identity-index range and
its settlement dependencies, including soft-deleted and pending rows. It adds
no durable counter or second transaction owner. Existing preservation-only
callers retain their selected schema; finance selects generation for a fresh
installation. Physical-table lowering refuses this logical default because
PostgreSQL sequence behavior differs from the selected max-plus-one contract.
Payment-local lifecycle, Module Link and Order transaction/summary work remain
independent preparation within the approved connected finance scope.

## Native financial reference boundary

Original pinned PostgreSQL/MikroORM and SQLite/Drizzle services both execute the
nonempty item-and-shipping sequence: capture/refund transactions, Change and
omitted-ordering Action creation, credit-line confirmation and native undo.
The confirmed current total, paid/refunded amounts, transaction total and pending
difference agree, as do the restored version and accounting after undo.

The original profiles differ in the confirmed summary's `original_order_total`:
PostgreSQL returns `12.5` for an Order with a `12.5` item and `2.5` shipping,
while SQLite returns `15`. The native change processor takes this field from
the Order total supplied by the selected read projection. This discrepancy
requires projection-level characterization; successful calls do not establish
complete cross-driver DTO parity. Adapter financial admission remains gated on
its actual native read/formatting contract, including nonempty shipping.

## Exact native refund transform prerequisite

The unchanged single-refund root returns native `MathBN.mult` values from its
transaction transform, and can return a `MathBN.sub` value for its credit-line
amount. Native `resolve-value` applies `parseStringifyIfNecessary`, preserving
these mathematical values as exact decimal strings through their native JSON
representation. The finite SDK's `prepareTransformResolution` currently accepts
plain records and bare intrinsic Dates, and rejects native arithmetic instances
with `invalidReference` before any downstream financial method can run.

`payment-refund-transform-contract.test.ts` preserves the actual native decimal
serialization and the current finite-runtime refusal, including a quantity with
more precision than JavaScript Number can retain. The owning correction belongs
in finite SDK transform resolution, alongside its existing Date normalization;
ordinary private JSON capture must remain strict. A candidate must recognize
only the executing native arithmetic representation, preserve exact strings,
refuse decorated/counterfeit/nonfinite values without arbitrary `toJSON` or
accessor execution, retain reference resolution and resource bounds, and prove
neutral plus native refund consumers. Dependent refund transform execution
has an approved shared-owner correction. Both preserved prerequisite witnesses
reproduce the refusal. The candidate normalizes only inert state of the pinned
native arithmetic/quantity representations; dependent execution remains gated
on owner and consumer validation.

The connected Order read boundary has a related representation requirement:
native `decorateCartTotals` produces Medusa BigNumber DTO properties, and
`createRawPropertiesFromBigNumber` adds raw companions without replacing those
instances. Ordinary strict JSON capture correctly rejects an unnormalized DTO.
Native JSON serialization presents these properties as numbers. Any admitted
Order facade must normalize this native presentation through the existing
numeric owner before final strict capture, with no arbitrary serializer calls
or widened persisted JSON contract. The same preservation test records this
distinction separately from finite transform resolution.

The native versioned Order writes also retain genuine quantities from the
executing framework constructor. A focused storage witness confirms that the
existing numeric boundary rejects that constructor, while recognizing its
separate storage constructor. Correct the existing numeric owner without
changing its default precision, comparison representation, laziness or foreign
failure classification. Native Capture transactions can additionally carry
their checked raw amount record; admitting that representation requires an
explicit native input profile. Ordinary scalar caller input must continue to
refuse raw records. The original constructor-refusal witness is preserved;
neither DTO normalization nor a finance-local codec can replace this gate.

SDK numeric validation uses its existing coherent native source graph. The
default mixed source/CommonJS test loader produces distinct quantity
constructors and refuses the foreign instance. This does not authorize
structural brand checks or broad constructor compatibility. The actual
adapter's executing native constructor and full financial roots need their
own consumer validation.

## Transaction batch admission boundary

Source review identifies a separate pre-existing native condition:
`updateOrderPaidRefundableAmount_` selects summaries using the first transaction's
version, while creation assigns each Order's own version to its transactions.
Transactions for Orders on different current versions can therefore target an
incomplete or historical summary cohort. Correlating versioned read populations
does not correct that native accounting query. General mixed-version batch
admission requires an original native witness and an explicit correction at the
native Order business owner; an adapter must not repair its arithmetic or hide
the result. The present transaction consumer witness selects one Order, and
the selected input profile requires one Order per transaction call. Native
batch arithmetic remains unchanged; general batch compatibility and financial
root admission remain unestablished.

## Unresolved initialization publication timeout

The preserved original PostgreSQL fifth-Capture setup failed during fixture
initialization with `statementFailure` / SQLSTATE `57014`, inside application
search publication. Expected behavior is successful initialization followed by
the Payment cohort refusal before its provider runs; the actual failure occurs
before that call is reached. Point publication/materialization owns this path,
not Payment's repository or provider. The original failure is preserved for
focused diagnosis; limits and deadlines remain unchanged. The guard's selected
setup now imports existing captures using ordinary individual storage commands,
and requests a valid small amount so native over-capture cannot mask a missing
cohort check. This does not establish a fix for atomic initialization, nor yet
establish whether the cause is a persistence defect or shared-machine resource
pressure. The corrected PostgreSQL guard proof remains open, and a passing rerun alone
would not establish its cause.

## Native numeric version selector prerequisite

The native financial Order methods read summaries with indexed `order_id`
membership and a numeric `version` conjunct. Versioned Order populations use
the same parent/version correlation. Native DML lowers `version` to shared
`doublePrecision`; this is distinct from exact-decimal `numeric` amounts.

`order-finance-version-query-contract.test.ts` exercises the actual native
metadata, financial query preparation and shared relational query compiler.
The indexed parent selector succeeds. Adding the unchanged native `version: 1`
selector returns `invalidInput`: shared `in` admits only text and boolean
columns, while existing `numericIn` deliberately belongs to exact decimals.
Expected behavior is bounded numeric equality filtering on the same indexed
parent cohort, without discarding historical-version isolation.

The logical relational query owner must admit finite numeric membership for
its actual integer/double storage representations. Preserve exact-decimal
semantics, query and operand bounds, indexed candidate eligibility, dependency
tracking, same-manager execution and PostgreSQL predicate parity. Removing the
version condition, converting numeric data to text, post-filtering in the
adapter, or adding another storage read would bypass that owner.

Disposition: the user explicitly approved the shared-owner correction. The
candidate adds named `numberIn` membership for finite integer/binary64 values;
ordinary text/boolean `in`, exact-decimal `numericIn` and REAL conversion keep
their existing contracts. Numeric membership supplies no new indexed selection
authority. The original successful parent and rejected version witness is
preserved. The shared logical owner now admits this bounded numeric
membership. Native Order consumer validation remains pending on both drivers;
full financial workflow admission remains gated.

## Financial receipt and native preview boundaries

Native transaction removal selects public numeric amounts together with their
raw companions. Receipt accounting must retain the checked `raw_amount` when
calling the extracted native accounting helper: native
`transformPropertiesToBigNumber` restores that exact value before subtraction.
Dropping it would make receipt validation recompute from a rounded DTO number.
The correction and a genuine retained-step inverse regression beyond `2^53`
are prepared; their financial root execution remains unestablished. This does
not change native Summary arithmetic or promise arbitrary precision in its
public numeric fields.

Order Change creation initializes detached `actions: []` through native
`fillEmptyToManyRelations`; this is presentation, not a stored relation write.
The financial creation receipt derives scalar defaults from checked DML and
leaves generated Action ordering under the existing trusted serial owner.
The candidate module binds Change and Action creation with separate deletion
compensator receipts. Connected driver proof remains open. Confirmation and
undo receipts are prepared separately and remain unexposed while their complete
native read, mutation and event closure is unfinished.

The native confirmation processor invokes preview enrichment before decorating
totals, including for credit-line actions. Private Order helpers now own the
unchanged native accounting, totals selection and preview enrichment bodies.
The class retains its read ports and shared context, composed with the accepted
cancellation restoration. Complete typed and emitted helper programs and the
composed class remain guarded. Adapter receipts must reuse these helpers
rather than replace their arithmetic or enrichment; extraction alone admits
no financial workflow or persistence capability.

The standalone native consumer host grants no preserving-deletion upsert
authority. Its expanded confirmation sequence therefore cannot establish
positive compatibility. Confirmation and undo require the actual atomic
participant plus complete call validation; enabling an unvalidated capability
on the standalone host is not a valid test-harness repair.

## Required graph option remains unadmitted

The unchanged native refund credit-line child requests
`useQueryGraphStep({ options: { throwIfKeyNotFound: true } })`. The finite graph
step currently admits only `isList` and cache hints. The focused current-owner
witness admits the bounded query without this option and reproduces
`unsupportedProfile` before dispatch when the native option is added. The
original witness and pinned owner sources are preserved. The correction is
covered by the user's verified standing authorization for necessary Medusa core
changes. Dependent full refund execution remains gated on implementing and
validating the correct owner; authorization alone does not establish compatibility.

The pinned native graph forwards the option to RemoteJoiner, which validates
that primary-key filters exist and reports every missing requested root key.
An extension must preserve those semantics and bounded complete-query evidence;
an empty-result-only check or a permissive options decoder would be insufficient.

The preserved native key-validation witness constructs a real Medusa
`NOT_FOUND` error, but the receiving adapter constructor check does not
recognize it and propagates it as a defect. The candidate boundary uses the
existing native `MedusaError.isMedusaError` recognition together with the named
`NOT_FOUND` type. Other native error types and ordinary throws retain their
original defect identity. This is a selected foreign-function boundary, not a
structural Cause or trust exception; financial admission remains gated.

## Refund query views and execution profile

The finite common steps describe selected Payment, Order, RefundReason and
OrderChange projections with checked partial views. Native DTO declarations
cannot establish fields that the query did not select. Throwing financial
singletons require an actual row; nullable associations and native summary
fallbacks retain their selected shapes. Native batch validation consumes only
Payment identity and capture/refund amounts, and its association map derives
its type from the checked query projection. These type adaptations retain the
native executable bodies and complete source guards.

The candidate batch-refund wrapper retains the genuine root, stored Link reads,
Order transactions and native logger. Its bounded System-provider profile
borrows one atomic settlement. A caught participant refusal still poisons that
root under the existing trusted execution contract. This does not admit native
independently committed best-effort behavior or a network provider inside the
transaction. Empty input, successful accounting, replay and refusal need actual
connected consumer proof on both database drivers before admission.

## Repeated partial batch refund reference prerequisite

The pinned native batch root identifies an Order refund transaction using the
Payment ID. Its existing transaction step deduplicates by Order, reference and
reference ID. A second valid partial refund with a new request key therefore
creates a genuine Refund but finds the prior transaction and skips new Order
accounting. The single-refund root uses the genuine Refund ID instead.

Witness: `logical-payment-finance-workflows.test.ts` preserves two successful
distinct-key refunds, `3.125` then `1`, after capturing `15` in an independent
scope. Expected: two refund transactions and refunded/transaction totals of
`4.125` / `10.875`, with unchanged same-key replay. The source trace predicts
one transaction and stale Order totals; execution remains pending.

The correction belongs to the native batch workflow: derive newly created
Refund IDs and exact amounts from successful Payment outputs, excluding IDs
present in the initial query and deduplicating cumulative output cohorts.
Use those Refund identities with the existing transaction step and retained
compensator. Array position, fabricated IDs, adapter writes and changes to
storage transaction deduplication cannot repair this business-owner defect.
General independently committed best-effort execution remains separately gated.

Disposition: the user explicitly approved the native refund identity correction.
The candidate uses genuine new Refund IDs and exact amounts while preserving
the existing transaction deduplication and compensation owners. Batch admission
remains gated on the genuine repeated-refund and complete financial witnesses
on both database drivers.
