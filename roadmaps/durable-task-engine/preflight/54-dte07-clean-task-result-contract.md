# DTE07 Clean Task Result Contract Preflight

Status: bounded implementation checkpoint completed privately on 2026-08-29.
The user approved the next prerequisite for a future `awaitTask()`: bind the
privately authorized canonical result body to the clean opaque `TaskRun` output
type without adding waiting.

Evidence snapshot: 2026-08-29 current repository state at commit `68d367fa`.

## Decision

Add one unversioned clean primitive:

```ts
readTaskResult(run): Effect<Output, ReadTaskResultError,
  StandardApplicationTaskResultQuery>
```

The operation first authenticates the process-local `TaskRun<Output>` handle,
then reads the canonical body through the completed scope-authorized result
query, validates that value against the output validator captured when the
Task reference was authored, and returns the inferred `Output` value.

```text
opaque TaskRun<Output>
  -> process-local handle inspection
  -> captured authored output validator
  -> Standard Application result query
  -> scope-authorized canonical result body
  -> protocol ValidatorJson shape check
  -> Output
```

This is an immediate read. An incomplete, failed, cancelled, absent, or
unavailable result remains a typed failure from the existing result-query
owners. The operation does not poll, sleep, subscribe, retry, cancel, or hide
terminal lifecycle state.

## Existing Validation And New Claim

The Application Task worker already normalizes the handler result into a
canonical Flarex runtime value and checks the selected canonical Task
manifest's output validator before result publication. `TaskResultStore` then
decodes and verifies the immutable canonical body when it is read.

This checkpoint does not duplicate either decoder and does not make local
authoring metadata activation authority. Its additional claim is narrower:
the canonical body observed through this opaque local run handle still agrees
with that handle's authored output contract. This catches stale or mismatched
local metadata before TypeScript narrows the value to `Output`.

The clean Task reference's private WeakMap state will retain the canonical
output validator already produced by its definition. The public reference and
run handles remain opaque and structurally unchanged. A forged structural run
continues to defect before service lookup or result I/O.

## Error Contract

At this checkpoint, `ReadTaskResultError` was the union of:

- the exact existing `StandardApplicationTaskResultQueryError` union, passed
  through without wrapping, retrying, or logging; and
- `ApplicationTaskResultContractError`, the existing
  `ApplicationResultContractError` family with `operation: "task"`, the
  protocol validator issue, and the authoritative canonical result value.

A later clean-root checkpoint under preflight 67 replaced the direct Standard
error member with `TaskReadError<"readTaskResult">`. The result-query owner
failure remains the exact opaque cause, while the local output-contract member
and all result-read authority stay unchanged.

The mismatch retains the canonical value because a stale local contract must
not hide completed durable work or suggest that the Task should be executed
again. Defects and interruption remain outside the typed failure channel.

An authored `returns: null` keeps the existing unclaimed `unknown` output type
and performs no local validator check. IDs use shape-only validation because
the authored table parameter is a host-neutral type hint, not active table-ID
authority. Task output inference therefore recursively projects authored
`Id<Table>` hints to runtime `string`, matching the existing clean function
result contract.

## Ownership

- `@flarex/application-definition` owns the opaque Task reference and its
  private authored output-validator metadata;
- `@flarex/application-invocation` owns the opaque Task run, the clean
  `readTaskResult()` operation, local result-contract validation, and output
  type narrowing;
- `@flarex/standard-application-invocation` retains the private result-query
  integration capability;
- `@flarex/durable-task` retains lifecycle authorization and result
  availability decisions;
- `flarex-backend` retains immutable result-object loading and canonical value
  decoding; and
- the captured Application scope and persistence owners retain database and
  authorization authority.

No owner accepts a caller-supplied commitment, validator, task ID, object key,
bucket, deployment selector, or database locator.

## Validation

Focused proof must cover:

1. genuine handles read by exact run ID and return a correctly inferred output;
2. the body is returned by identity after the local contract check;
3. a mismatch returns the Task-specific contract error with the original body;
4. a null output validator returns the canonical body as `unknown`;
5. a forged handle defects before result service I/O;
6. existing result-query errors cross one clean facade translation while
   retaining exact cause identity, and lower-layer identity/no-retry proofs
   remain green;
7. Task-reference inspection exposes immutable private validator metadata but
   does not change the public handle shape;
8. package boundary checks admit only the exact existing result-query subpath;
9. focused tests, package typechecks, Oxlint gates, and both standing reviews
   pass before commit.

## Stop

`readTaskResult()` and its private metadata, error, test, boundary, and roadmap
updates are complete. Stop at this boundary after validation, review, and
commit.

Do not add `awaitTask()`, polling, sleep, subscriptions, cancellation,
terminal-failure projection, retry policy, list/cursor/event APIs, HTTP routes,
SDK compatibility, deployment, or production activation in this checkpoint.
