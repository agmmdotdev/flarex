# Domain Services, Layers, And Composition

Status: active cross-cutting implementation guidance.

Evidence snapshot: 2026-07-16 current working tree, local T3 Code snapshot,
local Effect-smol documentation, and installed Effect 4.0.0-beta.90. Re-check
the code and installed APIs before an implementation preflight.

## Decision

Organize new and materially refactored Effect code by domain first. Inside a
domain, keep pure models and policies, service contracts, live Layers, and
composition roots visibly separate when those responsibilities are substantial.

Do not interpret this as "make every file a service" or "run every side effect
while constructing a Layer." Business effects belong in service operations.
Layers own dependency construction, requirement closure, resource acquisition
and release, startup gates, and scoped background processes.

Use T3 Code as application evidence and Effect-smol as the installed-style API
authority. Copy the responsibility boundaries, not folder names or abstractions
mechanically.

## Evidence Behind The Standard

The current working tree has three inconsistent organization models:

- `packages/executor/src` has 23 top-level source files, no domain directories,
  four files importing Effect, and no Context service or Layer. Its
  `types.ts` exceeds 1,000 lines, while `index.ts` manually threads persistence,
  clocks, IDs, and other dependencies into a large Promise facade.
- `packages/persistence-postgres/src` has 61 top-level source files, no domain
  directories, three files importing Effect, and no Context service or Layer.
  `sessionJournalStore.ts` exceeds 3,400 lines and combines several distinct
  model, policy, repository, transaction, and adapter responsibilities.
- `packages/flarex-backend/src` has eleven domain directories and established
  service/Layer islands in `deployment` and `registry`. This proves the model
  works locally, but `deployment/Store.ts` still combines too many concerns and
  `Runtime.ts` is too vague to be a durable ownership boundary.

The hosted executor also constructs its Postgres persistence and executor
facade inside a manual request lifecycle. Its explicit per-request acquisition
and release are important behavior; a future Effect port should express that
ownership with Scope rather than globalize the connection.

T3 Code provides stronger organization evidence:

- domain roots such as `checkpointing`, `orchestration`, `persistence`, and
  `project` contain `Services/` and `Layers/` where both sets are substantial;
- service files define narrow Context contracts while Layer files provide live
  implementations and typed dependencies;
- a domain `runtimeLayer.ts` composes the local graph before the application
  composition root combines domains;
- `Layer.effectDiscard` is used for migrations, startup state, listener gates,
  and scoped background work, not ordinary request or business operations; and
- dynamic provider drivers remain plain scoped values because multiple
  instances of one driver must coexist. A singleton Context tag would model the
  wrong cardinality.

Effect-smol confirms the semantic model: `Context.Service` is the normal shared
capability contract; `Layer.succeed`, `Layer.effect`, `Layer.unwrap`, Scope,
`Effect.acquireRelease`, `Layer.effectDiscard`, and `Layer.launch` each express
different construction and lifecycle needs.

## Domain-First Folder Rule

Group files by the business or authority boundary they change together, not by
a repository-wide technical bucket such as `utils`, `services`, or `effects`.

A substantial domain may use this shape:

```text
domainName/
  Model.ts
  Errors.ts
  Policy.ts
  Schema.ts
  Services/
    DomainService.ts
    DomainRepository.ts
  Layers/
    DomainServiceLive.ts
    PostgresDomainRepository.ts
  Layer.ts
```

Apply the shape proportionally:

- keep a small domain flat with `Service.ts` and `Layer.ts` rather than creating
  one-file `Services/` and `Layers/` directories;
- introduce the subdirectories when multiple contracts or implementations
  make the separation useful;
- place row codecs, SQL query builders, and transaction adapters with the
  persistence domain that owns them, not beside application orchestration;
- keep tests adjacent to the implementation convention already used by the
  package; and
- expose only deliberate package subpaths. A domain folder is not permission
  for a barrel file that re-exports every internal symbol.

Folder moves are not architectural proof. Split mixed responsibilities first
or during an approved vertical slice; do not merely move a 3,400-line file into
a new directory and call the domain organized.

## Classify Before Creating A Service

| Construct | Default representation |
| --- | --- |
| Pure model, decision, policy, codec, or transformation | Plain TypeScript module, `Result` when recoverable failure is data |
| Shared application capability with Effect operations | Narrow `Context.Service` contract |
| Live adapter or dependency graph | `Layer` in the owning domain |
| One local lifecycle-free dependency | Explicit parameter or constructor when clearer |
| Many simultaneous instances of one kind | Plain value returned by a scoped factory, not one Context tag per instance |
| Request- or transaction-specific capability | Request/transaction-scoped service or explicit scoped value |
| Startup work that provides no service | `Layer.effectDiscard` when it belongs to Layer startup |
| Executable host | One composition root and runtime bridge |

Promote an explicit port to a service when it is shared, participates in the
Effect requirement graph, owns lifecycle or configuration, needs live and test
implementations, or benefits from construction-order checking in `R`. Keep a
plain parameter when it remains local, lifecycle-free, and clearer.

## Service Contract Rules

- Define the service around a capability, not a file or table.
- Keep methods narrow and expose exact `Effect.Effect<A, E, R>` channels.
- Use readonly input and service shapes. Reuse domain types rather than
  duplicating database or protocol records.
- Implement reusable methods with contract-typed named `Effect.fn` operations.
- Do not call `runPromise` inside a service to erase `E` or `R`.
- Use a path-qualified service identifier such as
  `flarex/executor/pointMutation/SessionJournal`.
- Do not use Context as a global service locator. Requirements remain visible
  until the owning Layer or host provides them.
- Use `Context.Reference` only for a value with a genuinely safe default. A
  credential, authority decision, required database, or security policy must
  not silently appear through a default.

For a substantial adapter, separate the contract from its live Layer:

```ts
// Services/SessionJournal.ts
export interface SessionJournalApi {
  readonly load: (
    key: SessionJournalKey,
  ) => Effect.Effect<SessionJournalEntry, SessionJournalReadError>;
}

export class SessionJournal extends Context.Service<
  SessionJournal,
  SessionJournalApi
>()("flarex/executor/pointMutation/SessionJournal") {}
```

```ts
// Layers/PostgresSessionJournal.ts
const make = Effect.gen(function* () {
  const sql = yield* SqlDriver;

  const load: SessionJournalApi["load"] = Effect.fn(
    "SessionJournal.load",
  )(function* (key) {
    return yield* sql.loadSessionJournal(key);
  });

  return SessionJournal.of({ load });
});

export const PostgresSessionJournalLive = Layer.effect(SessionJournal, make);
```

For a small single implementation, a static `layer` on the service remains
valid. Split it only when adapter size, multiple implementations, test
substitution, or dependency visibility provides a concrete benefit.

## Layer Construction Rules

| Layer responsibility | Rule |
| --- | --- |
| Already-created lifecycle-free capability | `Layer.succeed` |
| Effectful service construction | `Layer.effect` |
| Configuration-dependent Layer selection | `Layer.unwrap` |
| Resource acquisition | `Effect.acquireRelease` inside Layer scope |
| Startup gate providing no capability | `Layer.effectDiscard` |
| Long-running background process | Start with `Effect.forkScoped`; closing the Layer scope interrupts it |
| Domain business operation | Keep it on the service method, not Layer construction |

Do not perform ordinary request writes, mutation publication, message delivery,
or user-triggered work merely because a Layer is built. Construction may
validate configuration, open a client or pool, run an explicitly owned startup
gate, install a listener, or launch a scoped background process.

Migrations require a host decision. A migration Layer can be appropriate for a
long-lived application startup, but must not accidentally run for every
Cloudflare request or transaction. Preserve the repository's real deployment
and real-Postgres migration gates.

## Context And Lifecycle Matrix

| Lifetime owner | Representative capabilities | Constraint |
| --- | --- | --- |
| Application or Worker | Stable config, logger, ordinary HTTP transport, lifecycle-safe shared clients | Never capture request, transaction, or Durable Object state |
| Durable Object instance | Object storage, instance identity, object-local coordination | Build per object instance; do not promote to a module-global Layer |
| Request | authorization evidence, deadline, request metadata, request-owned Postgres client | Release when the request scope ends |
| Transaction | transaction client, snapshot token, read/write journal, fenced authority | Never hold across untrusted user execution; commit/rollback owner remains explicit |
| Operation | trace annotations and derived local capabilities | Keep local unless several operations genuinely share it |

Provision services at the widest lifetime that is correct, not the widest
lifetime technically possible. A Layer object stored on a host is not proof
that its services are built once; verify the runtime and memoization boundary.

Avoid deep `Effect.provide` calls inside domain operations. Compose stable
dependencies with `Layer.provide`, `Layer.provideMerge`, and `Layer.mergeAll`
in the domain or host composition root. Use `Effect.provideService` locally only
when deliberately capturing one instance-specific capability and preserving
that lifetime is clearer than leaving it in `R`.

## Composition Roots

Use three levels where the graph is large enough:

1. A service Layer provides one implementation and declares remaining
   requirements.
2. A domain `Layer.ts` closes internal dependencies and exposes the small set
   of services other domains consume.
3. The host composition root merges domain Layers, provides platform adapters,
   and owns the only runtime bridge.

```ts
export const PointMutationLive = PointMutationService.layer.pipe(
  Layer.provide(PostgresSessionJournalLive),
  Layer.provide(TransactionGrantVerifierLive),
);
```

Do not create one repository-global dependency container. Tests should compose
the smallest graph needed by the behavior under test.

## Flarex Package Boundary Warning

`@flarex/executor` currently depends directly on
`@flarex/persistence-postgres` for records, errors, and Promise contracts. A
folder reorganization cannot make that dependency adapter-neutral. Moving a
service contract into executor would make Postgres depend back on executor and
risk a cycle.

Preserve the current package direction during mechanical organization. A later
preflight may choose a narrow adapter-neutral ports/contracts package, but it
must first verify accepted FlarexDB ownership, public exports, generated types,
and compatibility obligations. Do not create that package implicitly during a
service refactor.

The public Promise-based executor facade may remain a compatibility adapter
while internal domain services become Effect-native. Convert once at the real
host or API boundary rather than retaining Promise contracts between internal
services.

## Testing Rules

- Test service behavior against a minimal test Layer or `Layer.succeed`
  implementation.
- Test the live Postgres Layer separately with PGlite and the required focused
  real-Postgres lane.
- Test Layer construction failure, acquisition release, interruption, and
  background-fiber cleanup when those semantics exist.
- Do not prove organization by mocking every dependency. Domain tests should
  exercise typed service failures; adapter tests must still prove SQL,
  transaction, lock, and rollback behavior.
- A test runtime must be disposed when it owns scoped resources.

## Incremental Migration Classification

Classify each touched module as one of:

- `keep`: already has one clear responsibility and correct ownership;
- `move`: responsibility is clear and only its domain location is wrong;
- `split`: combines contract, policy, adapter, transaction, or composition
  concerns that change independently;
- `promote to service`: a shared Effect capability belongs in `R`;
- `adapt behind Layer`: a foreign Promise, platform, or driver boundary needs
  one live implementation Layer;
- `keep as plain instance`: cardinality or locality makes Context inappropriate;
  or
- `delete with legacy path`: the approved replacement removes its only owner.

Apply this to one vertical domain slice after preflight. Avoid a repository-wide
file move because it obscures behavioral changes, breaks package subpaths, and
makes transaction regressions difficult to isolate.

## Review Checklist

- Does the folder represent one business, authority, or lifecycle domain?
- Are pure policy and data transformations still plain modules?
- Is each Context service a real shared capability with exact `A`, `E`, and `R`?
- Is a dynamic multi-instance value being forced incorrectly into a singleton
  Context tag?
- Does the Layer construct dependencies rather than execute ordinary business
  work eagerly?
- Are resources and background fibers owned by Scope?
- Are request, Durable Object, and transaction values provided at their correct
  lifetimes?
- Does the domain Layer close internal requirements without hiding a public or
  host-owned dependency?
- Is `runPromise` confined to the executable or foreign callback boundary?
- Did a folder move accidentally change exports, package dependency direction,
  transaction ownership, or compatibility behavior?

See also
[`02-services-layers-and-runtime-ownership.md`](./02-services-layers-and-runtime-ownership.md),
[`03-postgres-persistence-and-transactions.md`](./03-postgres-persistence-and-transactions.md),
and
[`05-testing-observability-and-adoption.md`](./05-testing-observability-and-adoption.md).
