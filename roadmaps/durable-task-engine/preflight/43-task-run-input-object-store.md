# Preflight 43: Task Run Input Object Store

## Status

**Decision:** One private, production-inert Task-owned input-store sequence is
accepted. TRI1 is implemented as a narrow immutable publish/read adapter over
the existing immutable R2 byte-store core and `TaskInputReferenceV1`. TRI2 is
implemented as a narrow coordinator that publishes through TRI1 before calling
the existing run-creation capability. Neither checkpoint adds another input
format, table, reference, tenant router, bucket API, or deletion path.

The coordinator preserves the existing request key and creation receipt as the
only database idempotency authority. It remains a private generic capability;
no located host supplies it and launch still has no input reader.
No Task provider, Worker Loader, route, Queue, Cron Trigger, binding,
deployment, or production activation is admitted here.

## Why This Owner Is Required

The current Task System already owns:

- canonical Flarex Value V1 input bytes and SHA-256 evidence;
- `TaskInputReferenceV1`, including the fixed object-store identity, derived
  content-addressed key, 32 MiB canonical-byte ceiling, and `run_lifetime`
  retention marker;
- exact run-creation request/replay semantics; and
- PostgreSQL columns that persist only the immutable reference.

It does not yet own the referenced body. Consequently, DTE06-D1 can expose only
a fake exact-input capability and DTE06-D3 cannot safely launch a real runtime.
The missing capability is an input-body store, not another run schema or
provider payload.

## Ownership Decision

| Concern | Owner |
| --- | --- |
| Value domain and canonical bytes | `flarex-protocol/value` |
| Input reference, key, maximum, retention spelling | `@flarex/durable-task/internal/run-creation-v1` |
| Conditional immutable create, reconciliation, bounded read | backend `immutableR2` owner |
| Task-specific publish/read errors and narrow bucket adaptation | new backend Task input-store adapter |
| Scope, definition, request-key idempotency, run row | existing persistence run-creation owner |
| Located bucket/database composition | later private host/system-test owner |
| Run deletion and last-reference reclamation | later Task retention/GC preflight |

The adapter receives one already located bucket capability. It never accepts a
scope, customer, tenant, bucket name, arbitrary object key, raw R2 binding, or
credential from the caller.

## Fixed Contract

Publishing:

1. canonicalize the supplied value through the protocol-owned Flarex Value V1
   Effect adapter;
2. reject canonical bytes outside `MAX_TASK_INPUT_CANONICAL_BYTES_V1` before
   touching R2;
3. derive the only legal `TaskInputReferenceV1` from the canonical SHA-256 and
   byte length;
4. call the existing immutable byte-store core with no-replace create;
5. reconcile a rejected or repeated create by exact key, length, bytes, and
   digest; and
6. return an owned copy of the exact reference only after storage converges.

Reading:

1. strictly decode and defensively own the supplied `TaskInputReferenceV1`;
2. read only its derived key from the already located bucket;
3. enforce exact stored size and the protocol maximum before body allocation;
4. hash and compare the complete body;
5. decode and re-canonicalize the Flarex Value V1 evidence; and
6. return owned canonical bytes plus the decoded value without exposing the
   bucket or a generic key reader.

Missing bodies, key collisions, size/digest mismatch, malformed canonical
evidence, body-budget overflow, resource failure, and unresolved create
settlement remain distinct typed failures. Foreign cryptographic/runtime
defects are not normalized into invalid input.

## Publication And Run-Creation Ordering

The connected creation owner must perform:

```text
caller value
  -> canonicalize and publish immutable input
  -> obtain exact TaskInputReferenceV1
  -> build exact TaskRunCreationRequestV1
  -> existing scope-bound createRun transaction
```

The database transaction must never commit a reference before the object-store
operation has converged. R2 cannot participate in the PostgreSQL transaction,
so failure ordering is intentionally conservative:

- object failure: do not call `createRun`;
- object success then database failure: retain the unreferenced immutable body;
- unknown database settlement: replay the same request key and exact reference;
- exact replay: converge on the same object and existing run receipt; and
- conflicting request-key replay: preserve the existing run-creation conflict.

The connected coordinator must not compensate by deleting an object. The same
content-addressed body may already be referenced by another run, and the
database outcome may be unknown.

## Retention And Deletion

`run_lifetime` means the object remains readable for every non-deleted run and
every retained terminal run. This checkpoint provides no delete operation and
no automatic expiry.

Completion, failure, cancellation, retry exhaustion, attempt expiry, definition
replacement, application revision movement, or activation movement never
authorize input deletion. A later retention/GC preflight must define:

- the authoritative run deletion/tombstone state;
- the complete supported retained-run window;
- last-reference proof for shared content-addressed inputs;
- scan/index and retry bounds;
- object-delete settlement and replay;
- races with launch/read and run restoration; and
- hosted R2 lifecycle-policy interaction.

Until that gate closes, leaked unreferenced input bodies are acceptable;
deleting a referenced or uncertain body is not.

## Ordered Checkpoints

### TRI1: Narrow Immutable Store — Complete

- implement the backend Task input publish/read adapter over `ImmutableR2ByteStore`;
- reuse the protocol canonicalizer and durable-task reference decoder;
- prove exact replay, rejected-after-write reconciliation, collision,
  uncertainty, missing/corrupt bodies, ownership, byte limits, and hostile
  references in memory;
- prove the same private binding in Miniflare; and
- export only an internal production-inert subpath guarded by the Trigger
  compatibility checker.

### TRI2: Run-Creation Composition — Complete

- compose TRI1 publication before the existing located `createRun` capability;
- preserve the existing creation request key and receipt as the only database
  idempotency authority;
- prove object failure short-circuits the transaction, DB rollback leaves an
  inert object, and unknown commit replays exactly;
- use PGlite and genuine PostgreSQL for the connected transaction behavior;
  and
- keep all deployable host composition absent.

### TRI3: Located Launch Reader

- expose only the exact-reference reader to the SAP-TRP6 located launch source;
- correlate the same trusted scope used for runtime publication/readiness and
  run persistence;
- prove wrong-scope/bucket configuration, missing/corrupt input, deadlines,
  ownership, and connection/resource settlement; and
- unblock DTE06-D3 only when SAP-TRP6 and TRI2/3 both close.

## Validation Gates

- durable-task reference and canonical-value contract tests;
- backend typecheck and focused memory/Miniflare store tests;
- no raw bucket/key/credential export;
- Trigger compatibility and bundle/import boundary checks;
- PGlite plus genuine PostgreSQL for TRI2 transaction/replay behavior;
- hosted R2 proof before any production availability or limit claim; and
- both required project reviewers before significant code commits.

## Non-Goals

This preflight does not authorize:

- changing `TaskInputReferenceV1` or the run tables;
- storing input bytes in PostgreSQL;
- widening `TaskComputeDispatchRequestV1` with raw input;
- passing a general R2 binding to task code;
- a generic blob/object-store public API;
- input mutation, overwrite, aliases, fallback keys, or multi-store lookup;
- deletion, TTL, lifecycle rules, GC, or terminal-run reclamation;
- task output/result storage;
- Worker Loader/provider/settlement/supervision composition; or
- route, Queue, Cron Trigger, binding, deployment, or production activation.

## Stop Boundary

TRI1 stops at a private immutable Task input adapter. TRI2 composes that adapter
before the existing run-creation port and proves conservative replay across the
immutable-object and database boundary without adding compensation or a second
idempotency owner. The composition is still production-inert and unlocated.
TRI3 must connect only the exact reader to SAP-TRP6. DTE06-D3 remains blocked
until that connected gate closes.
