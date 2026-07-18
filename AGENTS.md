# Flarex Agent Rules

These are operating rules for future agents working in this workspace. Feature
design records, implementation notes, Convex references, and Cloudflare
differences belong in `roadmaps/`, not in this file.

Keep this file durable. Do not copy milestone status, exact actor names,
temporary test receipts, or unresolved DDL sketches here; link to the owning
design note or roadmap and verify its current status instead.

Before committing a significant code change, spawn both project custom reviewer
subagents: `typescript-diff-reviewer` and `code-quality-diff-reviewer`.
Significant code changes include behavior changes, public contract/type changes,
data model/schema/migration changes, non-trivial refactors, or test changes
that materially alter coverage or expectations.

The two standing reviewers are risk-adaptive. The TypeScript reviewer owns
type soundness, public API compatibility, runtime contract agreement, typed
errors, reusable types, and all Effect implementation-quality review. The
code-quality reviewer owns behavioral and data correctness, trust boundaries,
transactions and concurrency, reliability, performance, operability, general
maintainability degradation, obvious defects, plausible failure modes, and test
quality. It reviews concrete system consequences in any TypeScript code, but
does not duplicate Effect pattern or API-style review. There is no separate
Effect migration reviewer.

Do not require reviewer subagents for docs-only commits, planning/roadmap
updates, formatting-only changes, generated-file refreshes, or minor mechanical
edits that do not affect behavior.
Do not spawn reviewer subagents on every turn; use main-thread self-review
during ordinary investigation, small edits, and test-fix loops, and reserve
reviewer subagents for meaningful checkpoints before commit or after significant
implementation slices.

Reviewer subagent behavior is defined in `.codex/agents/`. Treat those files
as the source of truth for reviewer scope, read-only boundaries, TypeScript
skill usage, validation expectations, and response format.

Any agent implementing or refactoring Effect code, and the TypeScript reviewer
when reviewing Effect code, must read and apply the global
`C:\Users\Admin\.codex\skills\effect-ts-patterns\SKILL.md` plus the Flarex
overlay in `.codex/agents/effect-review-guide.md` before acting. Trigger this
rule when a touched flow imports or should use Effect, Option, Result, Exit,
Match, Schema, Config, Context, Layer, Scope, Fiber, Effect HTTP, Effect tests,
runtime bridges, or typed Effect errors. Load the global
`effect-ts-error-handling` skill as well when failure classification, recovery,
retry, foreign error mapping, or boundary logging changes.

Apply the Effect standard during implementation, not only during review. Choose
`Effect.fn`, `Effect.gen`, pipelines, `Option`, `Result`, `Exit`, `Match`,
services, Layers, Scope, Schema, and Effect-native tests from their semantics
and the installed Effect version. Neighboring inconsistent code is migration
evidence, not precedent. When the approved change materially touches a concrete
pattern violation, make the smallest behavior-preserving correction in the
same slice when focused validation is available; do not expand into an
unapproved migration or contract, trust, transaction, or lifecycle change.

Choose pipelines, generator composition, and collection combinators by
evaluation semantics, not by a universal style rule. For eager `Option` and
`Result` values, use `map` / `flatMap` pipelines for a short linear flow, the
installed `gen` for several dependent successes or call-level short-circuiting,
and `all` only for independent members. Array and record member expressions
passed to `Option.all` or `Result.all` are evaluated before the combinator
inspects them; a lazy iterable can instead defer member creation and stop
consumption at the first `None` or failure. For `Effect`, pipelines and
`Effect.gen` both preserve lazy execution; choose by dependency and readability,
and use `Effect.all` only when its ordering, concurrency, failure, interruption,
and cancellation policy matches the contract. Ordinary JavaScript used to
construct an Effect collection still runs eagerly. Do not treat `Exit` as an
ordinary sequencing abstraction: transform or fold it only at a boundary that
owns its full `Cause`. Do not inspect an outcome merely to rebuild the same
absence or failure, and preserve call-level short-circuiting when refactoring.

Refactor the whole composition shape rather than mechanically replacing every
failure or absence guard with its own pipeline. One transformation or dependent
step usually belongs in a short `map` / `flatMap` pipeline; several named or
dependent successes usually belong in the installed `gen`. Preserve validation,
effect-execution, and first-failure order either way.

Organize new and materially refactored Effect code by domain first. Keep pure
models and policies, service contracts, substantial live Layers, and domain or
host composition roots visibly separate. Business effects belong in service
operations; Layers own construction, requirement closure, acquisition and
release, startup gates, and scoped background processes. Preserve request,
transaction, Worker, and Durable Object lifetimes, and do not force dynamic
multi-instance values into singleton Context tags. Follow
`roadmaps/effect-native-guidance/14-domain-services-layers-and-composition.md`.

When a diff touches Effect code, the TypeScript reviewer must read the global
skill and Flarex overlay completely and report its actual Effect coverage. The
global skill owns reusable workflow and examples; the checked-in overlay owns
Flarex's installed-version facts, public contracts, trust boundaries,
Cloudflare differences, and reviewer responsibility split. The code-quality
reviewer continues to inspect behavioral, data, security, transaction,
reliability, performance, operability, maintainability, and test consequences,
but does not review Effect idioms merely because the implementation uses
Effect.

TypeScript Effect review includes the smallest semantically connected
operation, service or Layer, runtime boundary, and direct call path around the
changed code. The TypeScript reviewer must report a concrete, actionable
pre-existing guide violation when
the diff calls, extends, copies, or materially relies on it, even if the
offending line itself did not change. Label it as touched-flow debt, recommend
the smallest bounded improvement, and normally treat style-only debt as P3. Do
not use this rule for an unrelated file or package-wide audit. The main thread
should fix bounded touched-flow debt in the approved slice when behavior can be
preserved and validation is available; broader contract, trust, transaction,
or architecture changes require their own preflight.

The main thread owns all writes and all Git operations. The main thread must
triage reviewer findings, apply useful fixes itself, rerun validation, then
commit. If the diff changes after reviewers are spawned, the previous reviews
are stale; rerun the required reviewer set against the final diff unless the
only change is docs-only commentary.

## Shared Utility And Contract Ownership

Classify a repeated helper by its real authority before extracting it:
generic primitive, protocol/domain contract, persistence, host/runtime, test,
or legacy compatibility. Repetition alone does not make a helper generic.
When a domain error union has repeated discrimination or presentation policy,
keep that contract beside the union and let adapters retain only their status,
transport, or boundary-specific mapping. Do not publish domain error variants
or their messages as a generic error utility.

Use `@flarex/utils` only for total, deterministic, domain-neutral primitives
shared by, or proven exactly duplicated across, independent package owners. It
is a dependency leaf: it must have no runtime dependencies and must not import
Effect or another Flarex package. Keep a helper package-local while it has one
legitimate owner or expresses a local invariant more clearly than a generic
primitive.
When repeated Effect-returning structural decoders have one package owner but
different domain errors, share only their exact mechanics through a
package-local generic or factory. Let each consumer supply its operation,
message, and typed failure constructor. Do not move that Effect adapter into
`@flarex/utils`, and do not erase the domain error channel merely to make the
helper look generic.
Keep Node filesystem and path-boundary mechanics with their host or tooling
owner. A host-local helper may centralize canonical path resolution,
inside/outside-root checks, file-kind and byte-size inspection, bounded reads,
or atomic no-replace publication. Callers retain the evidence kind, byte
ceiling, diagnostics, and recovery policy. Do not add Node dependencies or
host-specific trust policy to `@flarex/utils` merely because several commands
repeat the same filesystem sequence.
When several host adapters share a bounded foreign-response-to-JSON sequence,
centralize the byte-read and fatal decode mechanics with that host owner. Let
each adapter retain its byte ceiling and size, stream-read, decode, redaction,
and envelope errors through explicit callbacks. Preserve the original failure
order and any exact size-error identity. Keep optional empty-body acceptance
with the endpoint contract that owns it rather than adding a permissive generic
JSON-reader option or moving the helper into `@flarex/utils`.

Before adding a local utility, inspect the installed platform and dependency
APIs for an exact portable owner. Reuse a total encoder such as Effect
`Encoding.encodeBase64Url` when its spelling and input contract match. Keep
validation, canonical re-encoding checks, size limits, branded outputs, and
typed failure mapping at the protocol or domain boundary; a general decoder
does not prove a Flarex canonical representation.
When several protocol consumers share one canonical text-to-bytes algorithm,
place its syntactic Schema and pure `Result` decoder with the protocol codec
owner. Let callers supply their byte ceiling and translate the codec issue into
their own tagged failure; do not move the canonical policy into
`@flarex/utils`, duplicate the foreign decoder, or erase consumer-specific
limit and error contracts.
At an importable unknown-object boundary, use `@flarex/utils/records` directly
for shallow non-null, non-array narrowing instead of repeating the check or
asserting a mutable `Record`. Its result is readonly and does not establish a
plain prototype, JSON membership, symbol-key policy, or a domain shape. Retain
a local domain guard when it checks those additional invariants, but delegate
only its exact shallow-record step to the generic primitive.
Do not widen that readonly verdict into a mutable-record assertion. When a test
fixture or domain flow must write through the value, establish ownership with
an explicit local copy and reattach copied nested records before mutation. Keep
fixture-mutation helpers with their test owner rather than publishing them from
`@flarex/utils`.
For a decoded domain union, keep reusable typed discriminators with the union
owner. Do not make consumers repeat structural checks, and do not confuse a
typed discriminator with an unknown-input validator; retain a separately named
`FromUnknown` validator when the complete wire or domain shape must be proven.
Keep the union members structurally exclusive at the discriminant so a public
type predicate cannot accept a compile-time-valid value that the owning decoder
rejects.
When a value is already typed as Flarex `Json` or `WritableJson`, use the
protocol-owned `isJsonObject` or `isWritableJsonObject` discriminator instead
of rediscovering that union member with the generic unknown-record predicate.
Those discriminators classify validated JSON; they do not validate unknown
input. When unknown input must satisfy the complete Flarex JSON object
contract, use protocol-owned `isJsonObjectFromUnknown`; use
`isWritableJsonObjectFromUnknown` only when the writable compatibility type is
actually required. These guards recursively validate JSON membership,
including finite numbers, dense arrays, plain prototypes, string-only keys,
and acyclic structure, but they do not impose a byte limit, canonical encoding,
domain payload shape, authority, or runtime mutability. Keep those stronger
claims with their owner.
Raw HTTP JSON readers return `unknown`. An unconstrained generic type argument
or assertion does not validate a response body and must not let callers choose
an arbitrary success type. Keep the domain-owned payload decoder as the sole
authority that turns the raw body into a typed success value.
Use `@flarex/utils/strings` to classify an unknown value as a primitive
nonblank string only when the contract is exactly "at least one code unit
remains after ECMAScript `trim`". The predicate does not return a normalized
spelling and deliberately does not reject null bytes or zero-width characters,
impose Unicode normalization or byte limits, prove PostgreSQL/JSON safety, or
establish a domain identifier or secret policy. Keep those stronger checks,
their order, messages, and brands with their owner. When a boundary needs the
trimmed spelling itself, normalize once locally instead of validating and then
trimming again through a generic predicate.
Use `@flarex/utils/numbers` to classify an unknown value as a positive or
non-negative JavaScript safe integer. The non-negative predicate deliberately
accepts JavaScript negative zero, matching `Number.isSafeInteger(value)` plus
`value >= 0`. Keep caller-specific error text, upper bounds,
integer-but-not-safe contracts, signed ranges, time semantics, and branded or
protocol numeric policy with their owning decoder; a shared predicate is not a
shared range contract.
When several adapters under one package intentionally share the same throwing
configuration policy and error spelling, centralize that wrapper package-
locally around the generic predicate. Do not promote throwing configuration
errors or host option names into `@flarex/utils/numbers`.
Use `@flarex/utils/strings` to trim an optional string to a nonblank spelling
or the shared `null` sentinel only when missing and ECMAScript whitespace-only
input intentionally have the same meaning. Keep configuration names,
precedence, required-value errors, secret handling, canonical text policy, and
domain validation with their owner. Do not use that normalizer when surrounding
whitespace is significant or when `undefined`, empty, and whitespace-only input
must remain distinguishable.
Use `@flarex/utils/dates` only to read a finite intrinsic millisecond snapshot
from an unknown same-realm JavaScript `Date`, or to copy that snapshot into an
owned plain `Date`. The utilities never dispatch caller-controlled Date methods
and return `undefined` for invalid Dates, Proxy receivers, and prototype
impostors instead of leaking a native exception. At a trust boundary, consume
the returned timestamp or owned copy; do not validate one read and then invoke
a method on the caller-owned Date. These utilities do not parse text or prove
canonical ISO spelling, time-zone policy, freshness, ordering, expiry, database
clock authority, or a branded timestamp contract; those rules and their
failures stay with the protocol, persistence, or host boundary.
When several modules under one host owner intentionally accept JavaScript-
parseable date text and normalize it to ISO, share that policy package-locally
while retaining each caller's validation order and typed failure mapping. Do
not promote platform Date parsing into `@flarex/utils/dates` or describe the
input as canonical merely because the output is normalized.
When a pure recoverable decoder serves both a typed Effect API and an existing
throwing compatibility API, keep one domain-local Effect v4 `Result`
normalizer. Enter the Effect error channel once with `Effect.fromResult`, and
use `Result.getOrThrow` only at the explicit unchecked compatibility boundary.
Do not maintain a parallel ad-hoc result union or result-to-Effect adapter, and
do not move the domain decoder into `@flarex/utils` merely to share those two
boundary forms. Identify the concrete shipped or supported consumer before
retaining that unchecked wrapper; code presence and a regression test do not
create a compatibility obligation, and an unused wrapper should be deleted.
When multiple Effect consumers call the same Promise-based protocol operation,
prefer one protocol-owned Effect adapter that preserves its typed failures and
routes unexpected causes to defects. Consumers may translate the typed error
channel for their domain, but must not turn defects into ordinary failures.
Within persistence, reuse the package-local transaction capability type for
operations that require Drizzle transaction-only methods such as `rollback`
or `setTransaction`. Keep domain aliases when they communicate the owning
operation, but do not redeclare the structural capability and do not accept
the top-level autocommit database for a lock whose lifetime must span later
work. This transaction marker is a persistence contract, not `@flarex/utils`
material and not automatically a public package export.
Keep Drizzle query-observation mechanics with the persistence package. When
several persistence operations expose test-only compiled SQL receipts, share
only the exact compile, detach, and freeze mechanism; retain domain query-name
unions and observer options with their owning operation. An absent observer
must remain a true short circuit that does not compile the query, and helper
reuse must not change query execution, failure mapping, or transaction order.

Do not move Effect Schema options, typed errors, authority or cryptographic
logic, persistence codecs, canonical protocol encodings, universal deep-freeze
logic, or legacy compatibility into `@flarex/utils`. Those concerns stay with
their protocol, domain, persistence, host, or temporary migration owner.
When persistence retains already-decoded schema-manifest values across an
asynchronous or database boundary, share clone-and-recursive-freeze mechanics
through a persistence-local helper whose accepted input is restricted to those
plain-data manifest shapes. Establish ownership before freezing, preserve the
caller's original values, and do not widen that helper into a generic unknown-
object deep freeze or move it into `@flarex/utils`.
Do not collapse an ownership-establishing snapshot and an in-place projection
freezer merely because both recurse. A snapshot clones validated acyclic plain
data before freezing it. An in-place freezer may receive only an acyclic
projection already owned by its caller, must preserve its deliberate byte-view
handling, and must never freeze caller-owned metadata. Copy the selected
caller-owned subtree at its capture boundary instead. Keep both mechanisms
domain-local and name their ownership contract explicitly.
When several protocol operations consume one codec envelope, the codec module
owns its structural type, guard, and Schema. Consumers reuse that contract but
retain their own byte limits, canonical byte comparisons, digest checks, and
typed failure mapping. Do not redeclare a weaker envelope merely because a
consumer immediately performs stronger canonicalization afterward.
An algorithm that derives serialized Flarex metadata remains a protocol
contract even when its implementation looks like generic string manipulation.
Centralize such derivation with the protocol owner while keeping consumer
validation messages and domain failure mapping local.
Platform limits become protocol policy when they bound a shared domain value;
do not publish them as generic numeric utilities merely because their source is
the JavaScript runtime. Bound the predicate to the protocol's exact wire
representation rather than a broader host capability. Keep caller-specific
configuration errors local while sharing the predicate and inclusive bounds.
Validate the numeric representation before relational comparisons so unknown
JavaScript inputs are rejected without invoking caller-controlled coercion.
Use `@flarex/utils/bytes` only for the shallow `Uint8Array` and visible-byte-
length predicate when independent owners need that exact classification. The
predicate reads the intrinsic typed-array kind and view length rather than
trusting `instanceof` or an own caller-controlled `byteLength` property. Keep
fixed digest or identity lengths, branded byte values, canonical encoding,
validation messages, and domain failure mapping with their protocol,
persistence, or executor owner. A detached `Uint8Array` has a visible byte
length of zero under JavaScript and the shared predicate preserves that native
classification. Proxy receivers and prototype impostors that fail the intrinsic
typed-array brand check return `false` rather than leaking a native exception;
domain boundaries that forbid detached or empty evidence must retain their own
stronger invariant.

Expose generic utilities through intentional subpath exports. Do not add a
package-root catch-all barrel unless its public surface has been deliberately
approved. Pin extracted behavior with focused tests, replace copies only when
their semantics are exact, including short-circuiting, full-scan, allocation,
normalization, and failure behavior. Detached `ArrayBuffer` views are part of a
byte helper's input and failure contract: do not replace an iterator-based
encoder with a length/index implementation if that changes detached views from
throwing to an empty result. Canonical byte helpers must read the intrinsic
typed-array view rather than a caller-overridden iterator. Pin detached,
visible-range, and overridden-iterator cases explicitly. Do not claim
cryptographic constant-time behavior for ordinary JavaScript loops. Generic
defensive byte copies may detach `Uint8Array` storage or copy a visible byte
range into a fresh, exactly-sized `ArrayBuffer`. The decision to require either
representation, plus branded validation, hashing, and named evidence-capture
constructors, retains its domain owner and may delegate to those primitives.
Retain narrow local wrappers when their names communicate an important domain
invariant. Never centralize a legacy path just because it is duplicated;
removal can be the correct reuse strategy.
When accepted design intentionally keeps a permissive compatibility facade
beside a stricter replacement codec, do not merge their contracts merely to
deduplicate code. Remove duplicate implementations within each surface, keep
authoritative replacement paths on the strict owner, and keep compatibility
consumers on the named facade until its recorded retirement gate.
Before consolidating equality helpers, pin their treatment of negative zero,
key order, sparse or invalid containers, unknown non-JSON inputs, allocation,
and failure behavior; the same helper name does not prove the same contract.
Canonical JSON text for already-validated Flarex JSON belongs to the protocol
owner. Consumers should retain domain-significant names such as query tokens
or fingerprints and keep invariant-failure adapters local. Normalizers that
omit SDK `undefined` fields, validate unknown input, or map domain failures are
not interchangeable with the canonical encoder. A JSON object normalizer must
preserve every valid string key, including `__proto__`, as an own enumerable
data property and must not install caller-controlled prototypes.

## Core Rule

Flarex is a Convex-inspired, Postgres-authoritative backend hosted on
Cloudflare. Postgres is the only authoritative committed app-data store.
Cloudflare hosts sandboxed execution, service bindings, WebSockets,
coordination, and explicitly non-authoritative freshness/cache state.

Implement Flarex with care: copy Convex semantics where they are portable,
copy or closely port Convex SDK and codegen logic where licensing and runtime
boundaries allow it, and explicitly document every necessary divergence.

Do not build a generic CRUD server and call it Convex-like.

## Design Challenge Rule

The user explicitly wants evidence-backed design pushback. Treat every proposed
design—including a user proposal, existing markdown, current code, and the
agent's own first idea—as a hypothesis to pressure-test before implementation.

Compare the proposal with the accepted design, current schema and code,
relevant Convex semantics, and the declared slice boundary. Call out concrete
contradictions, duplicate authorities, unsafe trust or transaction boundaries,
stale assumptions, missing failure/recovery behavior, premature abstractions,
and a smaller correctness-preserving alternative.

Prefer respectful, evidence-backed disagreement over uncritical agreement. Do
not manufacture objections or block mechanical work with a ritual critique. If
the proposal survives review, say why. Once a decision is accepted, record it
durably and proceed until new evidence invalidates it.

## Implementation Step Preflight

Before starting any roadmap implementation gate or other meaningful
behavior-changing slice, stop and discuss that step with the user. A roadmap
number is a current planning hypothesis, not sufficient authorization or proof
that the step is still correctly ordered.

Research the step before presenting it. Read the accepted design, the relevant
domain roadmap and focused plan, current definitions/schema/code/tests, related
completed and deferred gates, and the checked-in Convex source or other primary
reference that governs the behavior. Consider the whole repository and the
nearest end-to-end milestone, not only the file named by the next checkbox.

The preflight must explain in plain language:

1. **What** the step will deliver, its affected boundaries, and explicit
   non-goals.
2. **Why** it should happen now, which dependencies it closes, and how it moves
   the system toward the nearest end-to-end proof.
3. **Where** the decision and execution order are owned in markdown, and which
   current code, definitions, tests, and Convex references provide evidence.
4. **What was challenged:** contradictions, stale assumptions, missing
   failure/recovery behavior, ordering problems, alternatives, and any smaller
   correctness-preserving slice. If legacy code is touched, classify each
   affected path as `keep`, `port`, `rewrite`, `delete`, or `temporary bridge`,
   and identify the evidence for any compatibility obligation.
5. **How completion will be proven:** focused tests, required real-Postgres or
   Cloudflare lanes, compatibility checks, and the exact exit criteria.

Do not begin implementation until the user explicitly approves the step after
this preflight. A generic `go`, `continue`, or prior approval authorizes only
the already-discussed step; it does not automatically authorize the next
roadmap gate. If research shows that the planned step is premature, duplicated,
over-broad, or ordered incorrectly, recommend the correction and update the
owning plan after agreement before implementing it.

This preflight is required once per meaningful implementation gate, not before
every shell command, formatting action, validation rerun, or small test-fix
loop inside an approved unchanged slice. Pause for a new preflight if evidence
materially changes the approved scope, architecture, trust boundary, or
execution order. Discussion-only, research-only, docs-only, and mechanical
turns do not need a ceremonial self-preflight unless they propose a subsequent
implementation gate.

### Standing Approval For Utility Consolidation

The user has explicitly granted standing approval for the active goal to
incrementally consolidate shared utilities and duplicated contracts into their
correct workspace or domain owners. Within that goal, this paragraph overrides
the per-step approval pause above: after researching and challenging a bounded
slice, proceed to implement, validate, review, commit, and continue without
asking the user to approve each ownership decision again.

This standing approval does not widen the goal. Keep behavior, public
contracts, trust boundaries, transaction semantics, persistence authority, and
runtime lifecycles unchanged unless their correction is itself supported by
the goal's current evidence. Pause only when new evidence requires a material
expansion outside utility or duplicated-contract ownership, an irreversible
external action, or information that cannot be established from the repository.

## Replacement Design Authority

Flarex is in an intentional replacement effort. Do not confuse the currently
implemented prototype or historical roadmap checkpoints with the accepted
future architecture, and do not preserve an old design merely because code for
it already exists. Agents are authorized and expected to make substantial
schema, executor, and runtime changes when a validated replacement slice calls
for them.

Use these sources in this order when deciding the future design:

1. `design-notes/flarex-db-accepted-design.md` for accepted architecture,
   trust boundaries, and migration rules.
2. `design-notes/flarex-commerce-cms-v1-schema-cutline.md` for the minimal v1
   inventory and explicit deferrals, not as verbatim physical DDL.
3. `roadmaps/flarexdb-foundation/README.md` and its focused plans for active
   slice order, accepted slice-level refinements, and correctness gates.
4. The relevant domain roadmap for current decisions and chronological
   implementation evidence.
5. `design-notes/flarex-internal-db-schema.md` as a long-form proposal,
   physical-policy inventory, provenance record, and unresolved-risk list.
   Its unrefined DDL sketches are not accepted merely because they are written.
6. Current code and older roadmap checkpoints only for implementation evidence,
   regression tests, provenance, and compatibility inputs when a shipped
   obligation is actually recorded.

Read status labels literally. `Implemented prototype baseline` is not the
same as `accepted target`; deferred designs are not active requirements. If an
older note or implementation conflicts with the accepted replacement design,
follow the accepted design and update or explicitly mark the stale statement as
superseded. A newer timestamp alone does not promote a proposal to accepted
authority. Never silently combine legacy Durable Object storage assumptions
with the Postgres-authoritative replacement.

Compatibility protection is evidence-triggered, not code-triggered. Before
requiring a backfill, shadow or dual read/write path, legacy identifier mapping,
scoped cutover, tombstone import, or runtime rollback switch, the owning design
record must identify the shipped obligation: durable authoritative data,
externally issued identifiers/request keys/cursors, live traffic, or a supported
published contract. Existing code, local fixtures, and regression tests do not
by themselves create that obligation.

When no shipped obligation exists, prefer a clean replacement: preserve and
port still-intended semantics and tests, switch internal callers, and remove the
superseded schema, runtime path, adapter, and compatibility code. Use source or
deployment rollback while a checkpoint is being proven rather than constructing
an artificial dual-storage migration. Before the first supported release,
rebaseline migration history so a fresh install creates only the target schema;
do not leave a permanent create-legacy-then-drop-legacy chain without a proven
upgrade obligation. Do not add new features to a legacy path.

When durable data exists without a live-traffic requirement, use the smallest
safe one-time migration with backup, invariant verification, and recovery proof;
dual operation is not automatic. When live traffic or an external contract does
exist, retain only the compatibility mechanisms justified by that evidence and
name their retirement gate. Every temporary bridge must record its current
consumer, reason, and deletion condition. If evidence of a previously unknown
shipped obligation appears, pause destructive work and update the owning design
and roadmap before continuing.

## Convex-First System Rule

Flarex must be developed Convex-first across the whole system, not only the
type system.

For backend storage, OCC, sync/subscriptions, scheduling, deployment metadata,
function analysis, generated APIs, `_generated/server`, `_generated/dataModel`,
function references, validators, query builders, mutation/query/action
registration, client APIs, local dev server, CLI/codegen flow, testing strategy,
and operational behavior, inspect Convex first and either:

1. port the relevant Convex package logic closely, or
2. document exactly why Flarex must diverge because of Cloudflare runtime,
   partitioning, service bindings, licensing, or a deliberately different
   Flarex API.

Do not invent a new design when Convex already has a portable pattern. Flarex's
default should be "same developer mental model and same core behavior as
Convex"; differences should be narrow, named, and recorded in `roadmaps/`.

## Living Roadmap Maintenance

Treat domain roadmaps as living sources of truth for architecture, rationale,
current domain status, and target direction. They are not implementation logs.
Code, schemas, and tests remain authoritative for exact implemented behavior;
accepted design notes remain authoritative for cross-domain decisions under the
precedence rules above; Git owns chronological implementation history.

Update a domain roadmap only when a turn changes or newly clarifies at least
one of these durable facts:

- domain scope, ownership, or trust boundaries
- accepted architecture, invariants, or rationale
- Convex compatibility or a deliberate Flarex divergence
- implemented capability status
- known gaps, limitations, or recovery behavior
- target direction, sequencing, or correctness gates

A code touch alone does not require a roadmap edit. Do not add commit IDs,
commit titles, per-commit change summaries, reviewer receipts, verification
receipts, or chronological checkpoint histories to living roadmaps. Keep
verification in the current task report and Git commit/PR context. If no
durable roadmap fact changed, leave the roadmap untouched.

Until existing roadmaps are compacted, any older domain-local instruction to
append checkpoint commits, previous commit IDs, per-turn notes, or verification
receipts is superseded by this section.

Treat every roadmap claim as a hypothesis to verify against the accepted design
records, current schemas and code, decisive tests, and the active slice. When
new evidence or an accepted decision makes roadmap content stale,
contradictory, or incomplete:

1. determine whether the implementation drifted or the accepted direction
   genuinely changed;
2. fix the implementation when it violates the accepted design;
3. update the roadmap in the same turn when the durable domain truth changed;
4. remove or clearly mark superseded statements instead of silently combining
   them with the current design; and
5. preserve only still-relevant rationale, using Git when historical detail is
   needed.

Do not rewrite a roadmap merely to legitimize accidental code drift. Apply the
Design Challenge Rule and Replacement Design Authority before promoting a new
direction. If a turn changes multiple domains' durable truths, update each
affected roadmap. If no existing file fits, create a focused domain roadmap
using `roadmaps/_domain-template.md` rather than a global log.

Discussion-only, research-only, mechanical, and behavior-preserving turns do
not require an empty roadmap update.

## Automatic Checkpoint Commits

After a repository-changing turn is implemented, documented, and successfully
verified, create a Git commit automatically without waiting for an additional
user request.

- Keep each commit scoped to the completed implementation step.
- Use an imperative commit title that explains the checkpoint.
- Do not commit known failing work unless the user explicitly requests it.
- Do not include unrelated user changes in the commit.
- Always report the commit ID and title in the final response.
- If verification fails or the work is incomplete, leave it uncommitted and
  explain the blocker.

## Where To Put Records

Use `roadmaps/README.md` as the maintained domain index rather than duplicating
its full mapping here. Current primary anchors are:

- FlarexDB foundation and turn order: `roadmaps/flarexdb-foundation/`
- Postgres trusted executor and host adapters: `roadmaps/20-postgres-executor.md`
- Sync and non-authoritative cache layers:
  `roadmaps/21-cloudflare-freshness-cache.md`
- Commit compiler and session intent:
  `roadmaps/35-commit-compiler-and-session-intent.md`
- Cross-system Convex-first policy: `roadmaps/13-convex-first-system-porting.md`

Historical filenames containing `DO`, `partition`, or `shard` do not make
their old architecture active. Read their status and the accepted design before
using them.

## Backend Rules

1. Keep `packages/flarex-backend` backend-only.
   `apps/backend` is its thin public Worker wrapper; `apps/executor` is the
   private executor Worker adapter. Do not add client APIs to backend or host
   packages. Client and generated developer APIs belong in `packages/flarex`,
   `packages/flarex-dev`, and test/dev packages.

2. Treat the Postgres trusted executor as the forward authoritative data path.
   The older Durable Object shard implementation is prototype/legacy
   scaffolding. New storage, OCC, and authoritative invalidation work should
   follow the FlarexDB foundation plans and `roadmaps/20-postgres-executor.md`.
   Existing Postgres-backed code is not automatically the accepted target; it
   must conform to the accepted FlarexDB schema, session, OCC, commit, and sync
   boundaries. SDK and client work remains in its own domain roadmaps.

3. Keep runtime hosts as adapters, not the executor core. The hosted production
   target is a dedicated private Cloudflare Worker reached through service
   bindings and backed by cache-disabled Hyperdrive. Trusted transaction logic
   belongs in framework-neutral packages such as `@flarex/executor` and
   `@flarex/persistence-postgres`. `@flarex/executor-http` may remain the
   private Web-standard Fetch adapter while `/invoke/*` is stable;
   `@flarex/executor-nitro` is an optional Nitro/Vercel compatibility adapter.
   Do not retire either compatibility path until the Worker/Hyperdrive host
   passes its declared bundle and real-Postgres correctness gates. Hosted
   activation gates do not block host-neutral schema, OCC, or compiler work.
   This host-adapter parity rule does not require preserving a legacy app-data
   engine or Durable Object authoritative fallback.

4. Use PGlite for local and fast test lanes, but keep real Postgres as the
   required correctness lane for isolation, locks, migrations, outbox behavior,
   and production query plans.

5. Preserve Convex's core transaction idea.
   Function execution reads from an exact
   `SnapshotToken { scopeId, epoch, commitSeq }` pinned to a storage generation
   and fence, stages writes, and validates explicit read dependencies before
   publication.

6. Make reads explicit.
   `db.get`, index queries, table scans, and future search reads must record
   read-set entries that can be checked at commit and used for subscriptions.

7. Make writes versioned.
   Store revision history with scope-local `commit_seq` and `prev_commit_seq`,
   and keep current rows only as an optimization. Do not lose tombstone
   information. When durable legacy rows are proven to exist, their timestamps
   may be migration inputs; they are never replacement commit authority.

8. Preserve idempotency.
   Mutation identifiers/idempotency keys are part of backend semantics so
   retries do not duplicate writes.

9. Use database transactions correctly.
   Postgres/PGlite transaction helpers should own `BEGIN`/`COMMIT`/rollback.
   Do not hold a Postgres transaction open while waiting on untrusted user code
   in any execution host.

10. Keep any accepted Durable Object identity deterministic and scoped to its
    real authority. Do not copy a legacy deployment-key convention into a
    scope-owned sync or cache actor. Exact names and deferred actor status
    belong in their owning roadmap and implementation.

11. Do not expose raw storage or database handles to user code.
    Dynamic Worker user code should call a restricted syscall API. The backend
    owns routing, transaction state, OCC validation, and persistence.

12. Prefer conservative correctness over hidden convenience.
    If a runtime or storage boundary cannot provide Convex-like semantics,
    expose the limitation in API design and generated errors instead of
    pretending it is transparent.

13. Keep Flarex-managed execution artifacts invisible to developers.
    Developers write ordinary TypeScript modules under `flarex/`; they do not
    write Worker entrypoints, `fetch` handlers, Wrangler configuration, or
    Dynamic Worker code. Flarex tooling bundles only the `flarex/` developer
    modules into a source package, and the Flarex platform creates and manages
    the internal execution artifact.

14. Treat backend analysis as authoritative.
    Local analysis may provide fast feedback, but deployed function paths,
    kinds, visibility, validators, schema, and source positions must come from
    analysis performed by the backend-controlled dynamic execution isolate.
    Final codegen and runtime validation must consume that authoritative
    analysis.

## Verification Rules

Validate proportionally to the changed correctness boundary. Run affected
package typechecks, focused tests, and builds. Schema, transaction, isolation,
lock, migration, outbox, and query-plan changes require the relevant PGlite
fast lane plus a focused real-Postgres correctness lane.

Run the backend-specific commands below when `packages/flarex-backend` or
`apps/backend` changes, not for every unrelated workspace package change:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

Run workspace-wide commands only for genuinely cross-cutting changes whose
affected boundary cannot be covered by package-level gates:

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Focused core schema, OCC, and compiler slices do not authorize Cloudflare
provisioning, deployment, or unrelated broad integration suites. If a broad
command fails because of environment or resource pressure after relevant tests
pass, record that honestly and rerun the affected files in bounded fresh
processes; do not misreport the broad command as green.

If `wrangler dev` is started for smoke testing, stop the Wrangler process and
any `workerd` children before finishing.

Use `corepack pnpm --filter @flarex/backend deploy:dry-run` only when checking
the deployable Cloudflare wrapper as part of an explicitly in-scope host or
deployment change. It may be slower or environment-sensitive because it
invokes Wrangler; do not make the normal workspace `build` depend on it.
