# Private Scalar Relational Transaction And Store

## Status And Outcome

Status: accepted and implemented privately, with focused PGlite and ordinary-role
PostgreSQL coverage. The accepted direction remains
[shared transaction ownership](./14-transaction-execution-profiles.md).

The implementation supplies one private synthetic reserved-relational transaction from authenticated
installation selection through scalar store operations, pending-write reads,
nested reuse and physical rollback. Also prove successful read-only settlement.
This closes the transaction/store portion of the synthetic shared-core gate.
It does not complete receipt-family admission or successful data publication.

The first runtime profile is synthetic `system`, using the implemented
non-serving selection. The synthetic Medusa binding remains binding evidence;
it does not admit a commerce store, Medusa package execution or adapter. Payload
content continues to use Application storage. No production host, public
subpath, generic transaction callback, schema migration or durable command
ledger is added.

## Source Findings And Alternatives

| Current source | Consequence |
| --- | --- |
| [`ScopeExecution.ts`](../../../packages/persistence-postgres/src/scopeExecution/ScopeExecution.ts) takes the scope clock before invoking a registered operation; [`ScopedTransaction.ts`](../../../packages/persistence-postgres/src/scopeExecution/ScopedTransaction.ts) retains `AppRowTransaction` and a read/write mode. | Keep the Application path. Its token does not authenticate relational owner, table or installation authority, and its operation failures do not themselves establish rollback-only nesting. |
| [`binding/host.ts`](../../../packages/persistence-postgres/src/frameworkSchema/binding/host.ts) resolves exact database/placement authority and locks scope before installation availability; [`selection.ts`](../../../packages/persistence-postgres/src/frameworkSchema/binding/selection.ts) authenticates tokens by transaction and target identity. | Reuse the binding owner's accepting-transaction validation. A previously returned frame or copied token cannot authorize a new transaction. |
| [`locatedReadCommittedEffect.ts`](../../../packages/persistence-postgres/src/locatedReadCommittedEffect.ts) starts the body through `Effect.runPromiseExit` and waits for its Promise uninterruptibly. [`drizzleStatementEffect.ts`](../../../packages/persistence-postgres/src/drizzleStatementEffect.ts) does not cancel the underlying SQL Promise when interrupted. | Neither an outer Effect timeout nor an interrupted caller establishes callback interruption, stopped SQL or completed rollback. The new host needs an explicit lifetime bridge and active-statement draining policy. |
| [`postgresLocatedReadCommitted.ts`](../../../packages/persistence-postgres/src/postgresLocatedReadCommitted.ts) distinguishes callback rollback, cleanup failure and uncertain settlement, and discards unsafe acquired connections. | Preserve this settlement provenance. A timeout or rejection is not automatically confirmed rollback. |
| [`artifact/postgresControlSession.ts`](../../../packages/persistence-postgres/src/frameworkSchema/artifact/postgresControlSession.ts) already handles active-work cancellation and quarantine for artifact control sessions. | Use its lifecycle evidence when implementing the data boundary; do not grant the data host artifact recovery or migration authority, or copy the complete control coordinator. |
| [`RelationalPhysicalLayout`](../../../packages/persistence-postgres/src/relationalSchema/physical/model.ts) carries owner-qualified identities, physical names, the scope column and constraints. | Resolve tables and columns from authenticated installed layout; callers never supply physical identifiers or SQL. |
| The pinned Medusa [decorator](../../../third_party/medusa/upstream/packages/core/utils/src/modules-sdk/decorators/inject-transaction-manager.ts) and [DAL wrapper](../../../third_party/medusa/upstream/packages/core/utils/src/dal/utils.ts) reuse a supplied manager. | Prove borrowed reuse without nested settlement now; retain actual framework adaptation and conformance for their gates. |

Convex's checked-in `crates/database/src/transaction.rs` at the repository root
keeps pending writes and nested state under one transaction, with explicit
subtransaction commit/rollback and `require_not_nested`. Preserve the mental
model that inner completion does not publish the outer transaction. This slice
deliberately uses PostgreSQL pending-write visibility and rollback-only nesting;
it does not port Convex's in-memory nested-write engine or claim savepoints.

Reject a rewrite of the Application journal or scope host: no working consumer
needs rerouting for this proof. Reject calling a second transaction from inside
`withSynthetic`: that would lose the selection's transaction identity and locks.
Reject a successful test-only data commit: synthetic rows have no admitted fact
family and cannot bypass common publication.

## Authority And Composition

The source-private `src/relationalTransaction/` owner separates
model/errors, owned data capture, physical session, lifetime, scalar store and
host composition. It uses explicit
factory instances for dynamically repeated hosts and transactions, rather than
a singleton transaction Context service.

The host accepts an authenticated target/authority composition and exact
synthetic installation reference. The binding owner supplies a narrow internal
accepting-transaction operation which validates that reference on the host's
actual transaction and returns the restored installation/layout. Existing
`withSynthetic` delegates to the same validation. This is internal composition,
not an adapter registration API or a callback exposed to application code.

After admission, mint an opaque owner/table capability with module-local runtime
identity. Pin transaction identity, target, deployment/scope, physical placement,
generation/fence/epoch, installation/readiness/availability digests, owner,
table allowlist and limits. A registry installed by trusted composition admits
only fixed test commands; command invocation accepts data, not caller-authored
callbacks. The fixed commands may exercise nested calls through the same host.

Command input and output are bounded owned JSON data; a void output is allowed.
Descriptor-based capture rejects accessors and unsupported objects, detaches
nested values, preserves special property names, and bounds depth at 64. It
does not measure one caller-owned view and encode another. Command input types
are invariant across registration. Live capabilities are not command results.

Every store call authenticates a live transaction and its exact table token.
Reject forged, copied, foreign-host, cross-transaction, cross-scope, closed and
missing tokens. A missing borrowed token never invokes standalone access.
Do not expose raw Drizzle, `pg`, physical names, arbitrary SQL, a finalizer or
an operation-registration hook to the command consumer.

## First Operation Profile

Use a small synthetic schema with a text primary key, text value, unique text
key and a checked integer. It has no residual persistence capabilities. Do not
substitute the existing Currency-shaped fixture: its numeric companion,
managed timestamps, search and soft-delete requirements need their own store
profiles, even when its owner is synthetic.

The admitted store operations are:

- get by the complete primary key, returning an optional owned row;
- list a bounded page, optionally by one scalar equality predicate, ordered by
  primary key with an exclusive primary-key continuation value;
- insert one row, update explicitly supplied mutable scalar columns by primary
  key, and delete by primary key, returning the affected owned row or absence.

Only text and integer columns in the exact admitted schema are supported.
Scope is injected by the host into every predicate and insert. Updates cannot
change scope or primary key. Inputs are captured and checked before SQL; values
are parameterized and names come only from the installed layout. Constraint
errors retain SQLSTATE internally for later adapter translation. Missing rows
are ordinary results; invalid inputs and constraint violations are failures.

No joins, numeric/JSON/timestamp coercion, generated keys, upsert, batch mutation,
soft delete, restore, custom query, foreign-key mutation or relation replacement
is admitted. These remain explicit operation-profile extensions driven by the
later Currency and link consumers, not silently unsupported branches of a
universal query language.

Initial ceilings: 64 combined command/store calls, nested command depth 8,
32 rows per page, 256 returned rows
per command, 16 columns per table, 64 KiB per encoded row and 1 MiB total captured
input/output. Count failed calls and nested calls against the same budget.
Reject unsupported schemas before issuing any store capability. Enforce output
size before materializing unbounded rows; a JavaScript size check after fetching
an unrestricted SQL value is insufficient. Record actual statement counts and
timings as test output, not roadmap receipts.

## Transactions, Nesting And Locks

Use one READ COMMITTED transaction. A read can observe its own preceding writes;
there is no repeatable-read or phantom-free claim. Serialize store operations
within a command. Reject overlapping operations on one borrowed capability;
do not let parallel fibers race its budget, failure latch or settlement.

Retain the current acquisition order: resolve target without acquiring data
locks; begin/configure; acquire the scope clock FOR UPDATE and validate current
generation/fence/epoch; authenticate installation and hold availability FOR
SHARE; then access the admitted scoped data rows and their database constraints.
Synthetic selection has no Application or DataBindingSet head to lock. Adding
serving bindings later must retain the binding owner's complete accepting order.

Relevant existing paths remain: Application/scoped writes acquire scope first;
binding activation/admission acquires scope before its mutable evidence;
availability transitions lock their own head; additive migration locks base
availability before changing retained structures. The scalar host does not
acquire migration collision/lease locks or perform DDL. An exclusive availability
transition must wait for admitted work, and a later admission must observe its
new status. Prove the actual intersecting holders in PostgreSQL. This does not
claim a universal lock order for future relation or cross-owner operations.

Nested execution borrows the exact capability and cannot settle it. Maintain a
monotonic state machine: open, rollback-only, closing, closed. Any failed store
operation or failed nested invocation latches rollback-only before propagating
its Cause, including validation, constraints, resource failure, defect and
interruption. Catching that failure cannot restore authority. A later operation
refuses, and outer success still rolls back. Close all tokens before attempting
physical settlement. No savepoints, detached fibers or external effects are
admitted.

## Cancellation And Settlement Decision

The new relational lifetime bridge must link the command fiber to its caller,
stop new work on cancellation, and wait for active SQL plus rollback/cleanup
before reporting completion. Waiting uninterruptibly is appropriate only for
the finite settlement/cleanup section, not for the command body. Existing
Application callers retain their current bridge and semantics; sharing a helper
requires equivalent behavior and its focused regression proof.

Use a 10-second command budget, 1-second statement timeout and 500-millisecond
lock timeout in the initial profile. Statement and lock limits are configured
on the real transaction, with each new statement bounded by remaining work
time. Give cleanup a separately bounded budget. Native cancellation must either
drain the active statement and confirm rollback or destroy/quarantine the exact
connection; never release a still-busy connection as reusable. PGlite must
likewise retain its serialized instance lease until active work and rollback
settle. If its active work cannot be safely bounded, fail profile admission
rather than advertise a hard cancellation guarantee. The deadline is a trigger
for cleanup, not permission to return while cleanup continues invisibly.

The native session composes only the existing artifact control driver's initial
physical transaction operation, preserving tracked work, cancellation, drain,
quarantine and settlement classification without artifact or recovery authority.
Cleanup has a separate two-second budget. The test PGlite adapter owns one
serialized worker instance: a one-second statement watchdog terminates and
quarantines that exact worker when SQL cannot settle, and waits for termination
before reporting cleanup failure. Installed PGlite does not enforce the native
statement timeout; an ordinary in-process PGlite handle is not admitted as a
hard-deadline session. Normal cancellation retains the lease through rollback.

Successful read-only work may settle normally. Set a non-clearable mutation
attempt marker before issuing any data-changing statement, including one that
ultimately affects zero rows. With this profile, a marked transaction always
fails outer completion with `unadmittedFinalization` and rolls back. Catching
that error inside a nested call cannot authorize commit. The marker is private
lifetime state, not a mutation receipt or a new publishable fact family.

Preserve separate outcomes for confirmed callback rollback, resource/acquisition
failure, cleanup failure and uncertain settlement. There is no automatic retry
of a command and no command-idempotency ledger. No mutation is allowed to reach
COMMIT, so this slice does not implement committed-write recovery. A lost
read-only COMMIT response may still be reported as uncertain; it must not cause
blind replay or a fabricated success. Typed receipts, command idempotency and
write-outcome recovery remain in the commit-owner capability.

## Existing-Code Disposition

| Area | Disposition |
| --- | --- |
| Application journal, OCC, rows, relation mutations, scope-clock ownership and publication | Keep; no rerouting or lock movement. |
| Binding synthetic acceptance | Port its exact validation into one binding-owned internal operation; retain the current facade and refusal behavior. |
| Installed layout and scalar/constraint definitions | Keep and consume through authenticated restoration; no second schema model or physical-name issuer. |
| Located PostgreSQL settlement classification and safe connection release | Keep; reuse only through the lifetime contract above. |
| Artifact active-work cancellation/quarantine | Reuse the existing initial physical transaction driver; no transfer of artifact, recovery or DDL authority. |
| Framework adapters, receipts and common finalizer | Deferred to their existing owners; no placeholder runtime implementations. |

There is no identified shipped data or public contract requiring a compatibility
migration. No temporary dual path or new storage schema is proposed.

## Completion Proof And Execution

One manifest-owned PGlite lane shares installation/setup across sequential
functional scenarios. One focused ordinary-role PostgreSQL lane adds actual
lock, constraint, interruption and settlement proofs. Share deterministic
scenario definitions across drivers; keep real concurrent connections and
process tests where they establish claims that an in-process fixture cannot.

Require authority/table/scope/placement denial, stale availability, copied and
expired tokens, bounded input/output, pending-write reads, deterministic pages,
unique/check violations, nested success without commit, caught nested failure,
overlapping-operation refusal, and complete rollback after mutation completion.
Check persisted rows and unchanged scope commit/feed/wake state after rollback.
Separately prove read-only success, cancellation during callback and blocked SQL,
timeout, no late writes after cancellation, healthy connection reuse only after
confirmed cleanup, and quarantine when cleanup cannot be established. Inject
actual read-only COMMIT acknowledgement loss and retain the uncertain outcome.

Use observed native lock barriers for scope fencing and availability movement;
show another scope can progress on the same database. Do not rerun the whole
migration matrix for each store case. Run affected binding/Application tests,
package typecheck with bounded compiler memory, core/diff lint, both standing
reviewers and the exact staged diff gate. Report measured focused-lane costs
and any unavailable native proof honestly.

The private transaction/store capability is implemented. The concrete
[commit-owner proposal](./16-mutation-receipts-and-finalization-admission.md)
specifies the next authenticated receipt/finalization rejection proof. Successful
Application/Payload publication and later real Currency conformance retain
their existing order. Do not open further document-only gates for ordinary
implementation details within this contract.
