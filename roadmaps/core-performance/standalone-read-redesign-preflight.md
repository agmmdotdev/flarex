# Standalone Read Execution And Installation Lifecycle

Status: **local implementation and consumer cutover complete; measured latency accepted for now.** The owner selected a substantial replacement of the complete read
path during early development. This preflight owns the connected outcome and
acceptance gates. It supersedes planning-only/deferred labels for this named
scope in the earlier handoff. The managed transaction, installation interlock
and query-required preparation are implemented. The connected local correctness,
installation and consumer cutover is complete. The owner accepted the current
measured latency and asked to wrap up before discussing further work. The full
latency/scaling targets below remain unproven performance acceptance criteria;
they are deferred by that stopping decision, not claimed as achieved. No further
latency tuning or capability expansion belongs to this checkpoint.

The [execution architecture refactor](../execution-architecture/README.md) now
owns direct read construction and source organization. Its explicit Commerce/CMS
read capabilities reuse this draft's managed transaction and installation
mechanics. Its connected cutover includes the view-source publication correction,
retained native installer migration and removal of displaced private construction.

### Read Metadata Publication For View Sources

Status: **corrected in shared metadata publication.** The admitted
schema contract permits Payload read-only views over existing logical tables.
These sources have view bindings and introduce no table definitions.
`publishLogicalReadMetadata` preserves their candidate evidence while omitting
definition-serving projections for view-only sources. Sources with definitions
still publish those definitions; missing definitions without a valid view remain
corruption. Installation backfill uses this same publisher.

The `schemaComposition.test.ts` witness retains the real composed sources and
checks exact projection membership plus idempotent backfill on PGlite and
ordinary-role PostgreSQL. Runtime view serving remains subject to its existing
admission gate; accepting a view in the schema does not issue table-serving
authority for it.

## Outcome And Boundary

Make the real standalone Product scalar and selected collection retrieval run
with low single-digit millisecond complete warm latency in the controlled
database-adjacent lane. Replace repeated immutable construction, source-wide
serving readiness and per-request structural catalog attestation together.
Do not declare success for a smaller helper, a lower SQL count, or a percentage
improvement that still misses the complete-request gates below.

Use the existing CommerceHost native Product method and real repository seam.
Shared preparation/readiness owners must remain usable by Application, Commerce
and CMS. Inventory and migrate every standalone reader actually affected by an
owner replacement; exercise genuine Payload Local API access/visibility where
affected. Do not add a Product-only shortcut or another readiness engine.
Ordinary mutations, finite mixed execution, durable operations, publication and
finish-only recovery retain their real contracts; this slice does not replace
their settlement. It does include the installation lifecycle interlock needed
to protect all users of the same structures during maintenance.

Existing private interfaces, metadata layout, codecs and construction lifetimes
may change coherently. Preserve supported native behavior, tenant isolation,
snapshot semantics and actual durable data. No public API expansion, arbitrary
workflow support, Worker pooling, new compute provider, general schema-evolution
platform or silent data reset belongs to this slice.

## Why This Is A Replacement

The recorded native ledger measures scalar median/P95 1.5369/2.1463 ms versus
Flarex 52.98275/66.3527 ms, and collection 1.6499/2.134 ms versus
47.83545/53.2059 ms. Warm protocol counts are one native query versus 63/65
Flarex dispatches across three transactions. These are historical observations,
not a new baseline or evidence for hosted latency. See the
[native ledger](../../packages/medusa-adapter/benchmarks/core-performance/native-retrieval/README.md#fresh-application-acceptance).

Required guarantees are authoritative current access, immutable metadata
authenticity, query-complete serving eligibility, one consistent read snapshot,
native results/errors, bounded resources and safe release. Whole-source
traversals, catalog/body hashing on each request, per-request metadata factories
and current helper boundaries are replaceable mechanisms.

## Selected Execution Graph

### Managed placement boundary

The managed standalone profile requires installer-authenticated control and
target namespaces in one PostgreSQL database. A construction-time capability
must prove both protected incarnations through the actual accepting credential;
matching database names, locator labels, pool objects or namespace OIDs alone
are insufficient. The accepting role gets only the required control reads and
bounded lock-function execution, with inherited mutation privileges denied.

The accepting transaction checks and retains current control placement and its
ready provisioning receipt before native execution, alongside target clock,
revocation and binding heads. Both installations are admitted before those
locks. Both original metadata epochs remain final guards in the same transaction.
This moves fresh placement resolution into the accepting transaction; it does
not cache placement or assume an old target is fenced. Qualified control reads
must preserve the target search path. No callback is retried after execution.

This is a private construction-contract break for managed Commerce/CMS hosts,
their fixtures and the native benchmark. Existing separate-database consumers
retain their explicit full-proof profile until a separately proved distributed
placement contract exists. Composite construction fails closed without fallback.
Installation is additive and preserves committed data. Cutover requires actual
role/namespace authentication, placement and epoch races, maintenance draining,
native parity and the complete performance gates below.

1. Capture foreign inputs and perform native normalization at their existing
   owners. Derive trusted storage demand from actual projection, predicates,
   ordering, selected access paths and population work.
2. Obtain authenticated immutable preparation from the existing bounded host
   owner. A miss loads/compiles the required versioned metadata; it does not
   reinstall or reattest the database. No result data or live access verdict is
   cached. Installation/deployment construction is separately charged.
3. Enter one short accepting transaction for the measured bounded read. Check
   the actual installation, scope/placement, active revision/binding, caller and
   method, revocation and required mutable serving state. Read the actual rows
   under the original snapshot contract and complete the required final guard.
4. Release the complete native result only after successful transaction
   completion and owned cleanup. Preserve body-first failure and interruption.

The bounded entry query uses a named PostgreSQL statement whose identity derives
from its complete SQL shape. Every execution still binds the expected installation
identities and reads current database state in the accepting transaction. A new
connection must parse the statement again; retaining a server plan never retains
an admission result. Query parameters and transaction ownership remain unchanged.

Native service classes are prepared once at the existing module-definition
owner, after static validation. Each request binds a fresh repository, persistence
adapter, service instance and event subscriber. ProductImage preparation belongs
to its Product definition. No process-global service or request context is shared.

The committed unique lookup may carry the exact current revision already joined
by its slot-authentication query. The row owner supplies the existing bounded
projection and canonical decoder; decoding remains lazy until the working set
has checked table identity, readiness and prior dependencies. Existing historical
and pending-publication reads keep their owners. This removes a duplicate row
lookup without replacing snapshot dependencies or local working-set state.

Target at most two bounded platform guard submissions within that transaction,
alongside genuine business storage demands and transaction/session commands.
The warm hit performs no preparatory control-database transaction, no structural
pg_catalog sweep and no full-source enumeration. Count all contained database
work; a stored function containing the old proof loop is not this replacement.

This is not a universal one-query promise. Dynamic dependent native reads must
derive and check their additional demand. Preserve the actual standalone
snapshot/lifetime; do not silently split one snapshot into unrelated reads.
Only the currently admitted bounded trusted native code may retain its existing
short SQL lifetime. User hooks, getters and untrusted callbacks remain outside
SQL. A consumer needing a different lifetime must be migrated explicitly or
retain its named current profile, not receive a silent fallback.

## Installation Integrity: Move The Proof To Its Real Owner

Select managed installation integrity as the trust contract. The installer and
database owner/provider administrators are trusted. Runtime/tenant credentials
cannot alter roles/grants, protected schemas/functions/triggers, replication
mode, installation identity or the maintenance gate. Enforce this with actual
database permissions and constrained writer interfaces, not naming conventions.
Schema-qualified objects and a safe search path are mandatory.

Full structural verification runs at installation, restoration and controlled
structural change. It includes the omitted role/catalog/function/grant/trigger
predicates. The installation owner publishes an authenticated active incarnation
and structural generation. A host capability references that installed fact;
neither a signature, matching digest nor a JavaScript pool object proves it.
Do not relocate full verification to each request, new Worker or pooled session.

Implement a separate installation maintenance gate through the current protected
metadata/installation owners. Do not repurpose the frequently updated global
metadata epoch as an entry SHARE lock: that changes existing clock/head/epoch
lock order and can deadlock metadata writers. The initial correctness model is
a dedicated installation row, shared by accepting transactions and exclusively
locked for structural maintenance; its tuple contention is an acceptance risk,
not an assumed free operation. An equivalent transaction-scoped latch is allowed
only after proving the same snapshot, writer and recovery interlock.

- Acquire the installation gate before other affected locks and retain it only
  through the bounded SQL transaction. Authenticate active state and the exact
  original incarnation/generation from the actual target. Under repeatable read,
  a changed gate row must refuse/retry through the existing bounded owner;
  an advisory lock alone does not refresh a stale snapshot.
- Managed maintenance obtains exclusive admission, drains prior users, commits
  a durable `draining` state before nontransactional work, performs the change,
  rotates the relevant generation, verifies, then reopens. A crash stays closed.
  Competing maintenance jobs require an exact fenced owner. Before takeover can
  verify or reopen, it must cancel/drain predecessor sessions and commands or
  otherwise prove they cannot perform further structural work. Lease expiry or
  a generation check alone does not fence an in-flight concurrent DDL operation.
  An old job cannot alter structure after the successor's verification or reopen
  a newer generation; uncertain predecessor settlement keeps service draining.
  Transactional changes may use one atomic transition.
- Inventory all active read/write/recovery/build users of the shared installation
  and make their admission compatible with this interlock before removing scans.
  Old full-proof profiles retain their predicates, but cannot bypass structural
  maintenance quiescence. Never hold the installation gate across callbacks.
- Ordinary metadata DML retains same-transaction invalidation or publishes a new
  immutable version. Retain existing 23-table invalidation and the compact final
  metadata epoch fence until each actual writer has a proved replacement. No
  unchanged-epoch assertion certifies privileged DDL or unrelated control data.
- Privileged changes outside the managed protocol are outside this guarantee;
  service must be stopped and the installation reverified before resuming. Do
  not claim protection against a superuser who can replace the gate itself.

The installer, migrator, activation, catalog publisher, physical index builder,
GC/delete, repair/reset, restore, role/grant and alternate-pool owners must have
a concrete credential and writer inventory before the scans are removed. Normal
data/build-progress updates keep their own transactional ownership; they do not
trigger full installation reattestation unless they change protected structure.
An uncovered writer blocks cutover, not permission to weaken validation.

## Preparation, Pooling And Authority

Extend `PreparedHostRuntime` and its existing issuer-private bounded leases,
capacity accounting and close/drain behavior. Reuse within an actual supported
host/service lifetime; do not assume Worker instances persist. Cold instances
load authenticated query-required metadata from an installed version without
repeating global construction. Bound cache bytes/entries, concurrent preparation,
eviction, cancellation and release. Cache misses remain on the measured path.

Keys bind installation/endpoint credential policy, scope/placement provenance,
source/schema/revision and normalized query mechanics. Parameter values and
principals are request-local unless they change the plan; never share access
results. The existing trusted compiler must derive the complete dependency
closure. Authentication happens when immutable bytes enter the host; mutable
native output cannot alias shared preparation. Publish indexed versioned
requirements through existing metadata owners where needed, instead of loading
the complete source artifact for every cold query.

Every actual transaction checks its target identity and current authority. A
pool, cached PID, database name, OID or prior session attestation is insufficient.
Transaction pooling may change the underlying connection. Use transaction-local
state or qualified SQL; retain cache-disabled Hyperdrive. Restore/clone and
endpoint policy changes require incarnation rotation before service. Connection
loss or unexpected identity never reuses a live verdict.

Control and target remain separate authorities. Authenticate immutable control
artifacts and validate their matching target activation reference; no joint
snapshot is implied. Placement cutover must fence the old target, not merely
update a control record while old serving remains possible. Stale preparation
refuses the attempt. Bounded reprepare is allowed only before native work begins,
is explicitly charged, and cannot silently rerun callbacks or rebase an epoch.

## Query-Required Readiness And Behavior Changes

Derive the required closure at the existing trusted query/storage owners: root
and predicate/order/page membership, chosen access path, populated targets and
their visibility, required search/unique/index definitions and live coverage.
Do not follow every strong-reference/delete edge or inspect every definition
merely because it belongs to the source. A uniqueness rule needed for write
maintenance is not automatically a read dependency. Relevant dynamic reads add
their own authenticated requirements; unknown or incomplete demand fails closed.

Selected read-only callers may succeed when an unrelated definition is unready.
Required-path damage still refuses. Global activation, write constraints and
publication remain independently complete. Full installation/catalog corruption
is detected at its managed lifecycle boundary; this deliberately replaces the
old per-request arbitrary structural-change detection timing. Tenant access,
current revocation, data visibility, native DTO/error semantics and supported
snapshot consistency are not weakened. Only claims/leases genuinely belonging
to the profile are checked; standalone reads gain no synthetic mutation journal.

### Selected Catalog Lookup

The immutable access projection is compiled by the existing logical catalog
publisher after complete source admission. General index and unique selection
uses sparse sorted field-set trie nodes in the same protected table. Each
recursive step probes the full primary key for a field supplied by the query;
it never enumerates unrelated children. Exact terminal keys preserve the
existing longest-prefix and first-declaration rules. Equality, last-field plain
ranges, ordered point prefixes, membership predicates and null-distinct unique
keys retain separate eligibility facts before equivalent facts are collapsed.
The existing selector still compiles the chosen physical bounds.

Native scalar, key, reverse and ordered-point eligibility and page selection
use exact primary-key probes. These facts come from the existing compiler's
validated demand and preserve its predicate order and limits. Invalid native
predicates fail before access metadata acquisition. Readiness checks only the
actual chosen storage primitive; full-proof initialization, writes, activation
and finite callers retain their complete closure.

Text search retains every semantically distinct candidate and the original
first declaration containing all requested fields. Its protected catalog has
a partial GIN index over deployment/schema/source/table identity and declared
fields. JSON search retains its exact column and null predicate. Search does
not gain a new supported-source limit or a power-set projection. Posting-list
intersection and relevant overlapping candidates can still cost work; positive
and negative plans must measure that work. Trie work likewise grows with
genuinely matching demand signatures rather than unrelated catalog siblings.
The acceptance evidence must report fetched and decoded definitions, exact
negative probes and timing across irrelevant and relevant growth, rather than
claim universal constant-time set intersection.

## Connected Owners And Removal

| Existing owner | Required change and retained callers |
| --- | --- |
| `preparedMetadataEpoch.ts`, installation migrations and writer owners | Separate installation integrity from metadata invalidation; implement maintenance and compact fresh guards. Retain existing epoch coverage for its actual callers. |
| `preparedHostRuntime.ts`, `applicationActivation.ts`, `applicationReadiness.ts` | Reuse immutable preparation under a real bounded lifetime; remove selected readers' repeated binding/canonical construction and structural attestation. Keep live authority. |
| `logicalStorageReadiness.ts`, `logicalStorageDefinitions.ts`, query compilers | Replace selected read source-wide closure with trusted query-required requirements and indexed immutable preparation. Retain full readiness for named write/activation/finite callers. |
| `logicalDocuments/sourceAdmission.ts`, `relationalAdmission.ts` | Replace selected `withTransactionBinding` full-read assembly with demand-specific serving admission and a transaction-owned completion guard. No adapter cache or second validator. |
| Commerce/CMS hosts and actual native adapter consumers | Migrate the real standalone calls, including `prepareApplicationBindingSelection` at each Commerce attempt. Preserve native normalization, Local API/access and snapshot/lifetime contracts. |
| Benchmark and connected tests | Assert behavior, races and complete cost; delete obsolete implementation-shape expectations. Keep old results as historical evidence. |

Inventory every changed export/caller and any needed schema migration. Retained
full-proof paths need named initialization/write/finite/durable consumers; no
compatibility wrapper or dual engine is retained merely for unshipped internals.
Data conversion/destruction is not authorized. New gate/metadata installation
must be additive or have an explicit non-destructive migration and quiescent
cutover. This is one connected implementation slice, not independently accepted
factory, SQL-batching and cache slices.

## Performance Acceptance

The owner accepts the currently measured standalone-read latency for this draft
checkpoint. The original targets below remain the recorded engineering goals
for a future performance discussion; missing them no longer requires another
optimization in this checkpoint. This decision does not establish hosted
latency, close the unrun scaling/concurrency matrix or waive correctness and
independent review. Exact measurements belong to the native-retrieval ledger.

These are selected engineering gates, not measured feasibility or global network
latency promises. Both lanes use the same pinned native operation, seed, DTO,
connection placement, concurrency and declared lifecycle. Measure full request
entry through output and owned cleanup, including actual authentication,
preparation, guards, native work and necessary generic history work.

| Warm connection + preparation-hit lane, scalar and selected collection | Median | P95 |
| --- | ---: | ---: |
| Paired complete-request Flarex minus native duration | <= 2 ms | <= 5 ms |
| Complete Flarex request | <= 5 ms | <= 10 ms |

Compute each alternating pair's excess first, then its distribution; do not
subtract aggregate percentiles. These gates replace the 400 ms guardrail for
accepting this slice. No target is relaxed after a failed run. A feasibility
failure identifies the responsible owner and triggers redesign of that owner;
it does not turn a dispatch reduction into success.

Use five declared warmups and 100 retained quiet pairs per scalar/collection
warm-hit, cold-preparation/miss and matched-new-connection cell. Cold/miss and
reconnect reset the equivalent lifecycle in both lanes; setup inside the request
stays charged. Do not compare a cold Flarex client with a retained native client.
Report cold/miss/new-connection distributions and require no complete-request
median/P95 regression against their matched pre-change Flarex baseline; if an
equivalent baseline cannot be captured, that gate is explicitly unproven.
Do not require whole-schema canonical verification on a post-installation miss.
Report installation cost and amortized totals at 1/10/100 requests separately.

Independently vary unrelated same-source tables, indexes, relations outside the
required closure and other sources at 1x/100x, holding actual demand fixed.
Warm proof rows/definitions, checking transactions and dispatches must not grow;
median/P95 growth must be <= 0.5/1 ms. Post-installation cold preparation must
fetch/compile only required definitions; its separately charged miss timing
growth must be <= 2/5 ms. Provisioning may grow with schema size and is reported.
Run one 1/10/100 relevant row/relation demand series to reject per-row repeated
admission while charging necessary business growth. Also test actual unrelated
metadata updates: epoch invalidation may cause an explicit miss, never silently
reuse stale preparation; report its rate/cost separately from static growth.

Test the installed gate at concurrency 1 and 8 for same/different scopes;
require no throughput regression and no P95 regression against the matched old
Flarex path. Preserve ordinary metadata writer progress and demonstrate bounded
maintenance drain. A single global latch bottleneck or deadlock fails this gate.
Count actual protocol exchanges independently of SQL submissions. Use one
structural/server diagnostic per demand initially; expand only to resolve a
concrete failure, not to create another open-ended profiling project.

## Correctness, Delivery And Handoff

Use focused PGlite and ordinary-role PostgreSQL for forged/incomplete demand,
missing/tombstone/native-error parity, required versus unrelated damage,
revocation/head/version/placement changes, invalidation during a request,
reconnect/restore, eviction/close, and interruption/cleanup. PostgreSQL must
exercise distinct-connection maintenance races, stale repeatable-read snapshots,
all writer lock orders, ordinary-role bypass denial, maintenance crash/fence
recovery including late predecessor DDL completion, and final-result withholding.
PGlite does not certify permissions or
pooling. Do not start irreversible native work before fresh acceptance.

Deliver in dependency order inside this one slice: installer/writer and lease
contract, trusted query requirements and preparation, transaction/consumer
cutover, then native latency/scaling and affected connected regressions. Review
code and invariants during implementation; final TypeScript and systems reviews,
cleanup and a scoped commit are required. Run one existing full mixed milestone
because shared lifecycle owners change; this is not a promise that mixed latency
already meets its separate goals. Hosted claims require their actual transport
evidence; local success is explicitly local.

The committed documentation handoff is the implementation starting point. The
shared checkout's archived publication candidate is performance-rejected and is
not included. Preserve its source/evidence separately; do not revert others'
work, absorb its accepted-design edits or resume its withdrawn experiment.

### Source And Compatibility Notes

The pinned Convex database sources `crates/database/src/transaction.rs` and
`snapshot_manager.rs` in the enclosing source checkout were inspected: read
tokens bind their read set to a beginning timestamp, and snapshots carry schema,
table and index registries. Preserve those snapshot/dependency semantics. They
do not establish a Flarex/Postgres protection implementation or latency bound.

Primary constraints: [PostgreSQL row locking](https://www.postgresql.org/docs/17/explicit-locking.html),
[schema/search-path trust](https://www.postgresql.org/docs/18/ddl-schemas.html),
and [Hyperdrive transaction pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/).
Use the actual configured Postgres/runtime versions during implementation.

### Retained Physical Fixture Installation Under Maintenance

Status: **implemented; current native consumers and failure witnesses migrated.**
Commerce, Payload preferences, DataBinding, relational transactions and native
text-set fixtures use the fixed maintenance operation. The ordinary pooled native
installer is removed. Its relevant atomicity, cancellation, uncertain-outcome,
guard-integrity and process-reconstruction proofs use the fixed operation;
historical migration/data-preservation tests remain explicit.

The existing generated Commerce physical-profile fixture and Payload preference
fixture remain named consumers of canonical framework installation evidence.
Their physical readers and authenticated receipts remain until those consumers
move through the recorded generic-storage retirement gates. This retention does
not activate general framework schema evolution or an alternate serving engine.

The retained native installer must join the installed namespace's maintenance
owner. Installation is limited to one exact database and namespace on the
owner's dedicated, non-reconnecting PostgreSQL Client. The maintenance owner
acquires its exclusive owner and admission gates, durably drains the namespace,
and fences every command by the same backend identity and installation
generation. Consumer code receives the fixed physical-profile operation; it
receives no raw Client, database, maintenance handle, or arbitrary SQL callback.
The operation reuses the actual framework coordinator's canonical plans,
fencing, receipts and recovery behavior.

The dedicated connection has a ten-second maximum startup timeout, including
when the caller omits a timeout or supplies zero. A valid tighter timeout remains
effective. The owner retains socket closure and the original foreign failure;
the SQL timeout begins only after connection establishment.

New physical tables receive the installed admission triggers before reopening.
The owner also invokes the canonical installer's physical verifier on fresh
completion and durable replay. Changed constraints refuse reopen even when the
stored receipt graph is valid. The owner then verifies the complete protected relation inventory, original
framework protection predicates, runtime permissions and metadata protection.
Publication reopens only after this verification succeeds. A failed or crashed
predecessor cannot publish a successor's generation or complete late DDL through
another connection. Ordinary runtime framework DDL remains fail closed against
an installed namespace.

Static fixture DDL is not a substitute for canonical installation evidence:
the current installer rejects unreceipted structures and DataBinding consumes
authenticated availability and readiness. Historical core clones, gate bypasses,
forged receipts and fallback installers are excluded. The current retained
native driver contract changes to accept only the trusted maintenance execution
profile for this fixed operation; its affected Commerce and Payload fixtures
must migrate together. Durable data and existing receipts are preserved.

Validation must exercise the actual physical fixture consumers, ordinary-role
refusal before work, new-table admission and permission coverage, drain and
crash recovery, predecessor fencing, and verified reopen. The fast driver lane
retains its existing canonical coordinator tests; real PostgreSQL establishes
the dedicated-session and permission guarantees. Cleanup removes displaced
fixture construction and any unused ordinary native DDL entry after its named
callers migrate.
