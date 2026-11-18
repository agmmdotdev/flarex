# Execution Checks And Framework Lifecycles

Status: **selected direction adopted by the finite foundation; whole-mutation
replacement is under final validation and numerical acceptance remains open.**
The delivered [finite execution contract](./23-finite-execution-contract-preflight.md)
and selected [whole mutation replacement](./24-whole-mutation-redesign-preflight.md)
own the connected runtime contracts. They distinguish
the Convex-inspired attempt/snapshot/metadata boundary from optimizations to the
current live-check protocol. This note
clarifies the foundation replacement in
[the execution roadmap](./14-execution-redesign-roadmap.md). It does not declare
numerical acceptance or start runtime work outside those focused scopes.

## Outcome And Owners

Make admission, readiness and publication small, explicit responsibilities with
correct lifetimes. Extend proved installation and preparation mechanisms into
the existing admitted Application, Medusa and Payload consumers. Preserve native
business behavior and one Postgres settlement authority. Lower overhead is an
acceptance obligation, not a consequence inferred from a cleaner diagram.

| Responsibility | Purpose | Selected cost boundary |
| --- | --- | --- |
| Installation integrity | Establish that protected structure, credentials and maintenance protocols are valid. | Controlled installation/maintenance proves structure; runtime retains the proved fresh interlock. |
| Immutable preparation | Authenticate and compile the selected schema/binding metadata. | Reuse only through an existing bounded owner, with explicit identity, invalidation and disposal. |
| Admission | Establish who may execute against this scope, placement and execution profile now. | Initial complete authentication belongs to the outer execution; retain actual fresh authority, revocation, fence and lifetime checks at their required boundaries. |
| Readiness | Establish that the access paths needed by this query can serve its snapshot correctly. | Check demanded identities, activation and coverage; record exact dependencies and batch compatible demands. Unrelated paths do not become query prerequisites. |
| Publication | Accept the final writes and make their durable outcome visible atomically. | One trusted owner validates authority, OCC and constraints and commits data, history/index maintenance, result and supported event intents. Delivery follows confirmed settlement. |

The persistence and installation owners implement these mechanics; executor
owners establish attempts, snapshots, budgets and recovery. Framework adapters
translate native inputs, lifecycle callbacks and errors. They cannot bypass a
core check, start a second settlement path or compensate for missing core
contracts. Hosts supply execution and transport capabilities, not commit authority.

Direct reads, bounded trusted framework commands, mixed OCC attempts and durable
workflows remain distinct profiles. A borrowed framework participant receives the
outer execution's authenticated context and pending state; it never constructs an
independently settling host as fallback. Reusing immutable metadata is separate
from reusing principal, request, transaction or mutable framework state.

## Convex Principles And Necessary Divergences

Checked-in Convex supplies concrete principles, not a performance guarantee:

- [Logical transaction construction](../../../../crates/database/src/database.rs)
  binds a snapshot and registry state. Flarex can similarly separate reusable
  metadata from live execution authority without holding SQL over sandbox code.
- [Index execution](../../../../crates/database/src/transaction_index.rs)
  requires the selected enabled index and records its metadata dependency.
  Demand-shaped checks must preserve correctness for missing/empty results,
  predicates, ranges, joins, ordering and pending changes, not just returned IDs.
- [The committer](../../../../crates/database/src/committer.rs) checks conflicts
  against committed and pending writes and orders durable persistence and
  visibility. Flarex retains its Postgres writer/commit-lane protocol and durable
  outcome recovery; copying an in-memory registry cannot supply those guarantees.
- [The function runner](../../../../crates/application/src/application_function_runner/mod.rs)
  separates function execution from commit handling. Its replay model does not
  establish that arbitrary framework hooks or workflows may be rerun.

Cloudflare execution, Postgres-authoritative maintenance/invalidation, retained
history and framework-native lifecycles need Flarex-specific proofs. There is no
selection here of a Convex actor topology, a universal OCC API, automatic retries
for every framework call, or a new framework engine.

## Hooks, Events, Transactions And Locks

The [pinned framework audit](../flarexdb-framework-integration/preflight/14-transaction-execution-profiles.md#source-evidence)
and [mixed design](../../design-notes/flarexdb-mixed-mutation-execution.md#payload-hooks-events-and-external-effects)
govern compatibility. Hook names and service return do not establish commit timing.

| Work | Required placement and behavior |
| --- | --- |
| Access, defaults, validation, result transformation and atomic related writes | Preserve native operation ordering and the admitted transaction/attempt. Moving them after commit changes observable behavior. |
| Payload nested Local API operations | Reuse the request transaction or borrowed attempt. Only the trusted outer owner settles; nested completion is provisional. Payload `afterChange` is not a generic after-commit hook. |
| Supported Medusa module/workflow events | Preserve checked family, identity, grouping and cardinality. Capture intents with data and result; service event emission is not proof that the outer transaction committed. |
| External notification or job delivery | Dispatch from durable committed intent after confirmed settlement. Retain delivery retries and idempotency; subscriber failure does not undo the database result. A volatile after-commit callback alone is insufficient. |
| Workflow needing a payment response, wait, independent retry or compensation for committed work | Use its explicit durable execution contract. Queuing payment does not establish that payment succeeded. Do not hold SQL across the wait/effect. |
| Medusa resource lock | Preserve the declared exclusion, owner, expiry, bounded acquisition and release/fencing semantics. OCC is not an automatic substitute; unsupported locks remain outside the finite atomic profile. |

The existing [resource coordination gate](../workflow-foundations/08-resource-coordination.md)
remains pending. This direction neither admits arbitrary Medusa lock workflows
nor moves every Payload hook after commit. Converting an existing external effect
to an intent requires a named capability, observable contract change and proof.

## Retry And Recovery Are A Separate Contract

Making metadata and readiness cheaper does not require broadening replay safety.
Preserve the existing profile's policy while optimizing its checks.

| Observed outcome | Required behavior |
| --- | --- |
| Admitted logical OCC conflict | Discard the attempt and rerun the whole admitted mutation with fresh snapshot/framework state within its existing budget. |
| Confirmed abort in a trusted framework command | Apply that command's selected policy; SQL rollback alone does not make previously executed external effects safe to repeat. |
| Permanent business, validation or authority failure | Return the failure under its native contract; do not introduce an automatic retry. |
| Confirmed commit with a lost response | Return the retained outcome; do not rerun hooks, workflow steps or event capture. |
| Unknown COMMIT outcome | Reconcile exact durable evidence first. An inconclusive lookup is not proof of rollback. |
| Committed event with failed subscriber delivery | Retry delivery under the event contract, not the committed business operation. |

The [terminal durability decision](./14-execution-redesign-roadmap.md#terminal-decision-for-package-2)
is now selected by [the whole mutation successor](./24-whole-mutation-redesign-preflight.md):
finite callbacks may rerun after proven precommit nonacceptance; uncertain COMMIT
must resolve first. Its connected implementation requires further
accepting-boundary corrections; numerical acceptance remains open.
This choice is an explicit lifecycle replacement, not an admission/readiness
optimization or a change to ordinary durable-operation recovery.

## Replacement Inventory And Non-Goals

| Contract or path | Disposition and completion condition |
| --- | --- |
| Proved installation interlock and bounded immutable preparation | Extend to named mixed callers only after proving their writer/lifetime coverage. |
| Source-wide metadata/readiness assembly in selected finite reads | Replace with actual-demand preparation and serving checks through slice 20; remove displaced callers, exports and tests when their behavior is covered. |
| Repeated equivalent proof or contribution construction | Replace at the responsible owner when measured and covered; cross-transaction freshness and distinct framework event families are not equivalent work. |
| Native framework lifecycle, request reuse, constraints and supported locks | Retain their meaning; migrate bindings rather than reimplement business behavior. |
| Finite durable seal/finishing | Replace under slice 24's compact anchor, conclusive nonacceptance and final settlement contract. Named old nonterminal obligations require drain or reviewed migration before activation. |
| Ordinary durable-operation recovery and committed outcomes | Retain for actual consumers; finite replacement does not authorize deletion of committed evidence. |
| Full-proof profiles outside the proved managed coverage | Retain for their named callers. Inventory those callers and establish a removal gate before further replacement. |

Necessary private API, type, identity, schema and format breaks are accepted under
the repository replacement policy. Each runtime preflight must inventory affected
consumers and durable data, migrate consumers and remove displaced paths in the
same coherent slice. No compatibility wrapper, dual engine or silent durable
reset is selected. Public APIs, broader framework admission, general schema
evolution, new host lifecycles and hosted activation retain their existing gates.

## Sequence And Completion Gates

1. Audit the completed mixed-read correction/performance-harness handoff and its
   remaining correctness/performance failures; do not absorb unrelated dirty work.
2. Preserve slice 23's delivered attempt-fixed metadata, demanded readiness and
   consumed-metadata OCC while replacing its remaining choreography under slice 24.
   Complete affected Application/Product/Payload/workflow consumers together.
3. Validate slice 24's selected entry, pending-state and final settlement/recovery
   replacement, including old durable-record disposition and incremental removal.
4. Prove integrated acceptance and retirement under the execution roadmap.

Validation must cover fresh authorization/revocation, maintenance races, wrong
scope or source, preparation invalidation and disposal, unrelated schema growth,
required-path unavailability, snapshot-plus-pending behavior and complete OCC
dependencies. Include nested participant reuse, native hook order/results,
rollback, cancellation, conflict retry, lost commit responses and supported event
capture/delivery failures. Lock admission needs its own coordination witnesses.

Use focused PGlite and ordinary-role PostgreSQL proofs for transaction and
isolation claims, genuine native framework consumers, and the actual sandbox
boundary for mixed claims. Compare matched complete requests with native demands;
charge authentication, cache misses, invalidation, history, publication, retries
and cleanup. Measure warm/cold/reconnect, unrelated-schema growth, relevant demand
and concurrency. SQL counts help locate work; they do not establish its latency
cause. Harness success and local medians do not satisfy full scaling or hosted
acceptance. Both required reviews, cleanup and a scoped commit close each runtime
slice; documentation selects direction, not achieved performance.
