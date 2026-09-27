import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { PostgresLocatedReadCommittedRunnerOptionsV1 } from
  "../../../persistence-postgres/src/postgresLocatedReadCommitted";
import type { createMixedMutationProductFixture } from "./mixedMutationProductFixture";

type MixedFixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
type PoolClient = Parameters<NonNullable<PostgresLocatedReadCommittedRunnerOptionsV1["afterAcquire"]>>[0];

function isPoolClient(value: unknown): value is PoolClient {
  return typeof value === "object" && value !== null && "query" in value &&
    typeof value.query === "function" && "release" in value && typeof value.release === "function";
}

function installCommitResponseFault(client: PoolClient,
  fault: (forward: () => unknown) => unknown): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(client, "query");
  const query = client.query;
  const installed = Reflect.set(client, "query", (...args: ReadonlyArray<unknown>): unknown => {
    const statement = args[0];
    const text = typeof statement === "string" ? statement :
      typeof statement === "object" && statement !== null && "text" in statement &&
        typeof statement.text === "string" ? statement.text : "";
    const forward = () => Reflect.apply(query, client, args);
    return text.trim().toLowerCase() === "commit" ? fault(forward) : forward();
  });
  if (!installed) throw new Error("Could not install PostgreSQL COMMIT response fault");
  return () => {
    if (originalDescriptor === undefined) Reflect.deleteProperty(client, "query");
    else Object.defineProperty(client, "query", originalDescriptor);
  };
}

async function committedCountFromIndependentConnection(
  fixture: MixedFixture, schemaName: string): Promise<number> {
  if (fixture.currency.resource.kind !== "postgres" || !/^[a-z_][a-z0-9_]*$/i.test(schemaName))
    throw new Error("Expected isolated PostgreSQL fixture schema");
  const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
  const result = await fixture.currency.resource.control.query<{ count: number }>(
    `select count(*)::int as count from "${schemaName}".fx_system_commit where scope_uuid = $1`, [scopeUuid]);
  return result.rows[0]?.count ?? 0;
}

/** The response is lost only after an independent connection sees exactly one
 * durable commit. The publisher must recover from its own committed evidence. */
export async function installOneCommitResponseFault(fixture: MixedFixture,
  baselineCommits: number, fault: () => unknown): Promise<Readonly<{ restore: () => void; fired: () => boolean }>> {
  if (fixture.currency.resource.kind !== "postgres") throw new Error("Expected real PostgreSQL fixture");
  const schemaName = (await fixture.currency.resource.target.query<{ schema: string }>(
    "select current_schema() as schema")).rows[0]?.schema;
  if (schemaName === undefined) throw new Error("Missing PostgreSQL fixture schema");
  const pool = fixture.currency.resource.target.pool;
  const originalDescriptor = Object.getOwnPropertyDescriptor(pool, "connect");
  const connect = pool.connect;
  const restoreQueries: Array<() => void> = [];
  let armed = true;
  let didFire = false;
  const decorate = (candidate: unknown): void => {
    if (!isPoolClient(candidate)) return;
    restoreQueries.push(installCommitResponseFault(candidate, forward => {
      if (!armed) return forward();
      return Promise.resolve(forward()).then(async result => {
        const committed = await committedCountFromIndependentConnection(fixture, schemaName);
        if (committed === baselineCommits) return result;
        if (committed !== baselineCommits + 1)
          throw new Error(`Expected exactly one mixed commit, observed ${committed - baselineCommits}`);
        armed = false;
        didFire = true;
        await fault();
        return result;
      });
    }));
  };
  const installed = Reflect.set(pool, "connect", (...args: ReadonlyArray<unknown>): unknown => {
    const callback = args[0];
    if (args.length === 1 && typeof callback === "function")
      return Reflect.apply(connect, pool, [(...callbackArgs: ReadonlyArray<unknown>) => {
        decorate(callbackArgs[1]);
        return Reflect.apply(callback, undefined, callbackArgs);
      }]);
    if (args.length > 0) return Reflect.apply(connect, pool, args);
    const acquired: unknown = Reflect.apply(connect, pool, args);
    return Promise.resolve(acquired).then(candidate => {
      if (!isPoolClient(candidate)) throw new Error("PostgreSQL pool returned no client");
      decorate(candidate);
      return candidate;
    });
  });
  if (!installed) throw new Error("Could not install PostgreSQL connection fault");
  return Object.freeze({
    fired: () => didFire,
    restore: () => {
      for (const restore of restoreQueries.toReversed()) restore();
      if (originalDescriptor === undefined) Reflect.deleteProperty(pool, "connect");
      else Object.defineProperty(pool, "connect", originalDescriptor);
    },
  });
}
