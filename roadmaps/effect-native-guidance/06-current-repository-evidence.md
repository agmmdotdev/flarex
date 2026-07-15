# Current Repository Evidence

## Snapshot Scope

This evidence was collected from the 2026-07-15 current working tree. It
includes uncommitted C03 journal work already present in the workspace and
therefore must be refreshed before a later implementation preflight.

The scan covered production `.ts` files under the named `src` roots, excluding
tests and declarations. Counts are line hits, not AST nodes or quality scores.
Generated or compatibility code can also affect them.

| Source root | Files | Files importing Effect | `Effect.fn` | `Effect.gen` | `Effect.try` | `tryPromise` | `throw new` | `Promise<` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `packages/executor/src` | 21 | 1 | 4 | 1 | 4 | 4 | 130 | 171 |
| `packages/persistence-postgres/src` | 59 | 2 | 0 | 0 | 0 | 0 | 409 | 375 |
| `packages/flarex-protocol/src` | 31 | 27 | 138 | 0 | 6 | 3 | 104 | 19 |
| `packages/flarex-backend/src` | 112 | 96 | 783 | 48 | 29 | 64 | 150 | 167 |
| `packages/executor-http/src` | 9 | 4 | 31 | 2 | 0 | 4 | 0 | 32 |

Additional construct evidence:

- executor has no located Context service or Layer use; its current Effect use
  is concentrated in the new point-mutation journal;
- persistence has no located Context service or Layer use, while only two of
  59 source files import Effect;
- protocol has broad Effect decoder/operation adoption and strong pure
  `Result` usage, but still exposes several synchronous throwing decoders;
- backend has established service/Layer islands in deployment and registry;
- no production `Exit` use was located in these five roots; and
- `Match` use is sparse, while native switches and discriminant checks are
  common.

A focused conditional scan found 130 production files importing Effect across
these roots. They contain 1,853 `if` statement line hits, but that number is not
a debt count. More actionable subsets include 16 direct `_tag` condition line
hits in five files and 74 `kind` / `type` / `status` / `reason` condition line
hits in sixteen files. Only twelve `Effect.match` line hits and five `Match`
module line hits were found. Repeated tagged route dispatch and direct Result
tag inspection deserve review; simple guards, codecs, and exhaustive switches
do not deserve automatic conversion.

These facts support a boundary-focused guide. They do not support replacing
every throw, Promise, switch, or nullable value mechanically.

## Domain Observations

### Executor

[`../../packages/executor/src/pointMutationJournal.ts`](../../packages/executor/src/pointMutationJournal.ts)
already has several good choices: named `Effect.fn` operations, a generator for
the multi-step seal flow, typed errors, semaphore-based serialization, and narrow
`tryPromise` calls around the current persistence port.

Its transitional debt is equally instructive:

- owned capability validation throws inside `Effect.try`;
- a pure operation decoder throws several expected tagged errors and is caught
  by an outer wrapper;
- broad catches combine domain errors, persistence errors, and possible
  defects;
- a long `instanceof` list reconstructs the error union; and
- `Semaphore.makeUnsafe` is used even though construction already happens in
  an Effect operation.

[`../../packages/executor/src/pointMutationSessionActivation.ts`](../../packages/executor/src/pointMutationSessionActivation.ts)
shows the directly connected older style: Promise-returning services and plain
`Error` subclasses. The mismatch explains why the new journal needs an adapter;
it should not become precedent for another Effect-native operation.

No production composition call site for the new journal was located during
this snapshot beyond its export and tests. Service/Layer ownership is therefore
an evidence gap, not proof that a Layer is currently required.

### Postgres Persistence

[`../../packages/persistence-postgres/src/sessionJournalStore.ts`](../../packages/persistence-postgres/src/sessionJournalStore.ts)
defines a Promise/throw `SessionJournalStorePersistenceV1` port even though its
errors use `Data.TaggedError`. Expected capability and input errors, driver
rejections, trusted corruption, and internal invariant throws all travel
through the same JavaScript exception mechanism.

The larger package follows the same broad shape: async factories and
transaction helpers, synchronous throwing decoders, and explicit result unions
in selected planners. Some raw `Error` throws correctly represent impossible
trusted invariants, but broad Promise catches can accidentally normalize those
defects unless the new Effect boundary classifies them deliberately.

[`../../packages/persistence-postgres/src/postgres.ts`](../../packages/persistence-postgres/src/postgres.ts)
also demonstrates behavior that must survive a port: connection acquisition,
transaction ownership, rollback-error capture, and release in `finally`.
Effect adoption must strengthen typed composition without weakening this
resource and transaction discipline.

### Protocol

[`../../packages/flarex-protocol/src/commit-protocol.ts`](../../packages/flarex-protocol/src/commit-protocol.ts)
is strong local evidence for named Effect decoders, typed failures, and
composing canonicalization steps without runtime runners.

[`../../packages/flarex-protocol/src/validator-engine.ts`](../../packages/flarex-protocol/src/validator-engine.ts)
is strong evidence for keeping pure validation as `Result` rather than forcing
it into Effect. Synchronous Schema decoders and throwing compatibility helpers
elsewhere in protocol should remain at deliberate boundaries; Effect-native
callers should prefer typed decoder operations.

### Backend And Hosts

The deployment and registry subsystems demonstrate that Flarex can compose
`Context.Service`, `Layer.effect`, `Layer.succeed`, named service methods, and
host-owned runtime boundaries. They are useful precedent when a capability is
shared and lifecycle/composition ownership is real.

`executor-http` shows the separate adapter case: Promise request handlers and
runtime runners can be legitimate at the Web framework edge while the invoked
operation remains Effect-native.

No production use of Effect's `HttpClient` service was located. Backend source
contains many raw `fetch` calls, but most are Cloudflare service-binding or
Durable Object stub calls, inbound `fetch` methods, or generated Worker source.
Those are not ordinary Internet HTTP and should not be replaced mechanically.
The manually wrapped configurable fetch flow in
[`../../packages/executor-http/src/liveQueryDelivery.ts`](../../packages/executor-http/src/liveQueryDelivery.ts)
is a stronger future `HttpClient` candidate because it performs ordinary URL
HTTP, owns request construction and status policy, and already exposes an
injectable transport.

### Tests

The inspected workspace contains 259 test files. Ninety contain
`Effect.runPromise` and twelve contain `Effect.runSync`; no declared
`@effect/vitest`, Effect-aware test syntax, or `TestClock` use was located.
This supports incremental test-boundary consolidation and later adoption where
deterministic concurrency or lifecycle testing provides concrete value.

## Strong Patterns To Preserve

- named, qualified `Effect.fn` operations in protocol and backend;
- pure `Result` validation in the validator engine;
- Schema-backed typed decoder operations with throwing compatibility wrappers
  kept at the edge;
- local service/Layer graphs rather than a global container;
- one runner at real Worker, Durable Object, HTTP, script, or test boundaries;
- explicit transaction helpers that own commit, rollback, and release; and
- native exhaustive switches where they are clearer than `Match`.

## Hypotheses Requiring Slice-Specific Proof

- which persistence capabilities should become Context services rather than
  explicit Effect-valued ports;
- where pool/client lifecycle is actually owned in each host;
- which current raw errors are expected failures versus defects;
- whether a Promise compatibility surface has a shipped external consumer;
- how interruption maps to an in-flight Postgres transaction outcome; and
- whether Effect-aware test tooling should be adopted package-by-package or
  through one workspace test utility.
- which raw fetch flows are ordinary outbound HTTP versus Cloudflare
  capability-bearing platform dispatch, and which external calls require
  bounded streaming before Schema decoding.

Those questions belong in the preflight for the first concrete vertical port,
not in a speculative file-by-file migration checklist.
