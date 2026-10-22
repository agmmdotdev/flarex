import { randomUUID } from "node:crypto";

export interface PostgresStorageSchema {
  readonly schemaName: string;
  readonly migrationsSchema: string;
}

export interface PostgresStorageLease extends PostgresStorageSchema {
  readonly leaseId: string;
  readonly fresh: boolean;
  readonly seal: string | null;
}

/** Runner-local resources; a returned lease is exclusive until its worker has
 * drained callbacks, closed every connection and explicitly returned it clean.
 * A worker disappearing never makes its resource eligible for reuse. */
export function createPostgresStorageLeasePool(options: {
  readonly maximumSchemas: number;
  readonly create: (schema: PostgresStorageSchema) => Promise<void>;
  readonly destroy: (schema: PostgresStorageSchema) => Promise<void>;
  readonly assertDisconnected: (schema: PostgresStorageSchema) => Promise<void>;
}) {
  type Entry = { readonly schema: PostgresStorageSchema; readonly key: string;
    leaseId: string; seal: string | null; state: "leased" | "ready" | "quarantined" };
  const entries = new Set<Entry>();
  let pending = Promise.resolve();
  let closing: Promise<void> | undefined;
  let retirementFailure: { readonly cause: unknown } | undefined;
  const statistics = { created: 0, reused: 0, quarantined: 0, destroyed: 0 };
  const enqueue = <A>(run: () => Promise<A>): Promise<A> => {
    const result = pending.then(run);
    pending = result.then(() => undefined, () => undefined);
    return result;
  };
  const retire = async (entry: Entry) => {
    entry.state = "quarantined";
    try {
      await options.assertDisconnected(entry.schema);
      await options.destroy(entry.schema);
      entries.delete(entry);
      statistics.destroyed++;
    } catch (cause: unknown) { retirementFailure = { cause }; throw cause; }
  };
  return {
    statistics: () => ({ ...statistics, retained: entries.size }),
    acquire(key: string): Promise<PostgresStorageLease> {
      if (closing !== undefined) return Promise.reject(new Error("Postgres storage session is closing"));
      return enqueue(async () => {
        if (retirementFailure !== undefined) throw retirementFailure.cause;
        // Changed bootstrap inputs cannot reuse any previously prepared schema.
        for (const entry of entries) if (entry.state === "ready" && entry.key !== key) await retire(entry);
        let entry = [...entries].find(entry => entry.state === "ready" && entry.key === key);
        const fresh = entry === undefined;
        if (entry === undefined) {
          if (entries.size >= options.maximumSchemas) throw new Error("Postgres storage schema lease budget exhausted");
          const name = randomUUID().replaceAll("-", "");
          entry = { schema: { schemaName: `flarex_storage_${name}`, migrationsSchema: `flarex_storage_journal_${name}` },
            key, leaseId: randomUUID(), seal: null, state: "leased" };
          entries.add(entry);
          try { await options.create(entry.schema); statistics.created++; }
          catch (cause: unknown) {
            try { await retire(entry); }
            catch (cleanup: unknown) { throw new AggregateError([cause, cleanup], "Schema creation and retirement failed"); }
            throw cause;
          }
        } else { statistics.reused++; entry.leaseId = randomUUID(); entry.state = "leased"; }
        return { ...entry.schema, leaseId: entry.leaseId, fresh, seal: entry.seal };
      });
    },
    release(leaseId: string, healthy: boolean, seal: string | null): Promise<void> {
      if (closing !== undefined) return Promise.reject(new Error("Postgres storage session is closing"));
      return enqueue(async () => {
        const entry = [...entries].find(entry => entry.leaseId === leaseId && entry.state === "leased");
        if (entry === undefined) throw new Error("Unknown or already returned Postgres storage lease");
        if (!healthy) { statistics.quarantined++; await retire(entry); return; }
        try {
          if (seal === null || (entry.seal !== null && entry.seal !== seal)) throw new Error("Postgres storage baseline seal changed");
          await options.assertDisconnected(entry.schema);
          entry.seal = seal;
          entry.state = "ready";
        } catch (cause: unknown) {
          statistics.quarantined++;
          try { await retire(entry); }
          catch (cleanup: unknown) { throw new AggregateError([cause, cleanup], "Lease validation and retirement failed"); }
          throw cause;
        }
      });
    },
    close(): Promise<void> {
      closing ??= enqueue(async () => {
        const failures: unknown[] = [];
        for (const entry of entries) {
          if (entry.state === "leased") {
            failures.push(new Error(`Unreturned Postgres storage lease; refusing to retire ${entry.schema.schemaName}`));
            continue;
          }
          try { await retire(entry); }
          catch (cause: unknown) { failures.push(cause); }
        }
        if (failures.length > 0) throw new AggregateError(failures, "Postgres storage session cleanup failed");
      });
      return closing;
    },
  };
}
