# Payload Release And Database-Adapter Contract

Status: accepted exact-release source audit; no Payload dependency, adapter,
runtime, write path, dashboard, public API, hosted path, or production
activation is authorized

Last reviewed: 2026-09-02

## Decision

Pin Payload `3.88.0` for the first private adapter compatibility profile. The
first proof is a headless Local API/request-transaction vertical that exercises
one flat CMS-managed Application collection while admitting the sanitized
configuration's separate dormant auth and internal definitions. It is not a
dashboard proof, full
`BaseDatabaseAdapter` parity, general hook execution, Payload migration
authority, or Cloudflare Worker compatibility claim.

All writes enter through Payload operations such as `payload.create`,
`payload.update`, and `payload.delete`. Calls to `payload.db.*` are adapter
internals and do not execute Payload access, defaults, validation, hooks,
versions, or lifecycle behavior. Ordinary `ctx.db` writes to a CMS-managed
table remain rejected.

The machine-readable companion is
[`payload-release-capability-map.json`](./payload-release-capability-map.json).

## Exact Release And Provenance

| Item | Exact value |
| --- | --- |
| npm package | `payload@3.88.0` |
| Stable dist-tag at audit time | `latest = 3.88.0` |
| Published | `2026-08-11T20:55:04.513Z` |
| npm tarball | `https://registry.npmjs.org/payload/-/payload-3.88.0.tgz` |
| npm SHA-1 | `2a534efd3287f712282723bdfc83dc7679c9c823` |
| npm integrity | `sha512-O7zuS80bvEGLte+7xZjwN05+ox5BCsGcQT2M6+CTote07JQOOvHJoiuoyQFw6cUElcFTWGMC5dy03w7J7sTYGg==` |
| Git annotated tag object | `c54dea8f4010d9cb194780f2ee1e4b3ec697f9be` |
| Git peeled release commit | `fea6f8a47a50ff1330d8a5071b43e7dcffb97b22` |
| License | MIT, Payload CMS, Inc. |
| Published Node engines | `^18.20.2 || >=20.9.0` |

Primary evidence:

- [npm registry metadata](https://registry.npmjs.org/payload/3.88.0)
- [Payload release `v3.88.0`](https://github.com/payloadcms/payload/releases/tag/v3.88.0)
- [exact release source](https://github.com/payloadcms/payload/tree/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22)
- [license](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/LICENSE.md)

The npm metadata does not publish `gitHead`. Record npm integrity and the Git
tag/commit as separate provenance facts; this audit does not claim a
cryptographic tarball-to-commit equivalence. Canaries and internal builds are
not substitutes for this stable pin.

## Exact `BaseDatabaseAdapter` Surface

Payload's adapter contract is a large mandatory interface, not a CRUD port.
The exact interface is
[`packages/payload/src/database/types.ts:17-170`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/database/types.ts#L17-L170).

| Family | Required or optional members |
| --- | --- |
| Lifecycle | optional `init`, `connect`, `destroy`, and `generateSchema` |
| Collection reads | `find`, `findOne`, `findDistinct`, `count` |
| Collection writes | `create`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `upsert` |
| Globals | create, find, and update global operations |
| Drafts and versions | query drafts plus collection/global version create/find/count/update/delete |
| Jobs | `updateJobs` |
| Transactions | `beginTransaction`, `commitTransaction`, `rollbackTransaction` |
| Migrations | create, up, down, fresh, refresh, reset, and status commands |
| Identity/configuration | adapter name, package name, default ID type, Payload instance, migration directory, optional sessions |

Transaction IDs are `number | string`; commit and rollback also accept a
promise of an ID. The exact contract is
[`types.ts:193-204`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/database/types.ts#L193-L204).

CRUD argument/result shapes live at
[`types.ts:508-683`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/database/types.ts#L508-L683).
The paginated result is a concrete envelope with documents, total counts, page
counts, current/next/previous pages, paging flags, and limit at
[`types.ts:696-707`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/database/types.ts#L696-L707).

The contract has known type/runtime compatibility differences. For example,
the type-level create result is a document while the official Drizzle
implementation can return `null` when `returning === false`. Later conformance
must exercise runtime behavior; satisfying the TypeScript interface is not a
compatibility proof.

## Request Transaction Semantics

Payload uses the shared request as its nesting owner:

1. the first mutation stores a pending or concrete adapter transaction ID on
   `req.transactionID`;
2. a nested operation that receives the same request waits for or reuses that
   ID and does not own commit;
3. field and collection hooks, including `afterChange`, run before the outer
   operation commits; and
4. an operation failure asks the adapter to roll back and rethrows the original
   operation failure.

The declared transaction-ID type is `number | string`, but `initTransaction`
tests the resolved value by truthiness both when reusing and when establishing
outer ownership. `0` and `""` therefore do not establish a valid outer
transaction and can leave the request holding a pending value. The first
Flarex adapter issues only an owned, branded nonblank string transaction ID;
the wider Payload type is compatibility input, not the admitted host policy.

Sources:

- [`initTransaction.ts:9-34`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/utilities/initTransaction.ts#L9-L34)
- [`create.ts:71-80`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/collections/operations/create.ts#L71-L80)
- [`create.ts:397-457`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/collections/operations/create.ts#L397-L457)
- [`commitTransaction.ts:8-14`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/utilities/commitTransaction.ts#L8-L14)
- [`killTransaction.ts:8-19`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/utilities/killTransaction.ts#L8-L19)

### Flarex consequences

- Override all three transaction functions. Payload's adapter factory otherwise
  installs no-transaction defaults that return `null` and resolve commit and
  rollback without work.
- A presented but unknown/expired transaction ID fails closed. Do not copy the
  official Drizzle helper's missing-session autocommit fallback.
- A missing, blank, zero, or otherwise unadmitted transaction ID fails before
  data access. It cannot be normalized into a new transaction or autocommit.
- Only the outer Payload operation may finalize the Flarex commit/change/outbox
  publication; nested operations reuse its transaction and contribute receipts.
- Payload deliberately suppresses rollback failures so the original operation
  error wins. The future host must retain the original error while recording a
  rollback/settlement failure as separate trusted evidence; it must not
  silently report clean rollback.
- Do not use the Dynamic Worker logical journal as the CMS request transaction.

Payload permits arbitrary hook code and can therefore keep its database
transaction open across slow callbacks, remote calls, and file work. That is
not admitted into Flarex's first bounded SQL transaction profile. The first
product configuration rejects user hooks, dynamic access callbacks, uploads,
and remote-effect lifecycle code. A conformance-only deterministic nested hook
may prove same-request transaction reuse; it does not authorize general hook
support. Full hook compatibility requires a later transaction/lifecycle
preflight that reconciles Payload's observable ordering with Flarex timeout,
interruption, settlement, and no-unbounded-transaction rules.

## Query And Result Contract

Payload `Where` permits nested `and`/`or` arrays and a structurally loose field
map. The pinned operator list is:

```text
equals, contains, not_equals, in, all, not_in, exists,
greater_than, greater_than_equal, less_than, less_than_equal,
like, not_like, within, intersects, near
```

Sources:

- [`types/index.ts:137-150`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/types/index.ts#L137-L150)
- [`types/constants.ts:1-22`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/types/constants.ts#L1-L22)

The first profile admits only ID/equality filtering over exact declared scalar
identities/indexes, deterministic bounded sort, limit, page, and pagination.
Every other operator, arbitrary Boolean query, field selection, population,
locale, join query, distinct query, and aggregate behavior rejects before data
access. The adapter must translate admitted query values; it must not expose a
general Payload or public Flarex query AST.

Adapter methods reject by throwing; there is no typed adapter error union.
Payload's official Drizzle code maps unique violations to `ValidationError` and
rethrows other errors. The first Flarex profile preserves that observable
unique-conflict family, maps admitted invalid query/validation behavior to the
exact Payload error class, and keeps other trusted Flarex causes behind a
non-public server error boundary. Exact message/path/result compatibility is
still an implementation conformance obligation.

## Internal Collection And Global Obligations

Configuration sanitization requires an auth collection. If none is supplied,
`sanitizeAdminConfig` adds the default `users` collection. The first profile
therefore declares one explicit dormant auth collection with
`lockDocuments: false`; it does not claim that auth behavior is disabled or
that `posts` is literally the only sanitized collection. Auth operations and
the authenticated Admin UI remain unsupported.

Configuration sanitization always injects:

- `payload-preferences`; and
- `payload-migrations`.

It conditionally injects:

- `payload-locked-documents`;
- `payload-jobs`;
- `payload-folders`;
- `payload-query-presets`; and
- `payload-kv`.

It may also inject the `payload-jobs-stats` global. That value is not a
collection and must not be represented as one in adapter or binding catalogs.

The decisive sources are
[`sanitize.ts:72-91`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/config/sanitize.ts#L72-L91),
[`sanitize.ts:385-488`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/config/sanitize.ts#L385-L488),
and the default key-value collection injection in
[`defaults.ts:174-176`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/config/defaults.ts#L174-L176).
Every configured collection/global, including the explicit dormant auth
collection, must set `lockDocuments: false` where the option applies; undefined
currently enables it. The first profile also supplies a dedicated fail-closed
KV adapter so Payload does not select `databaseKVAdapter()` and inject
`payload-kv`; every KV operation throws the stable unsupported-capability
failure. Jobs, folders, query presets, versions/drafts, user globals, auth
operations, and uploads remain disabled.

An authenticated Admin UI is not scalar-only. `payload-preferences.user` is a
polymorphic relationship to every auth collection, and document locking adds
further user/document relationships. Therefore:

- the first scalar proof is headless Local API only;
- adapter initialization inventories the explicit dormant auth collection,
  the two always-present collections, and the preferences polymorphic relation,
  but does not claim their runtime lifecycle merely because sanitization
  created them;
- the bounded headless harness may serve `posts` only after proving that startup
  and every admitted operation touch no unbound internal surface; any internal,
  auth, preference, migration, or KV access fails closed before data access;
- the dashboard/auth gate waits for its dedicated preferences, auth, locking,
  polymorphic-relation, and lifecycle proof. The first monomorphic relation
  slice does not authorize it.

Ignoring internal collections would be false Payload compatibility. Mapping
`payload-migrations` directly onto ordinary content rows would also be false
migration authority; its later adapter view must compose the Flarex migration
coordinator without giving Payload startup implicit DDL authority.

## Relationship Contract And First Cutline

Payload relationship fields support monomorphic or polymorphic `relationTo`,
one or `hasMany` values, row bounds, population depth, and dynamic
`filterOptions`. The pinned source is
[`fields/config/types.ts:1216-1316`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/fields/config/types.ts#L1216-L1316).

The first relation slice remains top-level, nonlocalized, monomorphic one/many
only. Polymorphism, reverse join fields, arbitrary population/depth, dynamic
filters, localization, arrays/blocks, and relationship query ordering/counting
remain deferred.

The pinned relationship validator does not establish duplicate-target
rejection for `hasMany`, while Flarex's admitted native relation profile does.
Repeated targets are therefore an explicit unsupported input/profile, not a
claimed Payload parity behavior. The adapter rejects duplicates deterministically
until a later occurrence-identity gate proves the pinned semantics. Target
liveness and restrict deletion are likewise Flarex product constraints whose
Payload-facing error/result behavior needs explicit conformance evidence.

## First Private Compatibility Profile

| Disposition | Capability |
| --- | --- |
| Supported | One exercised flat `posts` collection with scalar text, number, Boolean, date, generated identity/timestamps, and bounded JSON only where the admitted content contract requires it; one explicit dormant auth collection exists solely to satisfy sanitized configuration |
| Supported | Payload operation pipeline for `create`, `find`, `findOne`, `count`, `updateOne`, and `deleteOne` |
| Supported | ID/equality filters, deterministic bounded sorting, limit/page/pagination, and exact result envelopes |
| Supported | One request-scoped transaction, one conformance-only nested same-request operation, outer-only commit, and rollback on nested failure |
| Supported | Unique conflict projected to the pinned Payload validation family; trusted unexpected failures remain non-public with causes retained |
| Deferred | Auth operations, preferences/internal collection operations, KV operations, `updateMany`, `deleteMany`, `upsert`, `findDistinct`, globals, drafts, versions, jobs, and migration commands |
| Deferred | General hooks/access callbacks, uploads/file work, remote effects, rich text, arrays, blocks, localization, and arbitrary JSON shapes |
| Deferred | Monomorphic one/many relations as the next content slice |
| Deferred | Polymorphic relations, reverse joins, population/depth, arbitrary `JoinQuery`, and repeated targets |
| Deferred | Authenticated Admin UI, REST/GraphQL, and public/generated `ctx.cms` |
| Rejected | Direct developer `db.insert`, `db.update`, or `db.delete` against a CMS-owned table |
| Rejected | Direct application use of `payload.db.*` as a CMS command |
| Rejected | Missing/unknown session autocommit fallback |
| Rejected | Claiming full adapter parity because unsupported required methods have stubs |
| Rejected | Payload CLI migrations, development schema push, or runtime startup DDL as Flarex authority |

Unsupported configuration rejects during compiler/admission or adapter
initialization. Interface members outside the admitted runtime matrix throw a
stable explicit unsupported-capability error if reached; they do not no-op,
fallback, or partially mutate.

## Migration Boundary

Payload's default migration functions use `payload-migrations`, filesystem-
loaded migration modules, request transactions, and Node process behavior; one
down path may call `process.exit(1)`. They are not suitable Worker or Flarex
migration authority:

- [`migrate.ts:10-55`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/database/migrations/migrate.ts#L10-L55)
- [`migrateDown.ts:10-61`](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/database/migrations/migrateDown.ts#L10-L61)

Application content schema continues through authenticated Application
Analysis/publication and managed-schema readiness. Payload lifecycle/data
intent remains Payload-owned but executes through the separately admitted
Flarex migration coordinator. First-profile migration methods fail explicitly;
they do not inherit the adapter factory's misleading defaults.

## Package And Host Direction

The future adapter direction is:

```text
@flarex/payload-adapter
  -> peer payload@3.88.0
  -> narrow private Flarex Application/CMS transaction facades

  -X-> @payloadcms/drizzle
  -X-> raw Drizzle, pg, SQL, commit, feed, or outbox authority
```

Payload publicly exports its adapter factory and database contract types, so a
custom adapter requires the `payload` contract, not the official Drizzle
implementation. The official comparison graph is:

```text
@payloadcms/db-postgres@3.88.0
  +-> @payloadcms/drizzle@3.88.0
  +-> drizzle-orm@0.45.2
  +-> drizzle-kit@0.31.7
  +-> pg@8.20.0
  `-> peer payload@3.88.0

@payloadcms/drizzle@3.88.0
  +-> drizzle-orm@0.45.2
  `-> peer payload@3.88.0
```

The later dashboard/HTTP composition separately pins
`@payloadcms/next@3.88.0` and its UI graph. Payload publishes a Node engine
contract; the existence of official D1 or Next adapters does not prove the
Payload core or dashboard works in Flarex's Cloudflare Worker host. Runtime,
bundle, Node-compatibility, dashboard, and hosted evidence remain separate
gates.

## Required First Proof

After the shared-core, Application-preservation, CMS transaction/commit, and
Application write-policy gates pass, the scalar proof must establish:

- exact sanitized-config admission and internal-collection inventory;
- no active dashboard/auth/HTTP/public surface;
- one CMS-managed Application table with ordinary developer writes denied;
- admitted scalar create/read/find/count/update/delete through Payload Local
  API operations, never direct adapter calls;
- the exact first query/result/error subset;
- same-request nested transaction reuse with no unknown-session fallback;
- transaction-local reads and rollback of every nested mutation;
- exactly one authenticated Application-row commit/change/outbox publication;
- PGlite functional evidence; and
- genuine PostgreSQL uniqueness, concurrency, transaction-local read,
  rollback, timeout, interruption, and settlement evidence.

## Stop Conditions

Stop for a new preflight if implementation would:

- enable arbitrary hooks, access callbacks, remote/file work, or dashboard
  behavior inside the first bounded SQL transaction;
- ignore or silently emulate an always-present internal collection;
- use Payload's migration defaults or filesystem/CLI lifecycle as Flarex
  authority;
- let an invalid transaction ID escape to autocommit;
- expose a required-but-deferred adapter member as a successful no-op;
- claim duplicate-target or relationship parity not proven against `3.88.0`;
- add `@payloadcms/drizzle`, raw database authority, or a second content schema;
- enable ordinary `ctx.db` writes to a CMS-managed table; or
- activate a dashboard, public `ctx.cms`, hosted route, or production binding.

## Next Authorized Slice

This audit, the exact Medusa source/capability audit, and the private value-only
`RelationalSchema` contract are complete. Payload content does not compile into
that contract, as recorded by
[`08-relational-schema-value-contract.md`](./08-relational-schema-value-contract.md).
The design-only relational installation/readiness/availability and structural
migration gate is also accepted in
[`09-relational-installation-and-migration-coordination.md`](./09-relational-installation-and-migration-coordination.md).
Its pure value checkpoint and every later binding, transaction, receipt, and
host gate remain ahead of Payload implementation while Application remains
Payload content's schema and row authority.
