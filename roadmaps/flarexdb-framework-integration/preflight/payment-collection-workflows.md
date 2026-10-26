# Payment collection workflows

## Status and selected outcome

Status: implemented private System-provider slice. The connected slice adds native
Cart/Order collection creation, Cart amount/currency refresh and collection
cancellation to the existing private System-provider Payment profile.

The executing reference is Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. Native workflow roots, steps,
validation, hooks and retained compensators remain the business owners.

## Required owners

Cart needs a named read profile over its complete native metadata and actual
stored totals inputs, plus the genuine Cart–PaymentCollection Link. This slice
admits no Cart mutation API or complete Cart creation/Promotion workflow.
Native total selection and arithmetic must execute in their existing module
and utility owners. Neither supplied Cart totals nor fabricated absent Links
can substitute for stored graph reads.

Order creation reuses the existing financial read and Order–PaymentCollection
Link owners. Link creation and dismissal must execute the native Link service,
including retained compensation and endpoint/lifetime validation.

Payment needs bounded native collection create/list/update/upsert/delete
methods, existing session deletion and payment cancellation. Fresh collection
creation and its compensator are distinct from an existing collection update
and its native preimage upsert. Complete DML rows, exact numeric companions,
selected reads, mutations, results and events require authenticated receipts.

## Execution profile

All providers remain local System providers. The existing queued atomic host
owns settlement, sticky refusal, replay and resource accounting. Native batch
cancellation logs individual errors; this atomic profile still refuses the
whole root when a participant fails. This is not independently committed
best-effort cancellation or permission to perform gateway calls in a database
transaction.

Creation must reject an already-linked/completed Cart. Refresh preserves exact
amount comparison, currency changes, empty/no-collection branches, actual
session invalidation and the native validation hook. Cancellation rejects
completed/already-canceled collections, cancels only native-selected authorized
payments and retains partially captured accounting.

The pinned collection-update compensator restores amount, currency and
metadata; it does not restore collection status. Whole-root atomic rollback
retains its existing owner. Separately committed cancellation compensation is
not admitted by this slice.

## Admission gates

The admitted profile covers genuine connected roots, missing/deleted collection
refusal, pending Link visibility, exact amounts, refresh/no-op, cancellation,
native collection/Link inverses, late failure rollback, events and replay on
PGlite and ordinary-role PostgreSQL. Competing Cart creations publish one
collection and Link: PostgreSQL overlaps both native branches before publication,
while PGlite serializes the attempts and retains the native already-linked
refusal alongside rollback-only failure. Replaying the winner adds no durable
writes. Identical Cart and request identities remain scoped to their own shop;
foreign collection reads and cancellation cannot cross that boundary.

A capture whose settled response is lost to its client replays after reopening
the workflow host without another provider invocation or durable write. Changing
its input under the same request identity is refused. This establishes recovery
after settlement and client delivery loss; ambiguous database COMMIT
acknowledgement and process restart retain their separate recovery gates.
Cancellation leaves a fully captured Payment unchanged while canceling the
remaining authorized Payment and retaining partial collection accounting.

Source promotion does not establish arbitrary Cart workflows. Network providers,
full checkout, complete Cart creation and hosted activation retain their existing
separate gates.

## Native owner prerequisites

The user approved the native Payment cardinality correction. The public
`updatePaymentCollections(selector, patch)` overload promises an array, while
the pinned implementation tests whether the patch itself is an array and
returns a singleton. The native cancellation root indexes that result. The
preserved cardinality witness fails for a selector and passes for an ID; the
correction selects return shape from the actual ID-or-selector argument.

The finite SDK additionally refuses the native `idempotent: false` declaration,
has no `StepResponse.skip()` and omits `parentStepIdempotencyKey` from child
callbacks. Three focused SDK witnesses preserve these failures. The native
Cart collection roots use all three contracts. Their selected atomic facade
must invoke the genuine root as a child, derive its parent occurrence identity
from the actual prepared frame and preserve native lock skipping before any
Locking resolution. It must never invent parent metadata or acquire/wait for
an external lock inside the database transaction.

Approved shared correction: admit only the exact native false marker, retain
trusted outer request replay, represent genuine native skip responses and
derive child parent identity in the existing finite runtime. Strict option
checks, ordinary compensation and standalone-root context remain unchanged.
Disposition: implemented in the existing finite definition, response and frame
owners. The facade invokes an actual native child; it supplies no parent marker.

The complete Cart DML also declares `cart_line_item_adjustment.amount >= 0`.
The new Cart metadata witness is refused by the shared compiled-check grammar,
which currently admits only null implications. Expected: preserve the native
nonnegative exact-numeric constraint in the schema and trusted storage owner.
Actual: `unsupportedProfile` at `tables[4].checks[0].expression`, before Cart
definition admission. Removing the check, pruning Adjustment metadata or
enforcing it only in the Cart adapter would lose the native schema contract.

Approved correction: add a neutral exact-numeric lower-bound check through the
existing relational schema, lowering, canonical physical plan and logical
validation owners. Preserve decimal precision, SQL null behavior, negative
refusal, pending writes, scope isolation and historical schema validation.
Neutral and genuine Cart cases require both database lanes. Disposition: the
neutral `numericLowerBound` contract retains a bounded canonical decimal
minimum, uses the existing exact decimal ordering and preserves SQL NULL.
The selected compiled grammar admits only the native quoted-column `>= 0`
expression. Schema admission, complete-row validation, canonical physical
planning, stored validation, SQL installation and cold catalog checks share
that contract. Existing physical local profiles admit this explicit check;
unsupported check families retain their refusal.

The next preserved native witness is collection-update preimage selection.
`getSelectsAndRelationsFromObjectArray` treats the native raw amount object as
relations and produces `amount.value`, `amount.precision` and relation `amount`.
The selected DAL refuses that unsupported relation; the pinned native DAL
instead drops unknown scalar projections, losing the previous amount. Expected:
select the numeric amount as one native scalar so compensation can retain it.
The existing helper already provides an `objectFields` option. A correction to
the native collection step to select `amount` through that option was approved.
Disposition: the step passes only `objectFields: ["amount"]` to its existing
selector helper. The pinned comparison source is unchanged; the focused source
guard rejects removal or expansion of this correction. Refresh and the genuine
retained inverse must establish the previous amount and currency on both drivers.

A further native inverse witness restores `9007199254740992` from the retained
DTO `{ amount: 9007199254740992, raw_amount: { value: "9007199254740993",
precision: 20 } }`. Expected: restore the exact retained amount. Actual: the
pinned inverse passes only `pc.amount`, discarding `pc.raw_amount`. This native
compensator correction was approved. Disposition: when `amount` was selected,
the native inverse prefers its exact retained `raw_amount`; when amount was
omitted, the inverse preserves omission. Strict storage encoding and native DTO
number presentation retain their existing owners and contracts.
