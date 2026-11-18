# Selected Application evidence in checked admission

Status: **first connected selected-evidence package implemented and measured.**
The owner approved the Application admission cost slice. The internal contract
and failure-order tests below govern the implemented package; this file
does not change the [accepted immediate selected-dependency integrity rule](../../design-notes/flarex-db-accepted-design.md#prepared-execution-integrity).
The completed [first low latency package](./06-low-latency-execution-preflight.md)
and its [traced and untraced records](../../packages/flarex-backend/benchmarks/mixed-mutation-core/admission-cost/README.md)
remain the comparison. No public activation, broader framework operation,
protected certificate, deadline increase, host lifecycle or durable journal
format change belongs to this package.

The [retained selected-evidence measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/selected-evidence/README.md)
show the bounded query reduction and unchanged transaction counts. The full
untraced endpoint comparison does not show an overall latency gain or meet the
proposed warm product budgets. Further latency work requires a new measured
owner decision; this package does not authorize a certificate, cross-transaction
cache, host change or new integrity boundary.

## Connected outcome and reason to act

Reduce repeated **target-database** Application selected-evidence dispatches
inside each short accepting transaction used by the private Application,
Product, Payload and finite workflow attempts. Preserve fresh source, scope,
placement, revocation, readiness, activation, publication and settlement
checks. The same existing Product, `posts`, Product/Pricing/Link/Tag and
standalone graphs remain the witnesses; this package must not branch on those
entity names. No SQL transaction crosses a Worker or native callback.

The candidate traced series completes 104/104 requests, yet its warm medians
remain **3,842 dispatches / 97 transaction intervals / 2.337 s request span**
for Product, **5,707 / 136 / 3.210 s** with Payload, and **10,410 / 235 /
6.755 s** for the mixed workflow. The standalone graph has **480 / 6 /
0.332 s** but lacks the mixed root obligations. The untraced candidate's mixed
outer wall median is **6.761 s**; its SQL counts are unavailable. Sequential
traced versus untraced outer wall comparisons do not make observer cost a
plausible dominant explanation for this workload, but are descriptive rather
than a causal calibration. The current physical catalog proof accounts for a
mixed warm median **224 dispatches / 286.4 ms** summed driver await; the next
owner is selected Application metadata, not another speculative GIN shortcut.
In the traced mixed warm path, normalized active-head and activation reads
occur about **679 and 676** times per request; publication and revision-schema
reads about **452 and 451** times. The Product hot path specifically reads
the **legacy** `fx_system_application_publication_v1` about **52** times and
`fx_system_application_revision_schema_v1 FOR SHARE` about **104** times per
request. The mixed warm sample reaches the legacy bundle about **210** times.
Its measured bundle owner is `ApplicationReadiness.reserveBundle`,
not the relation fold. Fingerprints identify repeated SQL, not which exact
call in a shared fingerprint is redundant; inspect the calling owner before
removing one.

## Current owners and exact boundaries

| Owner | Current behavior and package decision |
| --- | --- |
| [`applicationActivation.ts`](../../packages/persistence-postgres/src/application/applicationActivation.ts) | `validateApplicationBindingBasisInTransaction` reads the coherent active head `FOR SHARE`. In its stored relation-selection branch, `validateApplicationRelationActiveSelectionInTransaction` reads that head again before fresh readiness validation. Pass the already checked decoded head only within this branch and transaction; preparation and legacy paths retain their distinct checks. |
| [`applicationReadiness.ts`](../../packages/persistence-postgres/src/application/applicationReadiness.ts) | The measured legacy `reserveBundle` first locks/validates the scope clock and revision, then awaits candidate, analysis, publication V1, functions V1 and task evidence in order. This owner must change in the connected package; relation-only edits would leave the Product hot path unchanged. Preserve V1 frame/hash semantics. |
| [`applicationRelationReadinessFold.ts`](../../packages/persistence-postgres/src/application/relations/applicationRelationReadinessFold.ts) | The relation `loadBundle` has the analogous revision/candidate/analysis/publication/function/task sequence, but different publication format, readiness evidence and a planning profile. Migrate its accepting path without collapsing it into legacy semantics. |
| [`applicationTaskBindings.ts`](../../packages/persistence-postgres/src/application/tasks/applicationTaskBindings.ts) and [`applicationRelationTaskBindings.ts`](../../packages/persistence-postgres/src/application/relations/applicationRelationTaskBindings.ts) | Both task snapshot ports read a fresh scope clock, task catalog and bounded definitions, validating canonical task evidence. Retain that later clock SELECT and the catalog/definition locks and hashes. An earlier `KEY SHARE` clock lock does not exclude a non-key authority update. |
| [`applicationActiveHeadRead.ts`](../../packages/persistence-postgres/src/application/applicationActiveHeadRead.ts) and [`appUniqueConstraintSetBuildV1.ts`](../../packages/persistence-postgres/src/storage/unique/appUniqueConstraintSetBuildV1.ts) | `readApplicationActiveRevisionForShareInTransactionEffect` reads a coherent head plus revision schema; unique-build protection calls it at two sites. The duplicate fingerprint needs per-call attribution: these checks may protect separate maintenance decisions and cannot be removed merely because Application admission read a head elsewhere. |
| [`applicationBindingProjection.ts`](../../packages/persistence-postgres/src/application/applicationBindingProjection.ts) and [`frameworkSchema/binding/logicalSchema.ts`](../../packages/persistence-postgres/src/installation/frameworkSchema/binding/logicalSchema.ts) | The projection carries validated Application basis and analysis correlation. The logical-schema verifier compares that evidence against the binding, then performs separate logical-storage readiness; it does not itself re-read Application publication/schema. Keep these domains separate. |
| [`logicalDocuments/sourceAdmission.ts`](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts) and [`participantAdmission.ts`](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts) | The first source in a checked transaction performs the Application proof. The existing transaction-scoped `checkedBindings` shares binding candidate/readiness across selected sources with exact source/head checks. The journal's checked transaction authenticates attempt and clock, **not** an earlier Application proof. Do not add a second generic cache or claim root evidence can be borrowed from an earlier transaction. |
| [`atomicCommerce/admission.ts`](../../packages/persistence-postgres/src/frameworks/atomicCommerce/admission.ts), [`commerceTransaction/admission.ts`](../../packages/persistence-postgres/src/frameworks/commerceTransaction/admission.ts), [`cmsTransaction/admission.ts`](../../packages/persistence-postgres/src/frameworks/cmsTransaction/admission.ts), [`frameworkSchema/binding/host.ts`](../../packages/persistence-postgres/src/installation/frameworkSchema/binding/host.ts) | These existing compositions choose physical, logical, prepared and direct selections under their own checked transaction. Migrate any affected internal call to the common checked Application owner; preserve installation-before-Application and binding-before-business refusal order. A prior transaction's prepared or host result is never a fresh proof for a later attempt. |

The control database can differ from the located target database. A target
transaction does not make a separately queried control catalog atomic. Keep
existing placement and immutable publication/target activation correlation;
do not fuse control and target observations or claim a new cross-database
snapshot. Current `sourceAdmission` sharing ends with its checked callback;
it is not a cross-transaction authorization cache.

## Recommended connected change

1. Keep scope-clock/authority validation and the coherent active-head plus
   revision lock as the ordered first target reads. In the stored relation
   selection path, pass the decoded locked head through the existing
   Application activation owner to relation validation; recheck every
   activation and readiness dependency there. Avoid a new public token or
   callback-wide `WeakMap`. A check is reusable only before any operation
   that can mutate the verified metadata in that SQL transaction. Later
   checked operations and settlement perform their own fresh admission.
2. For legacy `reserveBundle` and relation `loadBundle` accepting paths, lock
   and validate the revision as a distinct statement, then load candidate,
   analysis and each owner's publication format by exact
   `(scope, revision-linked identity)` keys using bounded `LEFT JOIN`s.
   A missing row stays distinguishable from a malformed row; no `INNER JOIN`
   may turn corruption into absence. Validate returned rows in the existing
   revision → candidate → analysis/manifest → publication order, including
   canonical bytes and every digest. Keep function rows bounded by
   `manifest.functions.length + 1` (adding that bound to legacy where needed),
   and task catalog/definitions bounded by their stored count plus one, with
   their current locks and checks. Only
   combine those later reads if a concrete owner and refusal proof supports
   it. The planning and update-lock profiles remain explicit, not a silent
   fallback to the accepting read shape.
3. Retain the task snapshot's fresh clock SELECT. The earlier accepting clock
   may be locked only `FOR KEY SHARE`, which permits a non-key authority
   update before the task read; replacing the later SELECT with a structural
   supplied value would miss a committed generation/fence/epoch change.
   Verify the actual call graph for the repeated revision-schema and active
   head queries in unique-build protection before sharing anything; a matching
   normalized SQL fingerprint alone is not evidence of a duplicate proof.

Successful SQL row fetches retain the current domain validation and first
refusal order. A PostgreSQL statement failure while fetching joined rows
remains the existing `resourceFailure`, with retryability classified from the
actual SQL cause. The accepted contract does not guarantee that an earlier
corrupt row wins over a simultaneous later-table **SQL execution failure**.
The focused dual-fault witness exposed an existing classification defect in
both readiness statement boundaries: Drizzle wraps a driver SQLSTATE in
`DrizzleQueryError`, so a top-level-only code check called `40001`
nonretryable. This package unwraps that one known boundary for classification
only, retains the original cause, and proves `40001` retryable versus `42P01`
nonretryable on the joined read. It does not add a generic recursive error
walker or change other persistence owners.
PGlite and real PostgreSQL two-fault witnesses pin this distinction: an
earlier invalid candidate/analysis plus a later bad domain row returns the
earlier domain failure after a successful fetch; a joined statement error
retains typed resource-failure classification rather than becoming `notReady`
or `storedState`. If later joins change the observable domain order, split
the statement at that boundary. This is an
execution grouping detail, not permission to suppress a failure, drop a hash
or weaken synchronous unchanged-digest tamper refusal.

Reject a global generation or certificate shortcut without the writer,
privilege and repair proof required by the accepted design. Reject a cache
across transactions, calls, attempt fences, journal positions or mutable
callbacks. A single giant catalog query, a new generic registry, a second
settlement owner or a long transaction around native code would solve a
different problem and obscure the proven refusal/lock boundary. The
displaced duplicate head query and serial selected target reads are **replace**
items in this package. Existing independent logical readiness and planning
reads are **retain** items, with their real callers and fresh-check contracts.
No durable row/codec migration is proposed; internal checked-read signatures
may break and all selected callers must migrate in the same slice.

## Validation, count gate and completion

Prove PGlite and ordinary-role PostgreSQL for stored and prepared selections,
relation and policy readiness, active-head change between preparation and
acceptance, corrupt unchanged-digest publication/schema/function/task bytes,
missing and extra dependent rows, selected versus unselected source changes,
scope/placement/revocation changes, and concurrent activation. Test the
two-fault refusal cases above, SQL retryable versus nonretryable mapping,
lock order/deadlock behavior, and a before-read change that the actual
checked transaction must catch. A checked value must not survive a callback,
new transaction, other scope, attempt/fence or replay. Keep PGlite and real
PostgreSQL claims separate.

Then run real Worker Product success/retry, Payload create/update/find and
held-hook failure, finite workflow success/failure/cancel/replay, lost final
COMMIT and retained outcome recovery, plus a neutral extra definition/source
witness. No callback or SQL connection may remain open across a Worker/native
operation. Rerun affected typechecks, source guards and lint, and both project
diff reviews. Remove displaced per-caller reads/exports and obsolete tests
with replacement coverage; no compatibility wrapper is needed for a private
unshipped internal signature. Record any genuinely retained path with its
named caller and removal gate.

Use structural owner query-count witnesses for the exact checked-prefix path,
then a four-workload **traced smoke of 16 samples** (one warmup, two warm and
one cold per workload) to check full-path dispatch/transaction shape, trace
coverage and functional assertions. The provisional mixed smoke target is
the exact structural reduction of **two selected-metadata SELECTs per legacy
bundle** (candidate/analysis/publication from three statements to one).
At 210 observed bundles, the SQL assembly predicts about 420 fewer
dispatches. This is an attribution estimate, not a millisecond acceptance promise.
There must be no unexpected increase from the 235 transaction-interval
baseline. Attribute active-head, activation, revision/candidate/analysis/
publication and task fingerprints separately; two warm smoke points are a
directional screen, not a new percentile estimate. Product and Product-plus-
Payload should show the same per-checked-prefix direction, and standalone
should not gain unnecessary Application reads. Do not declare completion from
one helper's SQL count.

If correctness and smoke are sound, run the identical four-workload **full
104-sample untraced series** against the retained candidate untraced baseline:
warm outer wall medians **2.231 / 3.095 / 6.761 / 0.345 s** for Product,
Product-plus-Payload, mixed workflow and standalone respectively. Compare
fresh Worker construction, cold behavior, p95, retained inventory and
failures; the standalone warm p50 must not regress more than 10%. The full
untraced series has no SQL/phase observations, so its endpoint result and the
traced smoke answer different questions. A second full traced series needs a
concrete unresolved attribution gap, not routine duplication. This package
does not promise the 100 / 200 / 500 ms product budgets or native ORM parity.
If the coherent change cannot meet its count direction without crossing a
trust/refusal boundary, retain the safe checks and report the measured lower
bound before choosing the next owner. Preserve every earlier raw record and
store the new run under a new artifact identity.

## Measured outcome and next gate

The [retained artifact](../../packages/flarex-backend/benchmarks/mixed-mutation-core/selected-evidence/README.md)
contains the 16/16 traced smoke and 104/104 full untraced successful samples,
their manifests, exclusions and the separate no-sample `ENOSPC` setup note.
The mixed warm smoke made **9,958 dispatches and 235 transaction intervals**,
versus **10,410 and 235** in the prior traced candidate. Product and Product
plus Payload fell to **3,682** and **5,463** dispatches from **3,842** and
**5,707**, also with unchanged transaction counts. Standalone fell to **470**
from **480**. The mixed reduction of **452** corresponds to 226 measured legacy
selected bundles at two fewer statements each; the earlier 210-bundle estimate
was directional. The relation owner and active binding projection are covered
by focused structural and behavioral tests rather than this legacy-heavy
benchmark graph. The task-clock SELECT remains fresh after the rejected
`KEY SHARE` reuse hypothesis.

The full untraced warm outer medians are **2.271 / 3.303 / 6.699 / 0.338 s**
for Product, Product plus Payload, mixed and standalone, against prior untraced
**2.231 / 3.095 / 6.761 / 0.345 s**. This is a material SQL count reduction
without an overall endpoint gain. Standalone passes the less-than-10% warm
p50 regression gate; the proposed mixed warm latency budgets remain unmet.
The two full untraced series ran sequentially, so their wall differences do
not isolate this package's CPU, scheduling or cache contribution. The next
connected latency decision needs evidence from a dominant remaining owner,
including CPU/hash/allocation and database wait or lock cost where relevant;
no additional metadata cache or broader transaction grouping is inferred from
these counts alone.
