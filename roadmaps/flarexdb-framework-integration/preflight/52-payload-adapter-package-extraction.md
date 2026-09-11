# Payload Adapter Package Extraction

Status: approved and implemented private ownership correction

## Outcome And Boundary

Move the already-proven pinned Payload compatibility implementation into the
plain private `@flarex/payload-adapter` package. The package owns the exact
`payload@3.88.0` profile, `BaseDatabaseAdapter` bridge, Local API runtime,
normalization, bounded population, and Payload-facing failure projection.

`@flarex/persistence-postgres` retains authoritative Application row/relation
storage, CMS request admission, transaction settlement, preference lifecycle
storage and cleanup, materialization, commit facts, and publication. The
adapter consumes those capabilities only through the explicit private
`internal/cms-adapter` facade; it does not import raw Drizzle, Postgres, SQL,
commit, feed, or outbox owners.

The adapter issues an opaque token for its four exact content identities.
Binding prepare, activation, and cold re-admission require that token whenever
Payload preference lifecycle storage is selected. Persistence validates the
token and identity match without importing Payload release constants; the CMS
host independently rechecks the selected runtime identity under the scope lock.

This extraction adds no operation, schema, route, `ctx.cms` API, dashboard,
deployment target, migration authority, or production claim. Payload and
Medusa remain separate framework-semantic packages over shared persistence.

## Why Now And Evidence

The scalar, optional-one, fresh-many, population, reverse-join, and preference
cleanup proofs already exercise one coherent Payload implementation. Keeping
that implementation under `persistence-postgres/src/payloadScalar` contradicts
the accepted package boundary and makes persistence appear to own Payload
release semantics. The nearest proof advanced by this change is structural:
the existing behavior runs unchanged after the owner move and persistence
production sources no longer import Payload release code.

The governing evidence is the accepted Payload adapter design, the exact
release contract, the completed focused Payload conformance records, and the
repository package-boundary roadmap.

## Challenged Alternatives

- Retaining the implementation in persistence leaves framework behavior with
  the database owner and is rejected.
- Creating a universal framework database adapter would merge Payload Local API
  and Medusa module semantics and is rejected.
- Copying or wrapping the old path for compatibility is rejected because there
  is no shipped public contract or durable-data identity attached to that
  private source location.
- Moving transaction, publication, or preference storage into the adapter is
  rejected because those remain Postgres-authoritative shared owners.

## Retain, Move, Replace, Delete

| Decision | Scope |
| --- | --- |
| Retain | CMS admission/settlement, Application materialization, preference storage/cleanup, commit facts/publication, and all existing behavioral assertions. |
| Move | Payload release contract, profile identities, database adapter, Local API runtime, join/many/population normalization, and Payload-facing test exports. |
| Replace | Deep imports into persistence internals with one narrow private `internal/cms-adapter` facade; lifecycle binding derives storage provenance locally and consumes an opaque adapter-issued content profile set, while the CMS host independently authenticates the selected runtime identity. |
| Delete | The private `persistence-postgres/src/payloadScalar` owner and its scalar-named adapter/runtime symbols. No compatibility alias is retained because there is no supported external consumer. |

## Completion Gates

- Both packages typecheck independently, changed-source lint passes, and the
  relocated adapter introduces no new Effect runtime boundary.
- The complete existing Payload PGlite matrix passes without weakened
  assertions, including an explicit refusal when lifecycle admission lacks the
  adapter-owned content identity and when binding admission lacks the opaque
  adapter profile set.
- A checked-in self-import test resolves every declared adapter package subpath.
- The ordinary-role PostgreSQL lane remains required when
  `FLAREX_POSTGRES_DATABASE_URL` is available; absence must be reported rather
  than represented as a run.
- The cross-domain Currency/Payload composition still resolves the relocated
  private runtime.
- Both required repository reviewers inspect the final bounded diff.
- Only owned Payload/package-boundary files and the Payload lockfile hunk enter
  the commit; concurrent Medusa work remains untouched.
