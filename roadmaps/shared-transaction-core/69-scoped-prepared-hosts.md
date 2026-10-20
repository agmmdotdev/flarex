# Scoped Prepared Hosts

Status: implemented under standing core approval; connected acceptance remains
in the completion plan.

## Outcome And Ownership

One explicitly constructed core runtime owns retained private CMS, commerce,
atomic-commerce and composite hosts across shop selections. The trusted
composition supplies the same runtime to hosts sharing its capacity. An Effect
Scope owns that runtime. There is no process-global cache or implicit default.
Native request-owned preparations retain their existing request lifetime.

Reserve a host slot before preparation. Charge preparation payloads against the
runtime's configured byte capacity before publishing the host. Include hidden
physical, unique and relation preparation data at their issuing owners, the
Application bundle/schema/requirements, copied CMS configuration, commerce
profile artifacts/layouts and captured installation references/payloads.
Include retained event contracts/subscriber data, participant and command
selections, content identities and identity digests. Retain only the initialization
key digest used by commerce, discarding its unused canonical evidence snapshot.
Charges are deterministic retained-data accounting, not an assertion
about engine heap size. Borrowed database/authority ports and callback code are
outside this schema-preparation budget; their existing owners remain responsible.

Accounting uses canonical scalar bytes plus fixed value/container charges,
binary lengths and bigint decimal lengths. Repeated references are charged
repeatedly. This is neither a persistence codec nor a JavaScript heap meter.
Each runtime bounds its own composition; independently constructed runtimes do
not establish a process-wide cap. Hosted routing and activation remain deferred.

Closing a host prevents new invocations, waits for accepted invocations including
uncertain-outcome recovery, releases its retained implementation, then returns its
capacity. Runtime scope closure performs the same drain for every owned host.
Failed, defective and interrupted construction releases its reservation. Capacity
exhaustion refuses new construction; there is no eviction or stale-host refresh.
Construction and installation share one interruptible acquisition use; failure
at the installation boundary abandons the reservation before returning.
The first refused charge invalidates the allocation even if construction code
catches that failure. Typed failures, defects, interruption and combined causes
retain their original evidence through both construction and invocation.

## Breaking Cutover

Private host inputs require a runtime and returned hosts expose `close`. Migrate
all existing construction fixtures, Payload bindings and host compositions.
Tests explicitly own a runtime scope through their fixture cleanup; the general
Effect Promise bridge must not create hidden lifetimes. Existing materialization,
transaction and settlement owners remain unchanged. This is resource ownership,
not a universal transaction API or new framework integration.

Payload bindings register host closure in their native instance's scope before
returning. Other compositions must acquire the host runtime after borrowed
scoped callback resources, so it drains before those resources are destroyed.
The fixed Currency/Payload/Application composition follows this ordering.

Use one internal lifetime owner and explicit profile method delegation. Do not
capture the retained implementation in escaped public methods after release.
Keep admission, corruption, cancellation and replay checks inside the retained
implementation. Closing a host never cancels or reports success for an uncertain
database decision; the active call completes its existing recovery protocol.

## Validation And Completion

The retained `cmsHostLifetime.test.ts` PGlite witness currently exposes a drain
gap: closing a host while an admitted read is paused makes the resumed logical
working set receive `PreparedHostRuntimeError` with reason `closed`. The host
allocation's generation check uses the root open check during closing, although
the admitted invocation still holds a borrow. Accepted work must finish before
capacity and captured mechanics are released. Correct this at the prepared-host
runtime and borrowed-mechanics lifetime owners; do not weaken the witness or
repair it in a framework adapter. New calls and unfinished construction stages
must still refuse once closing starts; distinguish an already accepted borrow.
Fixture reuse for this witness is deferred
until that core correction is authorized and owner/consumer regressions pass.

Prove shared capacity across multiple hosts, byte refusal before exposure,
reservation cleanup on failure/interruption, no admission after close, and drain
before capacity reuse. Exercise real host read/write/replay after another host
closes and verify no callback or durable effect from a closed host. Preserve
ordinary-role PostgreSQL recovery/locking and fast-driver behavior. Run affected
typechecks, lint and both reviewers; remove implicit unowned host construction.
No schema migration, durable format change, table removal or data deletion.

The atomic publication fault fixture installs its scope-clock trigger through
the existing installer owner because that owner owns the protected table.
Commands and settlement still run through the ordinary-role pool; this changes
no runtime database privileges.
