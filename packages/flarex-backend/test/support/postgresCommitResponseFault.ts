import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { Pool, PoolClient } from "pg";
import type { createMixedMutationProductFixture } from "./mixedMutationWorkerdFixture";
import type { MixedMutationFinalEntryTestContext } from "./mixedMutationWorkerdFixture";

type MixedFixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;

function isPoolClient(value: unknown): value is PoolClient {
  return typeof value === "object" && value !== null && "query" in value &&
    typeof value.query === "function" && "release" in value && typeof value.release === "function";
}

function installCommitResponseFault(client: PoolClient,
  fault: (forward: () => unknown) => unknown, observeStatement?: (text: string) => void): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(client, "query");
  const query = client.query;
  const installed = Reflect.set(client, "query", (...args: ReadonlyArray<unknown>): unknown => {
    const statement = args[0];
    const text = typeof statement === "string" ? statement :
      typeof statement === "object" && statement !== null && "text" in statement &&
        typeof statement.text === "string" ? statement.text : "";
    const forward = () => Reflect.apply(query, client, args);
    observeStatement?.(text);
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
  baselineCommits: number, fault: () => unknown,
  afterCommitStatement?: (text: string) => void,
): Promise<Readonly<{ restore: () => void; fired: () => boolean }>> {
  if (fixture.currency.resource.kind !== "postgres") throw new Error("Expected real PostgreSQL fixture");
  const schemaName = (await fixture.currency.resource.target.query<{ schema: string }>(
    "select current_schema() as schema")).rows[0]?.schema;
  if (schemaName === undefined) throw new Error("Missing PostgreSQL fixture schema");
  let armed = true;
  let didFire = false;
  return installPoolCommitResponseFault(fixture.currency.resource.target.pool, () => ({
    observe: text => { if (didFire) afterCommitStatement?.(text); },
    commit: forward => {
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
    },
  }), () => didFire);
}

/** Lose only the response to the actual creation transaction, after PostgreSQL
 * has acknowledged its COMMIT. Callers independently inspect the durable rows. */
export function installOneEntryCommitResponseFault(context: MixedMutationFinalEntryTestContext,
  fault: () => unknown): Readonly<{ restore: () => void; fired: () => boolean }> {
  if (context.currency.resource.kind !== "postgres") throw new Error("Expected real PostgreSQL fixture");
  let didFire = false;
  return installPoolCommitResponseFault(context.currency.resource.target.pool, () => {
    let completedEntry = false;
    return {
      // The initial INSERT is private to the installed completion command.
      // Arm on its real invocation, then forward COMMIT before losing its response.
      observe: text => { if (/\bfx_complete_finite_entry\b"?\s*\(/i.test(text)) completedEntry = true; },
      commit: forward => {
        if (!completedEntry || didFire) return forward();
        return Promise.resolve(forward()).then(async result => {
          didFire = true;
          await fault();
          return result;
        });
      },
    };
  }, () => didFire);
}

/** Lose the acknowledgement of the real anchor-fencing transaction. A final
 * publication is never selected: the caller first provokes its real rollback. */
export function installOneFiniteFenceCommitResponseFault(fixture: MixedFixture):
  Readonly<{ restore: () => void; fired: () => boolean }> {
  if (fixture.currency.resource.kind !== "postgres") throw new Error("Expected real PostgreSQL fixture");
  let didFire = false;
  return installPoolCommitResponseFault(fixture.currency.resource.target.pool, () => {
    let changedClaimFence = false;
    return {
      observe: text => {
        if (/update\s+"?fx_system_tx_session"?\s/i.test(text) && /finite_claim_fence/i.test(text))
          changedClaimFence = true;
      },
      commit: forward => {
        if (!changedClaimFence || didFire) return forward();
        return Promise.resolve(forward()).then(() => {
          didFire = true;
          throw new Error("finite anchor fence COMMIT acknowledgement lost");
        });
      },
    };
  }, () => didFire);
}

export function installPoolCommitResponseFault(pool: Pool,
  makeFault: (client: PoolClient) => Readonly<{ commit: (forward: () => unknown) => unknown; observe?: (text: string) => void }>,
  fired: () => boolean): Readonly<{ restore: () => void; fired: () => boolean }> {
  const originalDescriptor = Object.getOwnPropertyDescriptor(pool, "connect");
  const connect = pool.connect;
  const restoreQueries: Array<() => void> = [];
  const decorate = (candidate: unknown): void => {
    if (!isPoolClient(candidate)) return;
    const fault = makeFault(candidate);
    restoreQueries.push(installCommitResponseFault(candidate, fault.commit, fault.observe));
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
    fired,
    restore: () => {
      for (const restore of restoreQueries.toReversed()) restore();
      if (originalDescriptor === undefined) Reflect.deleteProperty(pool, "connect");
      else Object.defineProperty(pool, "connect", originalDescriptor);
    },
  });
}
