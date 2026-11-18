# Protected native Worker context

Status: **Selected private profile adaptation and actual Worker proof complete;
broader developer/native composition remains gated.**
Owner: [Native Product slice](../slices/16-native-product-links-and-references.md).

## Pinned mechanism and need

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318` executes an
authenticated registered function with a confined database/syscall context.
It has no `ctx.privateMixed` or borrowed Payload/Medusa participant counterpart.
The selected private Flarex profile needs those native calls and ordinary
Application operations to share the existing Core root without lending its
transaction, claim, persistence, or settlement capabilities to application code.

## Replacement and guarantees

[PrivateNativeApplicationWorker](../../../../packages/flarex-backend/src/artifactRuntime/PrivateNativeApplicationWorker.ts)
translates only the selected authenticated registration's handler context and
delegates execution to the unchanged `executeApplicationTransactionWorkerV1`
kernel. It preserves registration metadata, validators, visibility and the
original handler. The trusted backend captures the selected source, command and
policy bindings; application arguments cannot issue those bindings.

The private call method sends a bounded admitted-operation frame through one
captured RPC method. No raw receiver, database, root operation or finalizer
reaches the handler. Native calls and Application point calls must be sequential.
Caught or dropped native failures remain sticky, and admitted pending operations
drain before handler completion. The existing host callback session separately
serializes and drains callbacks, preserves full failure Causes, and applies its
normal cancellation and admission limits.

The dedicated checked private artifact is produced by the same
[Vite generator](../../../../packages/flarex-backend/scripts/buildApplicationWorkerCore.ts)
with the `private-native` profile and a separate entry/output. It does not replace
or modify the public generated artifact. This is context/transport adaptation,
not another Core engine or an application-visible framework API.

[CoreNativeApplicationMutation](../../../../packages/persistence-postgres/src/application/coreNativeMutation.ts)
retains the existing source/program/grant checks and the sole Core
claim/resolve/recover/commit owners. It drains Worker/native scopes before the
single trusted commit and never retries native callbacks. Historically committed
disclosure precedes fresh native admission as specified by the
[outcome recovery divergence](./native-protected-outcome-recovery.md).

## Cost, proof and limits

The profile adds a private artifact and one confined RPC method, plus registration
context translation and pending-operation tracking. Default direct native and
ordinary Application execution remain separate profiles.

The selected profile binds the canonical signed identity/access-policy digest
before grant or native admission. A genuine policy for a different principal
cannot borrow the profile's captured Payload principal. Existing correlation
still commits that actual digest; historical disclosure keeps its separate
authenticated request contract.

Explicit Product target disclosure uses the existing private participant-read
selection frame and opaque issuer. The native binder checks the issued selection
against the actual Core-issued protected root contract, captured principal,
source/scope/revision, exact read command and current bounded lifetime. Only
selected IDs reach the supplied genuine Product retrieve callback in the same
root. Source reads, assignment, retention and reverse enumeration do not imply
this target-read grant. An empty target selection refuses even when enumeration
is allowed. No global row ACL, new transaction owner or request lifetime is
introduced; the displaced attempt binder retains its original frame bytes until
its named consumers migrate.

Required proof uses the actual generated Worker, genuine analyzed Application
program and signed grant, real Payload Local API and Product service, and the same
outer Core root. It includes caught/dropped failures and drain/cancellation,
tracked permission changes, source/target visibility separation, opaque reverse
continuations and bounded scans, and lost acknowledgement followed by withdrawal
and cold recovery without Worker/native replay. Pure checks or a successful
generated build alone do not establish these runtime guarantees. The selected
Application grant conservatively consumes its table validator; no field-level
validator footprint is claimed.
