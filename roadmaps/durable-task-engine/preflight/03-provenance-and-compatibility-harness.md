# DTE01-D/E Receipt: Provenance And Compatibility Harness

## Receipt Status

**Status:** DTE01-D provenance/license handling and DTE01-E compatibility
receipt harness design are complete for `run-attempt-lifecycle-v1`.

This receipt consumes the accepted
[`source and package boundary`](./02-source-map-and-package-boundary.md) and its
[`machine-readable source map`](./source-map.run-attempt-v1.json). It fixes the
audit artifacts and test protocol that must accompany a later source
transplant. It does not authorize creation of `@flarex/durable-task` or permit
Trigger source in an active production dependency graph.

## Evidence At The Pinned Source Boundary

The frozen compatibility island currently records:

- Trigger.dev commit `f10bc23785e569e5d917318cf2033aabdbe96a0b` in
  [`SOURCE.json`](../../../third_party/trigger.dev/SOURCE.json);
- an immutable-source policy and complete source checksum manifest;
- the repository Apache License 2.0 text at
  `third_party/trigger.dev/upstream/LICENSE`;
- the `@trigger.dev/core` MIT license and copyright at
  `third_party/trigger.dev/upstream/packages/core/LICENSE`; and
- the island-level [`NOTICE.md`](../../../third_party/trigger.dev/NOTICE.md),
  which distinguishes unmodified upstream source from the Flarex-owned
  compatibility harness.

Those files protect the frozen oracle. They do not automatically travel with a
transformed active-workspace package. The extracted package therefore owns its
own provenance payload instead of relying on a relative link to `third_party/`.

## Package-Local Provenance Payload

The later `packages/durable-task/` checkpoint must contain and include in its
manifest `files` list:

```text
THIRD_PARTY_NOTICES.md
trigger-source-map.json
licenses/
  trigger-apache-2.0.txt
  trigger-core-mit.txt
```

`trigger-source-map.json` is the admitted-package copy of the accepted source
map. Before admission its upstream fields must still match
[`source-map.run-attempt-v1.json`](./source-map.run-attempt-v1.json). Once target
files exist, each non-discarded entry also records:

```text
targetSha256
transformationRevision
changeReceipt
```

`targetSha256` proves the reviewed transformed file. `transformationRevision`
versions the mechanical transplant procedure. `changeReceipt` points to the
focused test or review evidence for semantic adaptation. These fields are not
backfilled speculatively while no target file exists.

`THIRD_PARTY_NOTICES.md` must identify Trigger.dev, the pinned repository and
commit, the applicable Apache and MIT source groups, their retained copyright
notices, the central source map, and the fact that Flarex changed the admitted
files. It must not imply affiliation, endorsement, or that all Flarex-authored
adapter code is Trigger-derived.

The two license files are exact copies of the pinned upstream license texts,
not links and not summaries. The package is private, but private status is not
treated as permission to omit provenance from deployment or other distributed
artifacts.

This receipt preserves notices and provenance. It is not a final legal,
trademark, or release-distribution determination. That review remains a
release gate.

## Source And Test Attribution

Every transformed source or translated upstream test receives one concise
header:

```ts
// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// <upstream path>. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
```

The source map, not the header, is the detailed authority. It names selected
symbols, reuse class, upstream hash, semantic changes, authority reason,
retained tests, added Flarex tests, license group, and eventually the target
hash and change receipt.

The rules are:

1. A transformed file has at least one non-discarded source-map entry and the
   concise header.
2. A file assembled from multiple upstream paths lists those paths in the
   source map; its header may say `multiple mapped upstream paths` rather than
   becoming an inline inventory.
3. A translated upstream test uses the same attribution rule and names the
   retained upstream test in its map entry.
4. Unmodified tests in the frozen island retain their upstream contents and
   headers. They are verified by `SOURCE_SHA256SUMS`, not rewritten.
5. A genuinely Flarex-authored port, Layer, adapter, host, fixture schema, or
   comparator does not receive an adapted-source header. Its relationship to
   an upstream behavior is recorded as test evidence, not false authorship.
6. Significant semantic changes belong in the source map and focused tests.
   Source files do not accumulate migration diaries.

Generated files are not admitted as adapted source. If a later build generates
code from a transformed model, the generator input and generation command are
mapped and the output carries the repository's normal generated marker. Prisma
output is never a permitted generator input or active artifact.

## Separating Mechanical Drift From Semantic Change

The transplant must be reviewable in two stages:

1. A mechanical projection selects mapped symbols and performs only recorded
   module-path, formatting, naming, and type-owner substitutions needed to make
   the slice locally parseable. Its transformation revision and output hashes
   are retained as a receipt.
2. Semantic seam changes are applied after that baseline and are individually
   covered by the map's `semanticChanges`, focused unit tests, and compatibility
   scenarios.

The stages may be commits or independently reproducible patches, but the
semantic review must be able to distinguish them. A formatter run must not be
combined with an authority, transaction, failure-channel, attempt-number, or
retry change and then described as mechanical.

## Provenance Validation Gate

DTE01-F must add a root command named:

```text
pnpm check:durable-task-source-map
```

Its owner is a root script, planned as
`scripts/check-durable-task-source-map.mjs`. The command must fail closed when:

- the map schema or reuse/license class is unknown;
- the pinned commit differs from `third_party/trigger.dev/SOURCE.json`;
- a mapped upstream path is missing or its SHA-256 differs;
- a non-discarded target is outside `packages/durable-task/`;
- two entries ambiguously claim the same symbol-to-target transformation;
- a target path or transformed test lacks attribution/map coverage;
- an adapted header names an unmapped commit or path;
- a discarded entry points into the admitted package;
- the package notice or either exact license copy is absent; or
- the admitted package omits the notice, map, or licenses from its distribution
  file list.

The checker validates provenance and map closure. It does not decide whether a
semantic adaptation is correct; the compatibility harness and focused tests
own that proof.

## Guarded Upstream Refresh

The frozen island is not updated in place by the package implementation. A
future refresh requires a separately approved source-import change that:

1. stages a new pinned Trigger commit in an isolated import location;
2. verifies that location with a newly generated complete checksum manifest;
3. compares every mapped upstream path and selected symbol against the old
   source map;
4. replays the mechanical projection without overwriting the accepted target;
5. presents the old upstream, new upstream, mechanical projection, and current
   Flarex adaptation as an explicit semantic review;
6. reruns the Trigger oracle and Flarex candidate compatibility lanes; and
7. updates target hashes, semantic changes, notices, and focused evidence only
   after review.

No install, format, code-generation, or compatibility command may fetch and
silently adopt a new upstream revision. A source hash change is a gate failure,
not an invitation to rewrite the accepted hash.

## Compatibility Harness Ownership

The compatibility harness is test infrastructure split across the two
dependency islands:

```text
integration/durable-task-compatibility/
  scenarios/v1/
  divergences/v1.json
  schema/
  compare receipts and orchestrate processes

third_party/trigger.dev/harness/
  run-attempt-v1 Trigger oracle runner

packages/durable-task/test/compatibility/
  run-attempt-v1 Flarex candidate runner
```

Scenario fixtures, schemas, divergence expectations, and the comparator are
Flarex-authored. The Trigger runner is outside `upstream/` so the frozen source
manifest remains meaningful. The Flarex runner stays under tests and is not an
export.

The root orchestrator later exposes:

```text
pnpm test:durable-task-compatibility
```

It starts two isolated child processes with explicit working directories:

- the oracle resolves through `corepack pnpm@10.33.2 --dir
  third_party/trigger.dev ...` and the island lockfile; and
- the candidate resolves through the root pnpm workspace and root lockfile.

The orchestrator imports neither runner. It passes a scenario on standard
input and receives exactly one receipt on standard output. Diagnostics use
standard error. Temporary directories, database state, module resolution, and
environment variables are not shared between runners.

The runner exit contract is:

| Code | Meaning |
| ---: | --- |
| `0` | one valid receipt was emitted |
| `2` | scenario failed schema or canonical-input validation |
| `3` | engine could not execute the accepted scenario |
| `4` | runner dependency, database, or environment bootstrap failed |

The comparator has a separate nonzero mismatch exit. CI can therefore tell an
invalid fixture, broken Trigger oracle, broken Flarex candidate, and behavioral
divergence apart.

## Versioned Scenario Contract

Both runners consume the same canonical JSON value:

```ts
type RunAttemptScenarioV1 = {
  readonly scenarioVersion: "flarex.run-attempt-scenario.v1";
  readonly scenarioId: string;
  readonly classification: "parity" | "flarex-authority";
  readonly initial: {
    readonly phase: RunAttemptPhaseV1;
    readonly attemptNumber: number;
    readonly retryPolicy: RetryPolicyV1;
    readonly computeClass: string;
    readonly cancellationGeneration: number;
    readonly leaseDurationMs: number;
  };
  readonly controls: {
    readonly databaseNowOffsetsMs: readonly number[];
    readonly jitterSamples: readonly number[];
    readonly generatedIdOrdinals: readonly number[];
  };
  readonly commands: readonly RunAttemptCommandV1[];
};
```

The schema owns a closed command union including start, successful completion,
failed completion, cancellation request, cancellation acknowledgement, lease
expiry, worker loss, heartbeat, and requested-effect delivery. Each command has
a monotonically increasing sequence and uses symbolic fence/effect references
instead of random database identifiers.

`databaseNowOffsetsMs` are offsets from a symbolic epoch. Runners never compare
real wall-clock timestamps. Jitter samples and generated ID ordinals make retry
and identity behavior reproducible. User payloads and results are represented
by fixed digest labels rather than raw data.

## Versioned Normalized Receipt

Each runner emits:

```ts
type RunAttemptCompatibilityReceiptV1 = {
  readonly receiptVersion: "flarex.run-attempt-receipt.v1";
  readonly scenarioVersion: "flarex.run-attempt-scenario.v1";
  readonly scenarioId: string;
  readonly engine: "trigger-oracle" | "flarex-candidate";
  readonly steps: readonly {
    readonly sequence: number;
    readonly commandType: RunAttemptCommandV1["type"];
    readonly disposition: "accepted" | "idempotent" | "rejected";
    readonly rejection?: RunAttemptRejectionV1;
    readonly runPhase: RunAttemptPhaseV1;
    readonly attemptNumber: number;
    readonly fenceOrdinal: number;
    readonly retry?: {
      readonly decision: "none" | "immediate" | "durable";
      readonly delayMs: number;
      readonly computeClassChanged: boolean;
    };
    readonly cancellation?: {
      readonly generation: number;
      readonly phase: CancellationPhaseV1;
    };
    readonly evidence: readonly NormalizedEvidenceV1[];
    readonly requestedEffects: readonly NormalizedEffectV1[];
    readonly terminal?: NormalizedTerminalOutcomeV1;
  }[];
};
```

Evidence and requested effects have scenario-local ordinals, closed semantic
kinds, and controlled duration offsets where applicable. Terminal receipts use
normalized error classes and result digests. The exact schema excludes:

- wall-clock timestamps and database-generated identifiers;
- stack traces, host paths, process details, and dependency versions;
- raw task payloads, results, secrets, and unbounded error values;
- Prisma rows, Drizzle rows, Redis keys, and lock tokens; and
- incidental event serialization or log messages.

Arrays retain semantic execution order. JSON object keys are serialized in the
schema-defined canonical order. The receipt is parsed again by the root schema
before comparison; runner TypeScript types alone are not trusted.

## Comparison And Deliberate Divergence

For `parity` scenarios, the comparator removes only the top-level `engine`
label and requires canonical structural equality. There are no wildcard ignore
paths and no tolerance for an unspecified field.

`flarex-authority` scenarios use `divergences/v1.json`. Each difference names:

- scenario ID;
- exact JSON Pointer;
- expected Trigger value or unsupported-oracle outcome;
- expected Flarex value;
- authority/correctness rationale; and
- owning roadmap and focused test.

The divergence manifest cannot ignore a parent object or array. A new or moved
difference fails until explicitly reviewed. This prevents normalization from
hiding stale fences, reordered effects, lost attempt increments, or different
retry decisions.

## Required Scenario Matrix

The first executable harness must cover these upstream parity scenarios:

| Group | Scenarios |
| --- | --- |
| completion | successful first attempt; retryable immediate failure; retryable durable failure; non-retryable terminal failure |
| ceilings | configured retry exhaustion; global attempt ceiling |
| cancellation | cancellation before execution; request while executing; acknowledged final cancellation |
| recovery | worker loss with retry; pending-start timeout and requeue; stale heartbeat no-op |
| compute | OOM escalation; same-class/no-escalation; OOM exhaustion |

These are Flarex authority scenarios rather than falsely claimed parity:

| Group | Scenarios |
| --- | --- |
| fencing | duplicate start on the same fence; competing start; stale completion; conflicting completion |
| idempotency | identical completion after a lost response; duplicate requested-effect delivery |
| races | lease expiry versus completion; cancellation generation versus completion |
| atomicity | transition committed before effect delivery; delivery resumes after host failure |
| failure truth | corrupt retry configuration versus unavailable store |
| time authority | database time accepted while host clock is skewed |

An unsupported Trigger oracle outcome is itself a typed harness result for a
`flarex-authority` scenario. It must not be converted into a fabricated Trigger
receipt.

## Two Evidence Lanes

The harness has two bounded lanes:

1. The deterministic policy lane uses controlled stores and clocks to compare
   transition, retry, cancellation, evidence, and requested-effect semantics.
   It is the normal compatibility suite.
2. The integration lane runs only persistence/coordination scenarios whose
   claim depends on a real transaction, concurrent writer, lease, or lost
   response. The Trigger runner uses only the frozen island's own supported
   Postgres/Redis test setup. The Flarex runner uses the persistence adapter's
   supported PGlite/Postgres test setup.

The policy lane must not claim database atomicity. The integration lane must
not normalize away commit order, conflict disposition, or effect-intent
durability.

## Production Exclusion

The harness is comparison evidence, never a runtime fallback:

- no production package exports its fixtures, runner, comparator, or Trigger
  receipt types;
- no deployable app imports `integration/durable-task-compatibility`;
- no active package imports `third_party/trigger.dev` or `@trigger.dev/*`;
- no production route executes both engines, dual-writes, shadows, or falls
  back to Trigger; and
- DTE01-F must inspect both import graphs and Worker bundles for these paths and
  package names.

## DTE01-D/E Exit Decision

DTE01-D and DTE01-E are accepted because:

1. every admitted transformed source/test has a package-local attribution and
   license route independent of the frozen oracle;
2. semantic changes are reviewable separately from mechanical projection;
3. a later upstream refresh cannot rewrite accepted adaptations silently;
4. both runners use one closed scenario schema but resolve different lockfiles
   in isolated processes;
5. normalized receipts compare lifecycle meaning rather than ORM, Redis,
   timestamp, or identity noise;
6. deliberate Flarex corrections are exact, named divergences; and
7. the harness is structurally excluded from production authority.

The remaining DTE01 work is DTE01-F executable source-map, dependency/import,
bundle, and test-lane gates followed by the DTE01-G final package admission
decision.
