# Native Tax Region creation workflow

## Status and authority

Status: implemented, validated and reviewed as a private bounded creation
profile on PGlite and ordinary-role PostgreSQL. The genuine root includes
connected default Rate/Rule creation and native retained physical compensation.
The scoped Region inverse ordering and portable required-field and CHECK
diagnostics below are implemented approved contracts. Default resource limits
remain unchanged. This independent branch does not inherit the separately approved
[Tax Rate lifecycle ordering](./169-native-tax-rate-deletion-workflow.md).

The reference is Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The selected root is
`createTaxRegionsWorkflow` and its genuine `createTaxRegionsStep`. Accepted shared
logical storage, existing finite workflow execution and singular trusted outer
settlement remain authoritative. This preflight grants no hosted activation,
remote provider or general Tax administration capability.

## Connected native contract

The workflow calls one native step. Forward execution resolves Tax and calls
`createTaxRegions` with the Region array, including an empty array. The step
returns those created Region records and retains their returned IDs. Nonempty
retained compensation calls generated **physical** `deleteTaxRegions`; empty
retained compensation returns before resolving Tax.

Native `createTaxRegions_` normalizes the Region inputs, validates existing
parents, creates Regions, pairs truthy default Rates with the actual returned
Region IDs by position, and conditionally calls native `createTaxRates` once for
that batch. Native Rate creation conditionally creates nested Rules. Original
Region records are serialized only after those calls complete. These operations
share the native module transaction; an atomic outer root does not substitute
for native retained compensation or for already-delivered native events.

No external Region module, Tax provider resolution, provider calculation or
provider lifecycle call belongs to this creation branch. Tax Provider is
persisted foreign-key support. Independent local SystemTax calculation is a
consumer witness rather than an additional creation capability.

## Characterized native behavior

Country codes are lowercased without trimming or ISO validation. Truthy province
codes are lowercased; absent and falsy province values become null. Explicit
`parent_id: null` is considered defined by native `isDefined`, so it enters the
existing-parent lookup and cannot find a matching parent. Omitting `parent_id`
does not enter that lookup. Parent validation precedes every insertion, so a
parent created in the same input batch cannot satisfy it.

The existing parent must be visible and match the normalized country. Native
validation does not require that parent to be a top-level country Region.
Province without a parent is permitted. Checked DML additionally requires a
nonnull province for a child and forbids a child from specifying a provider.
Active country/province uniqueness and the separate active country/null-province
uniqueness remain storage obligations. Missing Providers fail through native
foreign-key error conversion with `MedusaError.Types.NOT_FOUND`; disabled and
historical persisted Providers are accepted. No Provider existence query belongs
to creation, and no enabled-provider or registration check may be introduced.

The native missing-reference parser retains its comma and parenthesis behavior.
A missing Provider ID `tp_missing,tail` is presented as `tp_missing`, while
`tp_missing(tail` is presented as `tail`; a closing parenthesis remains in the
value. A formatter that prints the complete semantic key directly changes this
native error contract. Reuse the native parser and message owner, preserving the
original reference facts separately from their public presentation.

`default_tax_rate` is spread by the native implementation. Runtime nested Rules,
managed fields and `is_combinable` therefore reach Rate creation even though the
nested DTO lists fewer fields. Native preparation overwrites `is_default` with
true and `created_by` with the Region creator, including an own undefined value;
the actual created Region ID overwrites a supplied nested `tax_region_id`.
Native Rate creation overwrites each Rule creator again. The adapter must derive
its runtime boundary from this executing path and checked DML, rather than
silently filtering input through the narrower DTO.

Omitted/null default Rates do not trigger Rate creation. Omitted or empty nested
Rule arrays do not trigger Rule creation. Defined malformed Rules, including
null, retain their native failure behavior. Shared input objects, creator and
metadata aliases, omitted fields, required Rate field failures, and managed
identity/timestamp behavior are part of the original characterization and must
remain represented in the workflow receipts.

The native creation repository initializes empty to-many collections on the
returned Region records. Creating default Rates afterwards does not populate
those detached `tax_rates` collections. A nonnull scalar parent/provider ID does
not itself populate a relation body. Immediate workflow output and later cold,
explicitly populated reads therefore need separate full-result contracts.
Omitted nullable parent/provider scalar foreign keys are absent from immediate
creation output, while explicit null and nonnull IDs remain present. Complete
stored rows still contain their null defaults. This is native entity-creation
presentation, not a storage-nullability change or a cold-read contract.

Reusing the same explicit root object twice returns two Region DTOs and retained
IDs but stores one Region and emits one creation event. Reusing a transaction ID
reruns native creation and can fail a duplicate identity; it does not by itself
cache a successful SDK result. Scalar root input remains outside the admitted
array profile: the original can insert a Region before failing array result
mapping, leaving no registered step compensation. No native correction for that
unsupported shape is selected.

## Physical retained inverse

The native Region DML cascades physical deletion to current child Regions and
Rates, then Rules. The physical repository does not add a deleted-at filter.
Historical descendants and descendants added after forward execution belong to
the current inverse closure. Missing roots are not recreated, and Provider,
ancestor and unrelated rows must remain unchanged.

Native deletion messages belong to explicitly returned Region roots; database
cascades do not independently produce child Region, Rate or Rule deletion
messages. The original maximum emits Region creation events in request order,
then default Rate events in positional Region order, then nested Rule events in
input order. Retained deletion emits only explicit Region deletion events in the
observed Region insertion order. SQL `RETURNING` supplies no general ordering
guarantee. The approved scoped portable inverse selects the complete explicit
Region root cohort by authenticated storage insertion order and emits only those
root deletion events in that order. Cascaded descendants remain part of complete
physical deletion without gaining root events. Forward Region → Rate → Rule
event groups and their native ordering remain unchanged. Default limits remain
unchanged. Earlier Rate and Rule lifecycle/physical-inverse ordering decisions
remain separate from this explicit Region selection.

The original supporting soft-delete calls retain an observation limitation for
opaque internal tuple-map returns. Their public affected maps and complete cold
tables establish the historical descendants used by this creation/inverse
branch; arbitrary internal tuple-map compatibility is not claimed. An
independently seeded unrelated Rate/Rule graph remains a separate preservation
control for adapter validation.

## Implementation ownership and boundaries

Reuse the complete four-model Tax DML, confined Tax module construction,
request-local bridge and native subscriber, scalar creation owner, checked
complete-row/default contracts, native relation initialization and shared
physical graph lifecycle/receipts.
The Region profile adds its workflow-specific input,
query, mutation and output contracts. Provider support is read-only and must not
expose a provider repository mutation or remote resolution capability.

The shared physical owner now supports bounded acyclic self-reference with
child-first row dependencies, overlapping reachability and explicit requested
root correlation. Historical descendants remain included; cycles and unsupported
composite self-references fail before writes. Cascaded same-table children do not
become requested root IDs or root events. The Region profile additionally
validates its complete graph, current descendants, root-only events and retained
inverse through the existing authenticated receipts. Shared self-reference
support alone does not admit additional consumer profiles. No Tax-specific
traversal or weaker foreign-key protection is selected.

The scalar creation owner implements an explicit checked-DML option for native
nullable belongs-to field presence. It correlates canonical returned IDs with
prepared inputs, preserves complete storage/event rows, and alters only detached
creation output. Omitted nullable references remain absent; explicit null and IDs
remain present. Existing profiles retain their current behavior. This shared
capability alone does not admit additional consumer profiles.

Positive text/boolean `IN` query operands use the implemented shared SQL-null semantics:
null contributes no match while remaining part of the authenticated raw query
and operand budget. Column authority, malformed siblings, nonnullable writes and
unsupported recipes remain checked. Explicit `parent_id: null`
must reach native missing-parent validation rather than fail an adapter query
decoder or gain a special Tax filter.

The shared logical owner implements an explicit identity-bound reference
checkpoint selection, requiring its existing per-call coverage validator. A
checkpoint reuses final-close reference validation and authenticated reads within
the same live borrowed context; it neither settles nor cascades, and default
profiles retain final-close reference behavior. Exact storage-issued failures
retain private child/column/target evidence. Physical and unsupported borrowed
profiles refuse this selection. This support alone does not admit additional
framework profiles.

Native creation detects missing references during its outer module transaction
flush, before the step completes. That flush also validates required fields per
dependency-ordered model group: the original minimal-default control inserts its
Region before failing required Rate-code validation. Malformed Rule-array
normalization instead fails before flushing. A checkpoint at module return or
immediately after every Region callback cannot claim native first-failure parity.

The Tax staging selection extends the existing request-local transaction bridge
with an optional same-child flush after the native callback succeeds. Its scalar
creation selection retains native identity planning and defers only acceptance
for the selected profile. Existing profiles retain eager scalar creation. The
working set still owns supplied-field, complete-row, uniqueness and reference
validation. This selection is confined to the admitted Region creation profile.

The narrow selection belongs to the existing request-local transaction
bridge. Inside `transaction(callback)`, await `task(child.manager)`, then flush an
optional named creation plan using that same child before revoking its borrow.
Keep callback failures ahead of the flush, and preserve the existing lifetime,
sticky failure and outer settlement owners. Native direct
`this.createTaxRates` and internal Rule dispatch bypass the standalone workflow
facades; their complete-row argument/output decoders remain unchanged. No
decoder bypass is selected for those independently admitted Rate/Rule wrappers.

The transient plan must authenticate entity identity, model and creation phase.
Its callback records contain only supplied scalar fields, canonical IDs and
empty native to-many collections. Absent nullable foreign keys, defaults and
managed values remain omitted until flush. Existing scalar serialization already
captures bounded JSON projections without requiring a complete stored-row
projection hook; this permits the named transient shape without an arbitrary
decoder bypass. Complete storage rows and event data remain subject to their
existing validation at dependency-ordered Region → Rate → Rule flush. Validate
the final Region output against native creation presentation after stored-row
validation. This staging selection preserves existing default cross-call
semantics.

Combined original-only controls establish the first-failure contract. A missing
Provider wins over a missing default Rate code or duplicate nested Rule key:
Region, Rate and applicable Rule creation callbacks return before the Region
insert fails during the outer module flush. In contrast, a null Rule array fails
inside native Rate normalization before any Region insertion. Every combined
failure rolls back the complete graph and delivers no events. Eager validation
of nested rows, a Provider pre-read, and an unconditional checkpoint immediately
after Region creation would each change this contract.

Within one native model group, all `beforeCreate` hooks run before its complete
required-field pass, and that pass precedes any insertion from the group. A
missing required code on a later Rate therefore precedes an earlier Rate
identity conflict. Required fields follow native declared-property order: a
missing code precedes a supplied null name. At the subsequent row insertion, a
Region CHECK violation precedes a primary-key conflict. Earlier model-group
failures still precede required failures in later groups. The creation profile
must preserve these distinctions without widening default relational profiles
or moving validation across model groups. Required-error pending records must
retain the actual flush defaults and timestamps, as well as detached relation
arrays; first-line agreement alone does not establish this diagnostic contract.

Before that flush, repository callbacks return transient entities containing
their generated or supplied IDs and supplied scalar values. Missing nullable
scalars, declared Boolean defaults and managed timestamps are still undefined;
empty to-many collections are already initialized. Nested Rate serialization
therefore omits a missing code and absent `is_combinable`, while retaining
`rules: []`. Completing these entities from storage defaults before native
callbacks finish would change their observable values and creator propagation.

Creation preparation must therefore remain distinct from accepting complete
storage rows. A scoped framework creation/flush boundary must preserve native
callback failures, dependency-ordered model groups and per-group storage
validation. Missing-reference evidence belongs to the existing shared reference
owner, with native classification at the framework boundary. Any checkpoint must
retain authenticated read/resource accounting, final-close revalidation and
default cross-call final-reference behavior, while remaining separate from
cascade maintenance. No Tax pre-read, duplicate enforcement, fabricated
PostgreSQL exception or general early-validation policy is admitted. The
creation/flush selection is confined to this profile; other profiles retain
their existing validation and reference boundaries.

A missing required default Rate code follows the native MikroORM entity
validator, rather than PostgreSQL NOT NULL conversion. It throws native
`ValidationError`, with the required-property/value prefix followed by an
inspected TaxRate entity. That entity already contains flush-time defaults,
timestamps and the native Rules collection; generated ID appears in native
construction order. This is distinct from the transient callback presentation.
The native class owns the entity and exposes `getEntity()`; a MedusaError
replacement changes its observable contract.

The logical row owner implements private required-column evidence issued only
at the actual existing missing-column or supplied nonnullable-NULL rejection.
It retains the real normalized table identity, column, failure kind and only an
issuer-owned immutable pending candidate when available. Exact-error identity
survives the existing owner projection; copied/public causes confer no evidence.
Validation, defaults, error classification and storage acceptance stay unchanged.
The physical compatibility path has different failure owners and is not widened
for this logical Tax branch. Tax-native presentation consumes only this
authentic evidence under the approved portable contract below.

Full required-field message rendering also depends on native entity/collection
custom inspection and Node inspection semantics, including property order,
quoting, nested metadata, dates and layout. Current portable owners provide
neither this renderer nor the native constructor. A reusable native message-frame
extraction alone does not close that gap. No hardcoded entity dump, copied
generic inspector, Medusa INVALID_DATA substitution or silent message change is
selected. The approved portable contract below defines the implemented scoped
diagnostic exception without introducing a generic inspector or ORM dependency.

### Approved portable required-field diagnostic

The approved exception is limited to required-field errors in
this creation profile. Preserve the native required-property/value first line
and the public name `ValidationError`. Use a portable Error constructor rather
than importing the ORM constructor into the browser graph. Expose `entity` and
`getEntity()` as the same detached pending creation record, with native to-many
collections represented by their creation arrays. Keep internal core evidence
private and identity-bound; mutating the detached error record must not change it.

For the original missing-code control, the approved portable message is exactly:

`Value for TaxRate.code is required, 'undefined' found`

The approved portable message omits the original appended Node-inspected entity
dump. ORM entity/Collection instances, inspection formatting and `instanceof`
identity with the installed MikroORM ValidationError are outside this scoped
portable contract. The unchanged original witness remains the baseline for the
approved portable exception. Validation order, rejection,
rollback, forward normalization, events and resource limits remain unchanged.
This implemented public diagnostic compatibility decision grants no permission
to duplicate required-field validation in the adapter. Issuance
still belongs at the actual existing core rejection; portable presentation
consumes authenticated evidence through the existing Promise failure owner.

### Approved portable CHECK diagnostic

The original complete child-Provider and missing-province exception graphs expose
native `CheckConstraintViolationException` errors with SQL, bound parameters,
physical row dumps and PostgreSQL implementation fields. This separate public
diagnostic compatibility decision is explicitly approved for the two named checks.

The approved portable contract preserves the public name
`CheckConstraintViolationException`, code `23514`, table `tax_region` and the
exact native constraint name. Its message is the original PostgreSQL reason
sentence, without a terminal period:

- `new row for relation "tax_region" violates check constraint "ck_tax_region_provider_top_level"`
- `new row for relation "tax_region" violates check constraint "ck_tax_region_country_top_level"`

The approved contract omits embedded SQL and parameters, the physical-row `detail`
dump, ORM constructor identity and PostgreSQL implementation fields. It does not
add a Medusa `type` property or fabricate a driver exception. The original full
exception graphs remain separate unchanged witnesses. Rejection, native
normalization, first-failure ordering, defaults, rollback and events stay the
same; default resource limits remain unchanged.

Only the two exact checked DML identities are mapped to their witnessed native
names: `CK_tax_region_provider_top_level` to
`ck_tax_region_provider_top_level`, and `CK_tax_region_country_top_level` to
`ck_tax_region_country_top_level`. Native Knex emits these names unquoted and
PostgreSQL folds them; this is not permission to lowercase arbitrary names.
Unmatched identities do not receive this presentation.

Shared storage must issue authentic constraint/candidate evidence at the actual
existing CHECK rejection. The native presenter must not repeat CHECK evaluation,
read public causes, synthesize timestamps or expose the private candidate. This
compatibility decision is implemented in this profile. Other CHECK identities
retain their existing failure presentation.

Native uniqueness diagnostics need no divergence: retain the genuine conflicting
key's ordered source fields and values at their storage owner, then reuse native
Medusa INVALID_DATA conversion and message formatting. Existing Rate/Rule refusal
proofs do not establish native diagnostic parity for these additional cases.

The admitted forward maximum is four newly created Regions, four default Rates
and eight nested Rules. Existing Rate creation's two-existing-Region profile is
not an interchangeable contract: this root can create four distinct Regions.
Reuse its row/default owners without silently widening that existing profile.
Parent support is confined to the native existing-parent ID lookup and its
selected id/country projection, with complete active row decoding before
projection. The complete retained inverse bounds are eight Regions, eight Rates
and sixteen Rules, while explicit retained roots stay at most four. Its
current/historical closure requires full-row decoding and authenticated
count/membership receipts. The complete graph is selected before writes; an
oversized closure is refused rather than truncated. Forward and separately
committed retained-inverse roots retain default 64-call/64-event, byte and
deadline limits.

Preserve the completed unchanged original-native witnesses, including complete
calls, retained inputs, aliases, errors, cold tables and events. They establish
maximum creation/cancellation and independent calculation, normalization and
parent/provider constraints, malformed nested data, transaction rollback, current
and historical descendants, missing roots, repeats and late-parent failure.
Original business failures remain outcomes; fixture/bootstrap/observation or
cleanup failures do not count as native characterization. Diagnostic repairs
remain separate from unchanged native business code and original failures.

The genuine source pair is promoted with the connected adapter slice under the
scoped approved ordering and diagnostic contracts above. Complete-body
validation and authenticated receipt/event enforcement remain mandatory for
forward execution and retained compensation. Shared resource, replay, rollback
and publication owners retain their existing authority.

General Region updates/deletion administration, remote providers, Cart admission,
populated-schema conversion, performance acceptance and production/hosted
activation remain separate.
