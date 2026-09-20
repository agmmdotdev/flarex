# Core Execution Completion Plan

Status: active remaining-work plan. Existing CE implementations remain in use;
the CMS command concurrency cutover is implemented; broader write coordination
and protected readiness remain open. The owner grants standing approval and requests medium-sized,
connected implementation slices.

## Scope And Delivery

Complete the core execution work in three packages below. A package may need
more than one coherent cutover; it is not an estimate of three turns. Each
implementation checkpoint includes its affected callers, failure semantics,
targeted dual-driver validation, both required reviews, cleanup and commit.
Do not use a helper, test matrix, benchmark extension or roadmap update alone
as the intended implementation outcome of a goal turn.

New Medusa integration, the Medusa generic-storage adapter cutover, advanced
migration policy, developer APIs and hosted activation remain outside this
goal. Existing commerce and composite owners are in scope wherever necessary
to preserve a coherent shared locking or settlement contract. Completing this
goal does not mean the entire shared-logical-storage roadmap is complete.

## 1. Coordinated Write Execution And Publication

Outcome: independent same-scope work overlaps without weakening dependency,
constraint, request-identity or lifecycle protection. Final dense publication
may serialize. Explicitly distinguish overlapping preparation, command
execution, materialization and final publication in the resulting claims.

### Current Constraints To Replace Together

- `pointCommitTransaction.ts` holds the scope publication lock before active
  schema, build, session, lease, journal, dependency and materialization work.
  Its earlier native execution already has exact dependency evidence. Preserve
  the existing OCC/retry owners and validate those earlier reads at settlement.
- `cmsTransaction/host.ts` now admits concurrent command execution using exact
  request exclusion and lifecycle protection. Settlement takes the publication
  lock and validates complete point, absence, tombstone, scan and unique
  observations. Each point observation retains its own capture sequence.
- `appRows.ts` captures bounded current rows and their publication ceiling in
  one statement. CMS commands validate those statement observations at
  settlement; standalone reads retain physical repeatable-read snapshots.
  This is not a historical reader or a native mutation snapshot replacement.
- `payloadPreferences/cleanup.ts` now captures intent during the command and
  selects/deletes during settlement. Retain that boundary when moving execution
  ahead of publication protection; do not reintroduce callback-side business
  locks beside clock-first writers.
- Generic row/index history consumes the final commit sequence. A publication-
  last protocol must account for sequence-bearing materialization, implicit
  constraint locks, relations, uniqueness, candidate guards and build state.
  Do not introduce an unexamined second transaction-to-sequence authority.
- Existing commerce, composite and lifecycle owners participate in the lock
  hierarchy. No automatic clock-first fallback may access the same resources
  as a conflicting business-first protocol.

### Design And Cutover Gate

The focused implementation preflight must select the exact execution and
validation strategy for each affected profile, inventory its old/new lock
edges, and identify all consumers that must move together. Evaluate existing
native OCC and trusted relational enforcement separately; do not turn them
into a universal transaction API. Reject a whole-scope version check as a
substitute for exact conflict detection on independent records.

No shared/exclusive lock-mode change alone establishes this outcome. A blanket
repeatable-read or serializable mutation profile still conflicts on the dense
scope clock and is not a concurrent-writer solution. Preserve strong lifecycle
protection and current protected metadata until their replacement is proven.

Completion requires real PostgreSQL barriers through actual core entry points:
independent same-scope progress; same-row and unique conflicts; missing-row and
predicate changes; relation target/delete races; duplicate request exclusion;
activation, revocation and retention races; cancellation and uncertain COMMIT.
Verify exact durable effects, replay without blind callback reexecution and
resource cleanup. Preserve equivalent fast-driver behavioral coverage. No
throughput claim follows solely from barrier success.

## 2. Prepared Metadata And Fresh Admission

Outcome: reuse immutable preparation while authenticating live scope, binding,
generation, revocation and readiness at the responsible owner. The core design
must enforce the chosen invalidation and integrity contract across activation,
ordinary access, maintenance and recovery.

First use existing request attribution to choose the costly checks. Inventory
ordinary/control-plane database privileges and every legitimate metadata writer
before replacing per-request evidence verification with a protected root.
A cached success flag or stored checksum is not protection against edits that
leave the root unchanged. If required integrity semantics prevent a particular
shortcut, record the concrete decision and retained cost; do not silently weaken
corruption detection to meet a benchmark target.

Complete the selected correction across its actual core consumers, with stale,
missing, revoked and tampered-state refusal and bounded preparation retention.
Remove displaced verification/metadata paths only when their obligations have
moved. Native journal coalescing remains conditional on an attributed material
cost; explicitly conclude whether it is required instead of inventing more
evidence formats by default.

## 3. Connected Acceptance And Retirement

Outcome: evaluate the implemented contracts through existing native and CMS
entry points and affected existing commerce/composite regressions. Exercise
point and predicate reads, inserts/updates/deletes, indexes/unique/relation
maintenance, lifecycle work, replay and failure recovery under independent and
contended traffic. This does not authorize new framework capabilities.

Use the existing comparison harness for operations it actually represents.
Extend it only to answer an unresolved acceptance question; do not construct a
second general database implementation. Preserve the recorded scalar latency
and observer-calibration misses until new attributable evidence changes their
disposition. Report offered/completed work, refusals/retries and resource limits
alongside timing. A local bounded measurement is not hosted capacity proof.

Audit the cumulative replacement: no duplicate settlement authority, production
benchmark imports, unowned fallback, displaced exports or stale current-design
claims. Cleanup occurs in each implementation slice; this final audit does not
postpone it. Retained framework migration machinery needs named current users
and a retirement gate; do not delete machinery still required by the separately
gated Medusa storage cutover or label it already retired.

## Goal Completion Decision

Close the goal only when package 1's selected coordinated protocol is implemented
and its connected correctness gates pass, package 2's admission/integrity
decisions have their required implementation and proofs, and package 3 has a
reviewed acceptance and retirement disposition. List any measured performance
limitations with their practical consequences. A missed optimization target
may be an explicitly retained limitation; an unimplemented required protocol,
incorrect result, unsafe race or incomplete consumer migration is not completion.

The [CMS command settlement contract](./63-cms-command-settlement-contract.md)
replaces the write-only contribution and callback-side preference DML as the
first connected prerequisite. The [CMS concurrency cutover](./64-cms-concurrent-command-settlement.md)
moves bounded capture, request exclusion, dependency validation and materializer
entry together. Independent CMS callbacks overlap; materialization and final
publication still serialize. Next address native and existing commerce/composite
preparation under the shared hierarchy, then protected readiness. These remaining
gates are implementation work, not permission for unrelated measurement slices.
