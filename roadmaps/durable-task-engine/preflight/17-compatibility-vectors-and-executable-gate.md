# DTE03-F: Compatibility Vectors And Executable Contract Gate

## Receipt Status

**Status:** Complete — the Roadmap 03 lifecycle model now has one canonical,
JSON-safe compatibility suite, one exact divergence manifest, and one
production-inert fail-closed checker. DTE03-G is the next checkpoint.

This receipt closes DTE03-F over the admitted DTE03-A source inventory,
DTE03-B aggregate, DTE03-C failure/retry policy, DTE03-D transition/race
tables, and DTE03-E outcome/evidence/effect/error contract. It does not admit
`packages/durable-task/`, execute a Trigger runtime from active Flarex source,
or authorize Roadmap 04 persistence and Roadmap 05 host work.

## Created Evidence

DTE03-F creates these Flarex-owned, production-inert artifacts:

- [`run-attempt-lifecycle.json`](../../../integration/durable-task-compatibility/scenarios/v1/run-attempt-lifecycle.json)
  contains 65 canonical mutation/receipt/error vectors and fourteen inspection
  projection cases;
- [`v1.json`](../../../integration/durable-task-compatibility/divergences/v1.json)
  contains 37 exact, scenario-and-JSON-Pointer-bound semantic differences;
- [`check-durable-task-lifecycle-vectors.mjs`](../../../scripts/check-durable-task-lifecycle-vectors.mjs)
  validates the suite, divergence manifest, and accepted Trigger source map as
  one closed contract; and
- [`check-durable-task-lifecycle-vectors.test.js`](../../../scripts/check-durable-task-lifecycle-vectors.test.js)
  proves that the gate fails on missing rows, effect drift, invalid policy
  correlation, false source classification, dangling divergence pointers, and
  removed Trigger/host/persistence fields.

The root command is:

```text
pnpm check:durable-task-lifecycle-vectors
```

It is included in `test:scripts` and its JavaScript is included in
`typecheck:scripts` under strict check-JavaScript validation.

## Canonical Vector Contract

The suite pins:

```text
schemaVersion   = flarex.run-attempt-vector-suite.v1
scenarioVersion = flarex.run-attempt-scenario.v1
receiptVersion  = flarex.run-attempt-receipt.v1
upstreamCommit  = f10bc23785e569e5d917318cf2033aabdbe96a0b
symbolicEpochMs = 2000000000000
```

Each vector has:

1. a stable scenario ID;
2. `parity`, `flarex-authority`, or `outside-first-vertical`
   classification;
3. one or more indexes into the accepted DTE01 source map;
4. explicit coverage claims;
5. a symbolic initial phase, cancellation state, and run version;
6. one of the five mutation operation names plus a symbolic canonical command
   identity; and
7. either a normalized receipt expectation or a normalized typed-error
   expectation.

An accepted or idempotent normalized receipt fixes its operation outcome,
transition name, accepted run version, database time, one evidence kind, exact
ordered effect kinds and sequences, and policy-decision summary where
applicable. A current receipt fixes one operation-specific current reason and
has no acceptance, evidence, effects, or policy record. A typed error has one
closed error tag and safe reason and likewise has no transition output.

These are compatibility projections, not a second aggregate encoding. Exact
domain fields remain owned by the DTE03-B through DTE03-E contracts and the
future package Schema. Symbolic fixture labels identify controlled state
variants without importing a database row, Prisma model, Drizzle result,
Trigger product object, or host authority.

## Closed Coverage

### Accepted Transition And Effect Coverage

The suite covers all 13 DTE03-E accepted transition/effect plans:

| Transition | Evidence | Ordered effect count |
| --- | --- | ---: |
| start grant | `attempt_granted` | 4 |
| first heartbeat | `heartbeat_accepted` | 4 |
| later heartbeat | `heartbeat_accepted` | 3 |
| active cancellation request | `cancellation_requested` | 3 |
| cancellation without active attempt | `cancellation_resolved_without_attempt` | 2 |
| successful completion | `completion_succeeded` | 4 |
| immediate retry completion | `completion_failed` | 5 |
| durable retry completion | `completion_failed` | 5 |
| terminal failed completion | `completion_failed` | 4 |
| acknowledged cancellation | `completion_cancellation_acknowledged` | 4 |
| lease-expiry retry | `lease_expiry_recovered` | 4 |
| lease-expiry terminal failure | `lease_expiry_recovered` | 3 |
| lease-expiry cancellation | `lease_expiry_cancelled` | 3 |

The checker requires the exact effect order, positive contiguous sequences,
one evidence member, and two-to-five effects. It also requires transition,
operation, and outcome agreement. Every accepted vector has an explicit prior
and resulting effect cursor, and every idempotent vector links to the original
accepted scenario and must reproduce its version, time, outcome, evidence,
effects, and policy exactly. The fixtures therefore prove first allocation,
later cursor offsets, stable replayed identities, and overflow rejection.

### Current And Inspection Coverage

Every DTE03-E current reason is present:

- start: stale version, early eligibility, and non-startable phase;
- heartbeat: inactive phase, stale attempt, stale fence, expired lease, and
  non-advanced sequence;
- completion: inactive phase, stale attempt, stale fence, and expired lease;
- cancellation: already requested and already terminal; and
- lease expiry: inactive phase, stale attempt, stale fence, stale lease
  version, and early wake.

The fourteen inspection cases are complete flattened normalized projections,
not phase labels. They cover initial and immediate-retry ready state, both
active phases with and without pending cancellation, durable retry, terminal
success and failure with and without superseded cancellation, and all three
terminal cancellation resolutions. Each fixes inspection/state versions,
symbolic run/revision identity, database observation time, run version,
phase/state variant, cancellation generation/resolution, attempt/lease/
heartbeat presence, eligibility/retry fields, terminal kind, result commitment,
and failure class. The checker requires every field and rejects illegal
phase/cancellation/result/failure correlations.

### Failure And Retry Coverage

The suite fixes:

- ordinary bound-policy retry with stored jitter;
- override-delay retry without jitter;
- failure-code-forced durable retry;
- delay-at-threshold durable retry;
- OOM escalation with a changed compute profile and durable delivery;
- pre-start and executing lease-loss forced-durable recovery;
- all six retry rejection reasons: cancellation requested, do not retry,
  attempt limit reached, failure never retry, OOM escalation disabled, and OOM
  target unchanged; and
- lease-loss terminal failure and cancellation without a false completion
  replay.

The checker prevents OOM or lease-loss retry from becoming immediate, prevents
non-OOM retry from claiming compute escalation, prevents override delay from
claiming jitter, and requires lease-expiry retry to use lease-loss eligibility.

### Replay, Race, And Error Coverage

Canonical cases include:

- duplicate/competing start with the stored original grant;
- exact heartbeat, cancellation, and expiry direct replay;
- identical completion replay in retry state and after a later attempt;
- failure-message-only completion redelivery returning the original terminal
  failure receipt;
- conflicting completion;
- cancellation acknowledgement without a request or with the wrong
  generation;
- heartbeat/completion at the logical deadline and completion/expiry races;
- old attempt, fence, and lease-version work;
- pending cancellation versus failure and pending cancellation versus expiry;
- effect delivery resumption without lifecycle re-authorization;
- malformed aggregate, completion replay, transition evidence, and stored
  effect sequence, plus unavailable and cross-scope-indistinguishable runs,
  transient store failure, terminal store failure, and sequence overflow; and
- command and store-cause redaction.

## Exact Divergence Rule

`parity` vectors cannot have a divergence entry. Every `flarex-authority` and
`outside-first-vertical` vector must have at least one entry in the divergence
manifest. Each entry fixes:

- the exact scenario ID;
- an exact, non-root JSON Pointer that must resolve in that vector;
- the Trigger behavior or unsupported-oracle result;
- the Flarex value;
- the authority/correctness rationale; and
- the owning roadmap receipt.

A broad ignored parent object is not permitted. A dangling pointer, missing
authority difference, difference attached to a parity vector, or difference
without a vector fails the gate.

The source classification also fails closed. Parity and Flarex-authority
vectors may reference only non-discarded source-map entries.
`outside-first-vertical` vectors must reference a discarded entry. The first
outside case pins waitpoint/enhanced-snapshot completion as unsupported rather
than adding Trigger-only state to the Flarex aggregate.

## Removed Field Gate

The recursive fixture check rejects these field names anywhere in scenario,
command, expected receipt, error, evidence, or effect projections:

```text
organizationId projectId runtimeEnvironmentId deploymentId queueId
workerId machineId redisKey prisma drizzle stack rawCause payload result
metadata
```

This is a narrow regression gate over the compatibility projection. It does
not claim that spelling checks alone establish trust, tenancy, redaction, or
Schema validity. DTE02 capability acquisition and DTE03-E typed contracts
remain the authorities for those properties.

## Executable Gate Boundary

DTE03-E asked DTE03-F for an executable pure-decision and Schema gate before
DTE03-G, while the same accepted roadmap forbids creating
`packages/durable-task/` before DTE03-G. Creating a temporary decision engine
outside its final owner would violate both the package gate and the reuse-first
strategy by introducing a second lifecycle implementation.

DTE03-F therefore closes the executable pre-admission gate at the contract
level:

```text
canonical JSON fixtures
  -> structural and semantic checker
  -> source-map and divergence closure
  -> DTE03-G admission audit
```

If DTE03-G chooses `admit`, the first DTE-IP01 implementation action is to
create the private package's exact Effect Schema and pure decision surface,
reuse/adapt the admitted Trigger logic, and run that candidate against these
same vectors. No store adapter, migration, route, queue, Worker, observability
API, or effect-delivery host may be added until the package Schema and pure
decision lane pass. This is the executable candidate gate; it is deliberately
after package admission and before persistence/host integration.

The frozen Trigger runner remains a later differential lane under the DTE01-E
two-process harness. DTE03-F does not install or boot its independent workspace
just to validate Flarex-owned JSON closure, and active Flarex code imports
neither the frozen workspace nor these fixtures.

## Production Exclusion

The vector suite, divergence manifest, and checker are test/roadmap evidence:

- they are outside every production package export;
- they are not lifecycle input, replay authority, fallback behavior, or a
  runtime status model;
- no deployable package imports `integration/durable-task-compatibility`;
- no active package imports `third_party/trigger.dev` or `@trigger.dev/*`;
- the checker reads the frozen source map but never executes Trigger; and
- no shadow execution, dual write, or comparison branch is introduced.

The existing `pnpm check:trigger-compatibility-boundary` remains the production
import/bundle gate. DTE03-F adds fixture correctness; it does not replace that
boundary proof.

## DTE03-F Exit Decision

DTE03-F is complete because:

1. every admitted mutation disposition/outcome family is represented;
2. every operation-specific current reason is represented;
3. all legal inspection phase/cancellation projections are represented;
4. all 13 exact accepted effect plans and evidence kinds are represented;
5. policy acceptance and every rejection reason are represented;
6. direct and completion replay, race, conflict, overflow, corruption,
   unavailable, store-failure, and redaction cases are represented;
7. deliberate differences are exact named data, not comparator ignore paths;
8. every vector is bound to the accepted Trigger source map;
9. removed Trigger product/host/persistence fields fail closed; and
10. the executable gate has positive and mutation-negative tests while
    remaining outside production authority.

## Exact Handoff To DTE03-G

DTE03-G must audit DTE03-A through DTE03-F as one lifecycle contract and choose
`admit`, `revise`, `defer`, or `reject`. It must verify:

- the type inventory across identity, aggregate, policy, transition, outcome,
  evidence, effect, error, fixture, and divergence contracts;
- that the 65 vectors cover the twelve lifecycle-model exit conditions in the
  owning roadmap;
- that DTE03-F did not substitute fixture labels for missing domain decisions;
- that the DTE03-E pre-admission/candidate-gate ordering correction is accepted;
- the exact first package files and reuse/transformation order if admitted;
- that DTE-IP01 remains private, production-inert, and store/host-free until
  its pure decision and Schema vector lane passes; and
- the explicit reopening triggers for DTE01, DTE02, and DTE03-A through F.

Do not create `packages/durable-task/` until that receipt says `admit`.

## Authority And Evidence

- [`../03-run-attempt-engine.md`](../03-run-attempt-engine.md)
- [`./12-current-lifecycle-and-transition-inventory.md`](./12-current-lifecycle-and-transition-inventory.md)
- [`./13-phase-terminal-and-aggregate-model.md`](./13-phase-terminal-and-aggregate-model.md)
- [`./14-failure-retry-and-attempt-policy.md`](./14-failure-retry-and-attempt-policy.md)
- [`./15-cancellation-heartbeat-lease-and-race-tables.md`](./15-cancellation-heartbeat-lease-and-race-tables.md)
- [`./16-operation-outcomes-evidence-effects-and-errors.md`](./16-operation-outcomes-evidence-effects-and-errors.md)
- [`./source-map.run-attempt-v1.json`](./source-map.run-attempt-v1.json)
- [`./03-provenance-and-compatibility-harness.md`](./03-provenance-and-compatibility-harness.md)
