# Flarex Postgres Persistence Domain Separation Idea

## Status And Scope

**Status:** Exploratory design idea recorded on 2026-08-03. This is not an
accepted architecture decision, implementation roadmap, package-move approval,
or migration authorization.

This note records a concern about the current responsibility density inside
`@flarex/persistence-postgres` and a possible direction for separating those
responsibilities over time. Flarex is still changing quickly. Every count,
dependency, export, candidate boundary, and proposed first slice in this note
must be re-audited against the working tree before implementation.

The current authorities remain:

- [`../roadmaps/16-package-boundaries.md`](../roadmaps/16-package-boundaries.md)
  for accepted package ownership and dependency direction;
- [`../roadmaps/effect-native-guidance/14-domain-services-layers-and-composition.md`](../roadmaps/effect-native-guidance/14-domain-services-layers-and-composition.md)
  for domain-first organization and incremental Effect migration guidance;
- package manifests, exports, source, callers, and tests for exact current
  behavior; and
- [`flarex-durable-task-engine.md`](./flarex-durable-task-engine.md) for the
  current Trigger.dev-informed durable-task direction.

If this note conflicts with an accepted roadmap or newer source evidence, the
accepted roadmap and current source control.

## The Idea

`@flarex/persistence-postgres` appears to have become a persistence gravity
well: several valid Flarex domains are implemented in one mostly flat package
because their operations eventually read or write PostgreSQL.

This is not the same as saying the package contains one giant coherent core.
The stronger hypothesis is that it contains multiple cores, policies,
repositories, transaction owners, adapters, compatibility paths, and
composition flows whose boundaries are difficult to see.

Touching a database does not make the whole operation persistence-owned.
Postgres should own database mechanics and concrete repository implementations.
The domain that defines a lifecycle, state transition, authorization decision,
or orchestration policy should normally own that policy.

## Current Snapshot

The following is a working-tree snapshot from 2026-08-03, not a durable metric:

- `packages/persistence-postgres/src` contains 128 TypeScript source files and
  approximately 79,700 lines;
- 123 TypeScript files are directly under `src`;
- only `storedCommitAuthority/` and `storedOccExecution/` are represented as
  source subdirectories;
- `FlarexRuntimePersistence` combines SQL access, legacy app data, deployment
  metadata, schema publication, scope metadata, invoke sessions, document
  revisions, outbox, freshness, live-query state, and transactions;
- the package publicly exports application-revision lifecycle operations,
  Declarative V2 command and progress operations, point-mutation scheduling,
  point commit, session journal, OCC, Postgres clients, and PGlite construction;
  and
- the package depends directly on analysis and Standard Application packages
  in addition to Drizzle, PostgreSQL, PGlite, Effect, and protocol packages.

These facts may all change before this idea is acted upon. Refresh them with
focused source and dependency inspection rather than copying these numbers into
an implementation roadmap.

The existing Effect organization guidance recorded the same structural concern
at a smaller historical snapshot. Growth alone does not prove bad architecture,
but the combination of growth, flat organization, wide exports, upward domain
dependencies, and multi-purpose interfaces is evidence that ownership should be
re-examined.

## Concern, Not Verdict

Large persistence modules are not automatically wrong. Transaction owners often
need to coordinate several tables, preserve SQL ordering, hold locks, distinguish
driver failures from typed domain failures, and keep rollback behavior visible.
Splitting those mechanics across arbitrary packages could make correctness worse.

The concern is specifically about responsibilities that change for different
reasons:

1. a domain model or lifecycle policy changes because Flarex behavior changes;
2. a repository port changes because a domain needs a different durable
   capability;
3. a Postgres adapter changes because a table, query, lock, or driver changes;
4. a host composition root changes because dependencies or lifetimes change;
5. a compatibility path changes because a shipped consumer is retired; and
6. a public export changes because package ownership changes.

When one file or root interface owns several of those reasons, the result is a
real separation-of-concerns problem even if the runtime behavior is correct.

## Provisional Responsibility Classification

This classification is a hypothesis to test file by file.

### Responsibilities That Likely Remain Postgres-Owned

- Drizzle schema declarations, migration assets, and migration execution;
- PostgreSQL and PGlite client construction and driver normalization;
- SQL query building, row decoding, corruption classification, and database
  error translation;
- transaction, isolation, rollback, advisory-lock, and fencing mechanics;
- concrete repositories for scope/catalog, application rows and indexes,
  session journals, OCC, commits, outcomes, feeds, outbox, live-query state,
  application revisions, verifier progress, and durable tasks;
- persistence-specific snapshot and codec ownership; and
- Postgres/PGlite integration tests, including required real-Postgres proofs.

Persistence-specific policy should remain here when it is truly about stored
representation, transaction semantics, query behavior, or database corruption.

### Responsibilities That May Belong To Other Domains

- application-revision registration, readiness, activation, and runtime-target
  orchestration above the repository operation;
- Standard Application analysis and definition coordination;
- Declarative V2 verifier state-machine decisions and derivation policy;
- authenticated command coordination that composes identity, policy, hashing,
  and repositories;
- candidate runtime projection and runtime selection policy;
- tenant, application, and environment lifecycle policy; and
- future durable-task run, attempt, retry, cancellation, waitpoint, checkpoint,
  queue, and concurrency semantics.

Those domains may still use Postgres implementations. Separating authority does
not require eliminating PostgreSQL or hiding transactions from the adapter that
must own them.

### Responsibilities That Must Be Split Carefully

Some large transaction modules may legitimately remain in
`@flarex/persistence-postgres` but still need internal separation between:

- model and stored representation;
- pure validation and transition planning;
- repository contract;
- Drizzle query implementation;
- transaction-owning operation;
- service or Layer construction; and
- compatibility facade.

`sessionJournalStore.ts`, `pointCommitTransaction.ts`, verifier progress, and
the physical schema are candidates for investigation, not pre-approved splits.
Their call graphs, public subpaths, transaction boundaries, tests, and legacy
obligations must be inspected first.

## Possible Internal Shape

Before extracting packages, a clearer internal shape may be enough:

```text
packages/persistence-postgres/src/
  driver/
  migrations/
  schema/
  scope-authority/
  catalog/
  app-data/
  transaction-journal/
  commit/
  live-query/
  application-revision/
  declarative-verifier/
  durable-task/
  legacy/
  composition/
```

These names are illustrative. A folder should represent a real business,
authority, transaction, or lifecycle domain. Empty ceremony, one-file folders,
and mechanical renames do not improve ownership.

The package root should eventually expose deliberate stable capabilities rather
than acting as a catch-all barrel. Existing public and internal subpaths must be
preserved until their owning migration explicitly proves replacement and
removal gates.

## Ports, Services, And Dependency Direction

The intended separation is approximately:

```text
domain policy / service
  -> narrow repository or transaction capability
      -> Postgres live adapter
          -> Drizzle / pg / PGlite
```

This diagram does not decide which current or future package owns every port.
The present dependency graph matters. Moving a contract into a package that
already depends on `@flarex/persistence-postgres` could make Postgres depend
back on its consumer and create a cycle.

Therefore:

- preserve the current package direction during mechanical organization;
- do not create a generic `flarex-core` or universal database API;
- do not create an adapter-neutral contracts package without a separate
  package-boundary preflight;
- keep dynamic request-, transaction-, Worker-, and Durable Object-scoped
  values out of singleton service contexts; and
- introduce services and Layers only for real shared capabilities and lifecycle
  ownership, not merely to replace imports with dependency injection.

## Relationship To Trigger.dev Integration

The Trigger.dev integration should not add another complete product domain to
the persistence root.

The provisional division remains:

```text
Flarex durable-task domain
  owns task/run/attempt lifecycle and transition semantics

private FlarexDB Task System capability
  owns the narrow durable operations required by that domain

Postgres durable-task adapter
  owns Drizzle queries, rows, locks, fences, transactions, and migrations

Cloudflare and compute adapters
  own wakeups, hosting, leases, execution, and provider integration
```

Trigger.dev logic should be reused where its behavior and tests can be separated
from Prisma, Trigger organization/project/environment identity, Redis, and
long-running host assumptions. Reimplementation remains the last choice, but
source reuse does not justify placing host-neutral task semantics inside the
Postgres adapter.

The current `flarex-durable-task-engine.md` decision remains in force: the
Trigger.dev workspace is an inactive compatibility island until a separate
package-integration decision authorizes a narrower import or extraction path.

## Incremental Investigation And Migration Method

If this idea is accepted later, use one bounded vertical capability at a time:

1. re-audit the current working tree, manifests, exports, callers, tests, and
   roadmap status;
2. classify each involved module as `keep`, `move`, `split`, `promote to
   service`, `adapt behind Layer`, `keep as plain instance`, or `delete with
   legacy path`;
3. write down the capability's domain owner, repository owner, transaction
   owner, runtime owner, and public compatibility boundary;
4. preserve behavior while separating pure policy from the concrete adapter;
5. keep Promise compatibility at real public or foreign boundaries while using
   Effect internally only where its error, lifecycle, interruption, or
   dependency semantics are appropriate;
6. validate with focused PGlite tests and use real PostgreSQL for migrations,
   locks, isolation, concurrency, rollback, and transaction semantics;
7. retain existing exports through explicit compatibility adapters when they
   have supported consumers; and
8. update the accepted roadmap only after the new boundary is proven.

Do not combine the migration with a Drizzle major-version change, Trigger.dev
workspace merge, tenant-model replacement, schema redesign, or public API
redesign unless a separate preflight explicitly couples those changes.

## Possible First Investigation Slice

Application revision registration is a useful candidate for investigation
because it currently composes Standard Application analysis/definition values,
schema publication, verifier progress, runtime readiness, and a database
transaction.

That makes it a good boundary probe, not an automatically approved first
implementation. Before choosing it, verify:

- every direct and indirect caller;
- which package owns the registration lifecycle;
- which invariants require one Postgres transaction;
- whether moving a port creates a dependency cycle;
- which types and subpaths are externally consumed;
- PGlite and real-Postgres proof coverage; and
- whether newer work has already established a better vertical slice.

An alternative is to separate pure Declarative V2 verifier transition and
derivation policy from its progress repository while leaving the repository and
transaction mechanics in Postgres. The same preflight requirements apply.

## Non-Goals

This note does not authorize:

- a repository-wide folder move;
- a package-wide Effect conversion;
- a new universal persistence or repository abstraction;
- rewriting working SQL or transaction flows for architectural symmetry;
- moving all models or errors out of persistence regardless of ownership;
- changing schema, migrations, DDL, transaction order, isolation, or locks;
- changing tenant identity or authority;
- adding Trigger.dev packages to the Flarex workspace;
- adopting Trigger.dev's Prisma schema or organization model;
- breaking or silently replacing existing package exports; or
- creating dual writes, silent fallbacks, or parallel commit/OCC systems.

## Revalidation Checklist

Before converting this idea into an accepted roadmap or implementation goal:

- [ ] Recount and classify current source files by domain and responsibility.
- [ ] Rebuild the package import and reverse-import graph.
- [ ] Inventory root and subpath exports plus their actual consumers.
- [ ] Identify files mixing domain policy, repository, transaction, adapter,
      composition, and compatibility responsibilities.
- [ ] Verify current Effect, Drizzle, PostgreSQL, and PGlite versions.
- [ ] Locate transaction, lock, rollback, and real-Postgres proof boundaries.
- [ ] Check current application-revision, Declarative V2, and durable-task
      roadmaps for newer authority decisions.
- [ ] Decide whether internal domain organization is sufficient before
      proposing new packages.
- [ ] Define one narrow vertical slice with explicit compatibility and removal
      gates.
- [ ] Update the owning roadmap before implementation begins.

## Open Questions

1. Which operations in `@flarex/persistence-postgres` express database policy,
   and which express application or platform policy merely implemented beside
   the database?
2. Which existing public exports have real supported consumers versus only
   package-local tests?
3. Can application-revision and verifier domain contracts move without creating
   dependency cycles, or is a narrow ports package eventually justified?
4. Should the broad `FlarexRuntimePersistence` compatibility interface be
   decomposed into capability interfaces before any file movement?
5. Which large modules require one transaction owner even after their pure
   planning and model responsibilities are separated?
6. Where should the future private Task System port live so its domain does not
   depend on Postgres while its adapter retains full transaction authority?
7. What boundary yields the most clarity with the smallest behavioral and
   compatibility risk when the work is eventually scheduled?
