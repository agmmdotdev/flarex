# Production Redelivery And C06-B

## Status And Scope

Status: active focused execution plan. P00 records the accepted boundary and is
complete. P01, the exact-attempt runtime-host contract, is the current gate.

This plan owns the remaining production portion of
`O08-B2b2b2b1b2b2b` and the subsequent `C06-B` endpoint/response policy:

- production wake-up and bounded scheduler-run hosting;
- exact-attempt redelivery into the already accepted execution authority;
- operational retry, deadline, cleanup, and liveness policy at that host;
- stable finish/lost-outcome dispatch after the production redelivery path is
  proven; and
- direct post-commit wake composition without creating a second state machine.

This plan does **not** authorize:

- runtime-topology-probe investigation or implementation;
- deployment, paid Cloudflare resources, production target activation, or
  secret provisioning;
- legacy route or storage-generation removal;
- a public scheduler endpoint;
- a second execution/session authority; or
- broad compiler, persistence, backend, or artifact-runtime refactoring.

## Why This Plan Exists

The durable scheduler pieces below the host are already implemented:

- a fixed-key Postgres checkpoint and fenced checkpoint repository;
- bounded scope enumeration and exact-selector redelivery;
- bounded multi-scope/repeated-page composition; and
- one host-neutral, count- and time-bounded scheduler run.

Those pieces deliberately cannot execute an attempt from serialized evidence.
The runtime-neutral OCC runner requires an already-authenticated exact attempt,
verified grant and metadata, execution context, and a same-process capability-
bound journal. The current artifact-runtime invoke path starts the ordinary
invoke protocol; it does not yet prove that it can resume that exact admitted
attempt without creating a new session, authority, or syscall path.

Adding a Cloudflare cron trigger before closing that boundary would make the
timer real while leaving execution authority ambiguous. This plan therefore
settles the exact-attempt runtime host first, proves one bounded production
scheduler invocation second, and activates a trigger only after both are true.

## Sources Of Truth

- [`flarexdb-foundation/02-occ-and-transactions.md`](./flarexdb-foundation/02-occ-and-transactions.md)
  owns OCC, exact-attempt claims, redelivery, and scheduler semantics.
- [`flarexdb-foundation/03-commit-compiler.md`](./flarexdb-foundation/03-commit-compiler.md)
  owns `C06-B`, finish/lost-outcome dispatch, and its ordering after durable
  publication.
- [`35-commit-compiler-and-session-intent.md`](./35-commit-compiler-and-session-intent.md)
  records the accepted compiler/session boundary.
- [`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md)
  records the accepted hosted topology and trust boundaries.
- Current code and focused tests remain authoritative for implemented behavior.
  This roadmap records intent and gates, not a commit journal.

## Current Implemented Boundary

The current production-shaped topology is:

```text
public backend Worker
  -> artifact-runtime Worker
  -> generated Dynamic Worker
  -> private executor Worker
  -> cache-disabled Hyperdrive / Postgres
```

`apps/executor` currently owns the private executor Worker and request-scoped
Postgres client lifecycle for Fetch. It does not yet expose a scheduled-event
host. `pointMutationRedeliverySchedulerRun.ts` composes one bounded scheduler
run but remains host-neutral. The scheduler checkpoint row is the sole durable
restart truth; no in-memory timer or Cloudflare trigger is durable authority.

The unresolved bridge is not merely “call the runner from cron.” The host must
show how an inert selected attempt becomes the exact already-admitted runtime
input without:

- minting authority from stored identifiers, signatures, or scheduler state;
- starting an ordinary invoke session;
- sending a privileged capability through user-visible bindings;
- routing syscalls through a different journal or transaction owner; or
- creating an executor-to-artifact-runtime-to-executor re-entry cycle whose
  authentication, lifetime, and failure semantics are undefined.

## Accepted Decisions

1. `apps/executor` is the eventual Cloudflare scheduled-event and database-
   connection lifecycle owner unless P01 proves that another existing trusted
   host must own the exact-attempt runtime.
2. One scheduled event invokes at most one bounded scheduler run. The existing
   count and monotonic-time admission bounds remain authoritative.
3. The Postgres checkpoint is due/restart truth. A Cloudflare cron is only a
   wake hint and cannot mint an execution claim or prove that work is due.
4. Scheduled work is awaited through the platform event lifetime. Detached
   background work is not accepted for checkpoint or attempt settlement.
5. Platform wake authority is not execution authority. Only the existing
   locked exact-attempt acquisition/admission path may mint process authority.
6. No public HTTP scheduler route is added. Any new Worker-to-Worker protocol
   must be private, versioned, authenticated before material allocation,
   bounded, and explicit about replay and version-skew behavior.
7. In-process capabilities, including WeakMap-backed or same-factory authority,
   are never serialized. A token or signed envelope may locate or authenticate
   a request but cannot substitute for the capability constructed by the
   owning trusted process.
8. New package surfaces use intentional subpath exports. This work does not
   add a package-root catch-all barrel.
9. No Wrangler scheduled trigger is enabled until the default deployed Worker
   can construct and run the real exact-attempt operation with deterministic
   cleanup.
10. `C06-B` composes the existing claim, publication, outcome, uncertainty, and
    commit-wake owners. It does not introduce a parallel retry coordinator or
    terminal-state machine.

## Risks To Pressure-Test

- **Re-entry cycle:** executor -> artifact-runtime -> Dynamic Worker -> executor
  can deadlock, recurse, or cross an unproven authority boundary.
- **New-session drift:** ordinary artifact invocation can create a new session
  instead of resuming the selected exact attempt.
- **Capability forgery:** a serialized locator or grant can be mistaken for the
  same-process execution capability.
- **False durability:** cron cadence or isolate memory can be treated as
  durable scheduler state instead of the fenced database checkpoint.
- **Duplicate delivery:** platform retry can invoke the same wake more than
  once; correctness must come from existing claims and idempotent settlement.
- **Lifecycle leak:** database clients, heartbeats, runtime processes, streams,
  or leases can survive the event that owns them.
- **Second state machine:** `C06-B` can accidentally compete with C05-A/C05-B,
  O08-C/O08-D, or the commit-wake outbox.
- **Route-authority drift:** a convenient HTTP endpoint can expose scheduler or
  execution authority beyond the trusted host.
- **Export widening:** private runtime or persistence composition can become an
  accidental public package contract.
- **Scope drift:** runtime-topology-probe work can be pulled into this slice
  despite being explicitly excluded.

## Execution Gates

### [x] P00 — Record The Production Boundary

Record what is implemented, why a trigger cannot be added safely yet, the
accepted host and authority rules, the risk register, and the ordered gates.

Exit gate:

- the foundation roadmaps and accepted-design note link here;
- the current gate is unambiguous after context compaction; and
- no runtime, route, trigger, deployment, or configuration behavior changes.

### [ ] P01 — Define The Exact-Attempt Runtime Host Contract

Compare only the concrete trusted-host compositions that can reuse the current
exact-attempt authority. For each viable composition, trace:

- owner of runtime construction, database connection, heartbeat, and cleanup;
- exact protocol input and every authenticated or capability-bound value;
- attempt/session/package/schema/policy pins and their validation order;
- journal and syscall routing back to the singular claim-fenced owner;
- Worker-to-Worker authentication, replay, size, timeout, and version-skew
  behavior where a cross-Worker hop exists;
- failure and interruption ownership before, during, and after execution; and
- whether the topology introduces re-entry or a second session.

Choose one composition only when it preserves the current authority and
lifecycle contracts. Record rejected alternatives and the evidence that
rejects them.

P01 must not add a cron handler, Wrangler trigger, public route, or `C06-B`
endpoint.

### [ ] P02 — Compose One Production Exact-Attempt Rerun

Implement the smallest trusted runtime composition selected by P01. Reuse the
existing validators, key resolution, immutable metadata, execution-context,
claim-fenced journal, and runtime-neutral runner owners. Add focused tests for
authority forgery, pin mismatch, new-session drift, failure/defect separation,
interrupt/cleanup behavior, and exact syscall/journal routing.

### [ ] P03 — Host One Bounded Scheduler Event

Compose one platform event over one event-owned database client and one existing
bounded scheduler run. Preserve checkpoint-before-next-work ordering, fenced
settlement, soft admission deadlines, duplicate wake safety, and deterministic
resource closure. Pin platform retry and event-lifetime behavior in focused
host tests.

### [ ] P04 — Activate The Cloudflare Scheduled Trigger

Add the scheduled-event export and Wrangler trigger only after P02 and P03
prove the default Worker can execute real work. Keep cadence a wake hint, keep
all limits in validated runtime configuration, and perform no deployment in
this gate.

### [ ] P05 — Complete C06-B

Add stable target-native finish/lost-outcome dispatch and direct post-commit
wake composition. Reuse C05-A/C05-B terminalization, O08-C/O08-D decision
policy, the existing commit-wake outbox, and the exact-attempt redelivery owner.
Prove response idempotency and ensure direct wake is an optimization over
durable scheduler truth, not a replacement for it.

### [ ] P06 — Prove And Close

Run focused package/app tests, type checks, Effect boundary checks, required
reviewers for every significant code checkpoint, and the real-Postgres suite
for changed persistence behavior. Update the living roadmaps to match the
implemented boundary and leave deployment/activation explicitly pending unless
separately authorized.

## Resume Checklist

Current gate: **P01 — Define The Exact-Attempt Runtime Host Contract.**

On resume:

1. read this plan and its four linked authority documents;
2. inspect the current executor, artifact-runtime, runtime-neutral runner, and
   exact-attempt acquisition call paths;
3. compare the minimum viable trusted-host compositions;
4. record the selected composition and rejected alternatives here; and
5. stop before implementation if no composition preserves singular authority.

Do not add a cron handler, scheduled export, Wrangler trigger, or `C06-B` route
during P01.

## Completion Condition

This plan is complete only when a deployed-shape trusted host can awaken from
the durable checkpoint, run bounded exact-attempt redelivery through the
singular execution authority, settle all owned resources deterministically,
and compose stable idempotent finish/lost-outcome dispatch without relying on
isolate memory, exposing a public scheduler surface, or creating a parallel
session or retry state machine.
