# Mechanism: Effect stack-trace detection before Worker hardening

Design status: **Accepted** within the authorized Worker host adaptation.
Implementation status: **Implemented at the build owner and in the generated artifact**.
Measurement status: **Actual Worker regressions validated locally; no capacity/throughput claim**.

## Ownership and decision

The Application Worker build owns this realm-initialization adaptation. The
portable database and `ApplicationWorkerCore` error contracts retain their owners.
The coordinator authorized the narrow correction after actual Worker invalid-ID
and table-capacity refusals encountered an unrelated `TypeError` while constructing
their intended errors. No durable data or application schema changes are involved.

## Pinned mechanism and installed dependency

Convex revision `db914cf06e2b06ee985646611b9e12ed7a770318` remains the database
reference. It has no Effect initialization mechanism to translate: this record
covers the TypeScript host needed to preserve ordinary catchable failure behavior.

The installed `effect@4.0.0-rc.112` source
`src/internal/stackTraceLimit.ts` detects writability once at module evaluation.
For a present property it checks the writable flag or setter; for an absent
property it checks whether `Error` is extensible. Its cached flag controls later
assignments to `Error.stackTraceLimit`. `src/Schema.ts` temporarily sets that
property to zero and restores it when constructing `SchemaError`; Data error
construction also consumes the same tracing machinery.

`ApplicationWorkerCore.ts` imports these modules before its intrinsic hardener
freezes `Error` and its prototype. A cached writable flag therefore becomes stale.
The root's connected Worker witnesses exposed this ordering defect; the ordinary
failure owner and its typed classifications are still correct.

## Why a difference is necessary

The Worker executes untrusted code after hardening JavaScript intrinsics. Keeping
`Error` writable would weaken that boundary. Catching the resulting `TypeError`
would hide the intended refusal and repairing individual adapters would duplicate
the shared defect. Modifying Effect internals would create a dependency fork.

The smallest correction is to make only `Error.stackTraceLimit` immutable before
Effect observes it, so Effect's existing frozen-environment guard chooses its
supported no-op behavior. The later complete constructor/prototype hardening is
unchanged.

## Replacement mechanism

A code-owned [bundle entry](../../../../packages/flarex-backend/scripts/ApplicationWorkerCoreEntry.ts)
imports a dependency-free [prelude](../../../../packages/flarex-backend/scripts/ApplicationWorkerStackTracePrelude.ts)
before re-exporting the actual Application Worker core. Static module dependency evaluation orders
the prelude before the core's Effect dependencies. The bundler emits one chunk
without external or dynamic imports; its build guard also verifies that the
prelude has retained executable code. No generated code is searched or patched.

The prelude captures trusted realm intrinsics before untrusted execution. It
preserves an existing stack-trace-limit value and installs it as a non-writable,
non-configurable own data property. If absent on an extensible constructor, it
installs an immutable `undefined` value. An absent property on an already
non-extensible constructor already produces Effect's false guard and needs no
mutation. Unsupported incompatible non-configurable descriptors fail startup.
No helper, setter, database capability, or mutable global is exported.

## Preserved and changed guarantees

Application refusals remain catchable at their original owners. Error constructors
and prototypes still undergo the original full hardening. Transaction ownership,
OCC, persistence, rollback, authority, and error classification are unchanged.
The stack-trace-limit restriction takes effect earlier; Effect no longer
temporarily suppresses stack capture in this hardened realm.

## Required witnesses and remaining limits

The [owner test](../../../../packages/flarex-backend/test/applicationWorkerStackTracePrelude.test.ts)
bundles the installed Effect implementation behind the real
prelude and constructs Schema/Data errors after freezing `Error` and its prototype.
It covers an existing writable limit, an absent limit, and an already frozen
constructor, verifies immutable descriptors, and preserves the existing value.
The actual core builds twice identically with its export/import and
size guards. The root must regenerate the artifact and rerun the connected
Worker invalid-normalization and caught-capacity witnesses. These are runtime
interop checks, with no database, production capacity, or throughput claim.
