# Checked operation composition for finite mixed roots

Status: **delivered bounded private composition; latency target unmet.**
This preflight scopes the next private latency package after the delivered
[finite-root redesign](./08-fundamental-latency-redesign-preflight.md). It does
not activate a named environment or broaden the admitted framework graph.
The [accepted database design](../../design-notes/flarex-db-accepted-design.md)
continues to own Postgres authority and the protected metadata guard.

## Connected outcome and measured reason

Keep the existing Product update, Product plus Payload Local API, finite
Product/Pricing/Link/Tag workflow, and separately settling standalone workflow
graphs unchanged. Compose **trusted preparation before a native callback** so
source or bundle verification, working-set construction, and bounded pending
hydration can use one short checked transaction where their exact authority
and failure order agree. For a proven pure read whose inputs are already
primitive or owner-canonicalized, perform its leading admission and historical
read in the same checked transaction. Close every such transaction before
entering a framework service, hook, workflow callback, sandbox continuation,
or other untrusted code. Every later operation still obtains fresh authority.

The retained [finite-root measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/fundamental-latency/finite-root/README.md)
have full untraced warm outer p50 of **1,758.7 / 2,420.2 / 5,284.0 /
342.7 ms** for the four graphs. The clean traced smoke records **2,748 /
3,802 / 7,228 / 470** SQL dispatches and **85 / 112 / 205 / 6** transaction
intervals per warm request. The proposed mixed warm p50 targets of 100 / 200 /
500 ms remain unmet. The trace shows repeated checked work in Product update
and workflow operations; it does not attribute every interval to a specific
function or establish server execution, lock wait, or WAL cost. This slice
tests whether composing known adjacent checks reduces actual transaction and
dispatch counts without weakening the authority contract, then measures the
same end-to-end request boundary. It does not promise the product targets.

## Baseline owners and challenged alternatives

At approval, the [participant admission owner](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts)
opened a checked transaction and verified the source or ordered bundle before
returning control to its `work` callback. Its leading read executed an empty
body. [Relational admission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalAdmission.ts)
delegated to that owner. Borrowed [Product](../../packages/persistence-postgres/src/frameworks/commerceTransaction/borrowedLogicalAttempt.ts),
[workflow](../../packages/persistence-postgres/src/frameworks/commerceTransaction/borrowedWorkflowAttempt.ts),
and [Payload](../../packages/persistence-postgres/src/frameworks/cmsTransaction/borrowedLogicalAttempt.ts)
constructed framework-local lifetimes and working sets after admission. The
[working set](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts)
performed another construction admission and, for ordinary operations, a fresh
`runOperation` admission before later `runRead` historical I/O. Relational
table-handle acquisition was also a checked operation.
[Source admission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts)
already shares selected binding evidence when checks run inside one
transaction; reuse this owner instead of adding another evidence cache.

- Do not remove the leading check and trust a local token or previously
  prepared metadata. A preparation is not a live admission verdict. Every
  checked transaction must verify the exact attempt, scope, placement,
  source/bundle, generation, revocation, readiness, claim, fence, and journal
  position that its current path requires, then retain the protected metadata
  guard at the transaction tail.
- Do not hold SQL open across a Product/Payload method, hook, workflow step,
  sandbox call, or asynchronous external work. A generic ambient transaction
  context or cached checked-read closure could escape the preparation phase
  and change later call semantics. The preparation transaction must end
  before a facade capable of later operations is returned.
- Do not fuse every read mechanically. Some unknown-input methods run
  `capturePrivateJsonData`, framework validation, or user-controlled Proxy
  traps **after** fresh admission. Capturing first changes refusal order;
  capturing inside SQL executes foreign code while a transaction is open.
  Keep separate checked reads for those paths unless their owner proves a
  bounded, already-canonicalized input and unchanged first-failure order.
  Pure point/primitive paths are candidates, not blanket authorization.
- Do not move this cost to a framework adapter, skip a later state-only or
  cached-result check, batch unrelated source rights, widen limits, or add a
  second transaction or fallback profile. A new query shape alone does not
  address the identified adjacent checked boundaries.

## Implementation checkpoint

The selected Product and Payload borrow paths now construct their working sets
inside the participant owner's checked preparation transaction. The workflow
keeps its ordered per-member admission and raw source validation before a
separate checked bundle transaction constructs its shared working set. The
constructor hydrates bounded pending bases through the supplied transaction;
its returned facade retains only the ordinary checked-read function. The
finite journal's ordered source checks reuse selected binding evidence within
one transaction. These changes remove the redundant construction check at
those composed boundaries while preserving later live admission.

Borrowed primitive `get` now uses one checked transaction for admission and
an uncached exact historical row read. A cached positive or negative result
still makes a fresh checked call. Input paths that can run foreign capture or
validation retain their earlier admission and separate I/O. The required
proof includes present revision and missing-point evidence, authority-first
refusal before Proxy traps, and no SQL transaction held while those traps run.
Connected consumer, final-guard, cancellation, type, lint, and reviewer
validation close this bounded implementation gate. The former optional
Product borrowed-attempt resource override had no live caller and was removed:
the owner-selected defaults keep request configuration getters out of checked
preparation SQL. The admission callback shape was replaced and its Product,
Payload, and workflow callers migrated together. No schema, durable format,
or public contract required coexistence or data conversion.

## Measured outcome and next owner

The [retained quiet trace and full distribution](../../packages/flarex-backend/benchmarks/mixed-mutation-core/checked-operation-composition/README.md)
use the same four graphs and local host as the finite-root comparison. The
two warm trace samples per graph each record SQL dispatches of **2,646 /
3,564 / 6,976 / 470** and checked transaction intervals of **82 / 105 / 199 /
6**, versus **2,748 / 3,802 / 7,228 / 470** and **85 / 112 / 205 / 6** before
this slice. Full untraced warm p50 is **1,849.5 / 2,264.6 / 4,847.1 / 318.4
ms**; Product rises from 1,758.7 ms even though its structural counts fall.
Fresh Worker construction time also rose in Product, but these records do not
establish a cause. The 100 / 200 / 500 ms mixed warm p50 goals and their p95
goals remain unmet. The standalone ceiling and regression gate hold. This
private result is not hosted Cloudflare, native ORM parity, or capacity proof.

Repeated live admission and exact read work is the next connected cost owner:
the Product update trace still has 49 transaction intervals, and the workflow
run phase 94. The phase totals do not identify individual function cost or
license caching an authority verdict, skipping a fresh check, or keeping SQL
open across a framework callback. Server execution, lock wait, WAL,
contention/retry latency, and larger or neutral graphs remain unmeasured.
The preparation cleanup-tail regression exercises a mocked uncertain tail;
a real preparation transaction final-guard or COMMIT fault injection was not
added in this slice. The existing aggregate-seal recovery authority is
unchanged.

## Contract, cutover, and limits

The neutral admission owner may expose a narrow checked preparation callback
that passes only the current transaction and authenticated source state to
trusted work. Its bundle variant must preserve the existing source order and
first refusal. A selected consumer can build its working set and hydrate the
bounded snapshot/pending base during that callback, then return an inert
facade whose future methods open their own checked transactions. No live
transaction, closure capturing that transaction, authority verdict, or
SQL-bound framework manager leaves the callback. Exact final-guard failure
rolls back preparation and returns the
same typed owner failure. A failed or interrupted provisional child still
poisons its finite root according to the current journal/lifetime contract;
defects and interruption are not converted to catchable validation failures.

For an eligible pure read, the same checked transaction may perform ordered
admission and the historical read, recording the same positive, missing,
predicate, frontier, index/page/search, and pending-overlay evidence. The
operation still charges existing per-call and root-wide limits. If decoding,
validation, a new source check, or separate I/O intervenes, end that
transaction and retain the next fresh check. A cached row or table handle does
not authorize a later observable operation. Final aggregate seal,
relation-conflict terminalization, publication, and protected metadata guard
stay with their current owners.

This is an **internal execution-contract replacement** for the selected finite
mixed callers. Extend the neutral participant admission and working-set
owners, migrate the three borrowed consumer constructions together, and
remove displaced leading empty transactions and superseded internal callback
shapes in the same slice. The [same-transaction source binding
check](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts)
is retained and reused. Existing `durableOperations` roots, independently
settling native Application/Medusa/Payload commands, and public framework
contracts are retained for their named callers; they are not silently
reinterpreted as finite or routed through a new generic transaction API.
There is no schema or migration change, durable journal/receipt/commit format
change, public API, host-lifetime decision, additional framework method, or
new metadata coverage in this package. Any such need returns for a materially
different scope decision. There is no named durable-data conversion: the
selected finite root keeps its current format and recovery authority.

## Connected proof and measurement gate

The implementation traced each selected call from bundle/source admission through
working-set construction, pending hydration, first native invocation, and
subsequent reads. Record the exact old and proposed order of token, binding,
limit, validation, row-hydration, and callback failures. Identify at least one
pure read with inputs that cannot invoke foreign getters/proxies before or
inside SQL; keep other reads separate. The implementation should not add an
abstraction until that call graph demonstrates one shared owner.

Focused PGlite and ordinary-role PostgreSQL witnesses must cover the full
Product, Payload, and finite workflow graph and the standalone regression
profile. Assert exact pending and missing read evidence, duplicate base reads,
source/bundle order, scope/fence mismatch, generation or source revocation
between preparation and a later operation, a cached/state-only call's fresh
refusal, and protected-epoch change or contention at the transaction tail.
Inject invalid authority alongside malformed or Proxy-backed input to prove
the established first failure occurs without executing foreign capture in
SQL. Hold a native callback, nested Payload hook, and cancellation point while
observing zero SQL transactions across them; a preparation interruption must
leave no committed child outcome or reusable capability. Retain OCC retry,
lost-final-COMMIT recovery, root poison, limits, and publication behavior.
Validate affected persistence, executor, backend, Medusa and Payload types;
run focused owner/consumer tests, lint core/diff, and both standing reviewers
against the final changed checkpoint.

Use the same four graphs, fresh Worker lifecycle, local ordinary-role
PostgreSQL host, restricted runtime policy, and report/source-hash inventory.
First run a quiet matched traced smoke to count checked transactions and SQL
dispatches in the eligible phases, verify trace coverage, and check the
standalone path. Require a real count reduction at the selected composed
boundaries without a compensating extra check elsewhere; document the exact
removed boundaries rather than inferring them from totals. If claiming an
endpoint gain or deciding the existing warm latency acceptance question, run
the full 104-sample untraced distribution and report warm p50/descriptive
p95, cold p50, retained rows/events/journal bytes, and setup/host costs against
the finite-root baseline above. Keep all samples and exclusions. A smoke alone
supports a structural conclusion, not a warm percentile or target claim.
Keep the prior standalone less-than-10% warm p50 regression rule and the
unchanged mixed business assertions; report any failure or regression rather
than manufacturing a gain by excluding work from the request interval.
