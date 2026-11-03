# Native Order Archive and Completion on Core

Status: **Both admitted roots migrated. Bounded paired acceptance complete.**

Flarex baseline `09886ec34c06e9163bad3a6f0716854b33472015`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`. Executing Medusa fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

Migrate the two complete admitted ordinary roots, Archive and Completion.
Each accepts zero to four raw existing Order IDs. Both share the full
preserve-mode Order producer, the native status repository and receipt
logic, and the Core workflow transaction and event owners. Retain separate
forward and inverse grants. Completion also lends its existing finite
hook the same confined resources. The private profiles admit neither
creation and generated serials nor checkout, payments or hosted activation.

## Independent findings and convergence

- Current-core inspection found both roots already take the existing installed
  workflow module and execution ports. The two dedicated fixtures still select
  Legacy settlement. Their real callers and the neighboring receipt and serial
  seed imports identify the fixture and caller replacement boundary. The shared
  Legacy Order fixture still has creation, checkout and generated-serial
  callers. Finance uses its seed types and has its own installation. There is
  no identified populated data conversion for these two roots.
- Pinned Convex `database/src/writes.rs` coalesces each row's first original
  and final value while accounting for each attempt. `database/src/transaction.rs`
  owns the outer finalization and checkpoints. The nested call in
  `isolate/src/environment/udf/async_syscall.rs` lends the transaction and
  rejoins before settlement. `database/src/committer.rs` validates published
  and pending conflicts and publishes in order. `application_function_runner`
  checks a committed result before entering the body and saves outcomes in the
  same transaction. Retain these mechanisms in the translated Core.
- The accepted-direction challenge confirmed that Legacy fact and change-table
  shapes are private test observations. Prove stable logical rows, exact
  revisions and indexes, authenticated event families and deliveries, and
  durable outcomes at their current Core owners. Do not reproduce Legacy
  rows in the test adapter. The admitted maximum uses the ordinary native
  budget and the existing exact-snapshot admission cache.

The cross-challenge distinguished a present soft-deleted Address from a
missing physical row. Ordinary native foreign-key validation preserves the
existing target identity through an unconditional index. The returned Order
DTO preserves ID-only references and grants no Address hydration. The same
status forward and inverse are patches on retained active Orders. They use
pending write coalescing and require no deleted-row reconstitution.

The [native root contract](../divergences/native-root-participation.md) owns
sticky failure and one settlement. A caught refused hook operation must
poison the root. This preserves the existing native difference from Convex's
catchable nested rollback. The existing [foreign-key contract](../divergences/native-relational-foreign-keys.md),
[non-null backing](../divergences/native-non-null-index-backing.md) and
[event and delivery contract](../divergences/native-durable-event-delivery.md)
cover the remaining mechanism differences. Source guards retain the prior
approved Archive step correction. No new Core divergence was identified.

## Replacement and acceptance

| Contract | Witness |
| --- | --- |
| Archive | Keep the primitive status preimage from before archive mutates the returned objects. Preserve archive workflow messages before internal update events and accept the genuine completed, canceled and draft inverses. |
| Completion | Keep the native eligible statuses and canceled refusal. Prove module update events precede completion messages and the hook sees pending completion. Preserve the empty hook branch, finite context revocation and sticky refusal of unauthorized sibling resolution, extra messages or writes. |
| Both | Raw duplicate request IDs remain in ordered messages. Native writes and events describe the actual selected rows. Preserve pre-write forward DTO timestamps, newly written inverse timestamps, historical references, serials, complete values and same-status writes. |
| Settlement | Prove genuine later inverse, same-root forward and inverse with one final revision per row, late parent rollback, and independently scoped requests with equal external IDs. Replay canonically valid but malformed results through the real durable DTO decoder after reopening. Lose acknowledgement after the genuine hooked completion and reconcile with one invocation, one hook and one publication. |

Reuse the shared Core Order fixture and the executing Order Source evidence
owner. Remove the two dedicated Legacy fixtures after moving workflow and
seed callers. Retain the existing source guards and authenticated receipt
logic. Run the 38 workflows per database, with lost acknowledgement in the
maximum Completion case, plus 34 receipt cases, Source proof and adjacent Order Change
regressions. Require ordinary-role PostgreSQL and PGlite, relevant fast
typechecks, promotion and portability guards, lint and both reviews.
