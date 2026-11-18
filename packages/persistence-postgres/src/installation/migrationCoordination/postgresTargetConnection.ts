import { createTableRelationsHelpers, extractTablesRelationalConfig,
  type ExtractTablesWithRelations } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { NodePgSession, NodePgTransaction } from "drizzle-orm/node-postgres/session";
import { type Client, type ClientConfig } from "pg";

import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { flarexSchema } from "../../database/schema";
import { sendPostgresCancelRequest, settleWithinPlatformTimeout } from "./postgresTargetTransport";

export type PostgresMigrationPhase = "acquire" | "begin" | "configure" | "work" | "commit" | "rollback" | "release";
export interface PostgresMigrationObserverInput {
  readonly phase: PostgresMigrationPhase;
  readonly edge: "before" | "after";
  readonly client: Client;
  readonly text?: string;
  readonly elapsedMilliseconds?: number;
}
export interface PostgresMigrationConnectionOptions {
  readonly maximumStatementsPerTransaction: number;
  /** Private test/diagnostic seam; failures participate in settlement. */
  readonly observe?: (input: PostgresMigrationObserverInput) => void;
}

type Tables = ExtractTablesWithRelations<typeof flarexSchema>;
const extracted = extractTablesRelationalConfig<Tables>(flarexSchema, createTableRelationsHelpers);
const schema = { fullSchema: flarexSchema, schema: extracted.tables, tableNamesMap: extracted.tableNamesMap };
const dialect = new PgDialect();

/** Owns one checked-out transport. No repository or migration authority lives here. */
export function makePostgresMigrationConnection(
  client: Client,
  config: ClientConfig,
  options: PostgresMigrationConnectionOptions,
) {
  const pending = new Set<Promise<void>>();
  let open = true;
  let released = false;
  let workFailure: { readonly cause: unknown } | undefined;
  let connectionFailure: { readonly cause: unknown } | undefined;
  let statements = 0;
  const onError = (cause: Error) => { connectionFailure ??= { cause }; };
  client.on("error", onError);
  const track = <Value>(promise: Promise<Value>): Promise<Value> => {
    const mirror: Promise<void> = promise.then(
      () => { pending.delete(mirror); },
      cause => { workFailure ??= { cause }; pending.delete(mirror); },
    );
    pending.add(mirror);
    return promise;
  };
  const observe = (phase: PostgresMigrationPhase, edge: "before" | "after", text?: string) => {
    options.observe?.({ phase, edge, client, ...(text === undefined ? {} : { text }) });
  };
  const query = (phase: PostgresMigrationPhase, text: string, values?: readonly unknown[]) =>
    track(Promise.resolve().then(() => {
      observe(phase, "before", text);
      if (connectionFailure !== undefined) throw connectionFailure.cause;
      return client.query(text, values === undefined ? undefined : [...values]);
    }).then(result => {
      observe(phase, "after", text);
      if (connectionFailure !== undefined) throw connectionFailure.cause;
      return result;
    }));
  const trackedQuery = (...args: readonly unknown[]): unknown => {
    // Drizzle submits promises through this proxy. The closed fence also rejects
    // late continuations retaining the transaction after interruption or return.
    const first = args[0];
    const text = typeof first === "string" ? first :
      typeof first === "object" && first !== null ? Reflect.get(first, "text") : undefined;
    return track(Promise.resolve().then(() => {
      if (!open) throw new Error("Framework migration transaction work is closed.");
      statements += 1;
      if (statements > options.maximumStatementsPerTransaction) {
        throw new Error("Framework migration transaction statement budget exhausted.");
      }
      observe("work", "before", typeof text === "string" ? text : undefined);
      if (connectionFailure !== undefined) throw connectionFailure.cause;
      // This is the foreign node-postgres overload boundary. Preserve Drizzle's
      // exact arguments and its driver's promise rather than emulating its API.
      const result: unknown = Reflect.apply(client.query, client, args);
      return Promise.resolve(result);
    }).then(result => {
      observe("work", "after", typeof text === "string" ? text : undefined);
      if (connectionFailure !== undefined) throw connectionFailure.cause;
      return result;
    }));
  };
  const trackedClient = new Proxy(client, {
    get(target, property, receiver) {
      return property === "query" ? trackedQuery : Reflect.get(target, property, receiver);
    },
  });
  const session = new NodePgSession(trackedClient, dialect, schema);
  const transaction: FlarexMetadataTransaction = new NodePgTransaction(dialect, session, schema);
  const processId: unknown = Reflect.get(client, "processID");
  const secretKey: unknown = Reflect.get(client, "secretKey");
  const backendKey = typeof processId === "number" && Number.isInteger(processId) && processId > 0 &&
    typeof secretKey === "number" && Number.isInteger(secretKey) ? { processId, secretKey } : undefined;
  const drain = async () => { while (pending.size > 0) await Promise.all(pending); };
  const release = () => {
    if (released) return;
    // A throwing observer leaves cleanup with the dedicated transport owner.
    let fault: { cause: unknown } | undefined;
    try { observe("release", "before"); } catch (cause) { fault = { cause }; }
    if (fault !== undefined) throw fault.cause;
    released = true;
    client.removeListener("error", onError);
    observe("release", "after");
  };
  const quarantine = async (timeoutMilliseconds: number) => {
    open = false;
    const expiresAt = performance.now() + timeoutMilliseconds;
    const remaining = () => Math.max(1, Math.ceil(expiresAt - performance.now()));
    const failures: unknown[] = [];
    if (pending.size > 0) {
      try {
        if (backendKey === undefined) throw new Error("PostgreSQL cancellation identity unavailable.");
        await sendPostgresCancelRequest(backendKey, config, remaining());
      } catch (cause) { failures.push(cause); }
      try { await settleWithinPlatformTimeout(drain(), remaining(), "Dedicated maintenance migration drain timed out."); }
      catch (cause) { failures.push(cause); }
    }
    // Closing the frontend alone cannot stop a backend waiting on a SQL lock.
    // Cancellation and drain precede end; failed cleanup still attempts end.
    try { await settleWithinPlatformTimeout(client.end(), remaining(), "Dedicated maintenance migration transport did not close."); }
    catch (cause) { failures.push(cause); }
    released = true;
    client.removeListener("error", onError);
    if (failures.length > 0) throw new AggregateError(failures, "Dedicated maintenance migration quarantine failed.");
  };
  return { transaction, client, query, drain, release, quarantine,
    close: () => { open = false; },
    isReleased: () => released,
    failure: () => workFailure ?? connectionFailure,
    hasPending: () => pending.size > 0,
  };
}

export type PostgresMigrationConnection = ReturnType<typeof makePostgresMigrationConnection>;
