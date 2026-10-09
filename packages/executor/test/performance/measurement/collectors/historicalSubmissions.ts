import { performance } from "node:perf_hooks";
import { Data, Schema } from "effect";
import type { Pool, PoolClient } from "pg";
import { structuralSql } from "../../../../../persistence-postgres/test/performance/mixedMutationPerformanceTrace";

export class HistoricalCaptureDiagnosticError extends Data.TaggedError("HistoricalCaptureDiagnosticError")<{
  readonly stage: string; readonly cause?: unknown;
}> {}

const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
export const HistoricalSubmissionSchema = Schema.Struct({
  ordinal: Schema.Natural, pool: Schema.Literals(["target", "setupControl", "managedReadControl"]),
  name: Schema.NullOr(Schema.String), fingerprint: Schema.NullOr(Schema.String),
  statementCount: Schema.NullOr(Schema.Natural),
  transactionAction: Schema.NullOr(Schema.Literals(["begin", "commit", "rollback"])),
  requiresPlan: Schema.Boolean,
  backendPid: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2_147_483_647 }))),
  startMonotonicMs: Milliseconds, endMonotonicMs: Schema.NullOr(Milliseconds),
  outcome: Schema.Literals(["success", "failure", "pending"]),
});
export type HistoricalSubmission = typeof HistoricalSubmissionSchema.Type;
const decodeSubmission = Schema.decodeUnknownSync(HistoricalSubmissionSchema);
type PoolName = HistoricalSubmission["pool"];

/** Observe only underlying pg client submissions. Pool.query delegation adds no
 * second count. Names, structural fingerprints and actual BackendKeyData PIDs
 * are retained; SQL and parameter values never enter this collector. */
export function createHistoricalSubmissionObserver(pools: Readonly<Record<PoolName, Pool>>) {
  const restores = new Map<PoolClient, () => void>();
  const listeners: Readonly<{ pool: Pool; acquire: (client: PoolClient) => void }>[] = [];
  let current: HistoricalSubmission[] | undefined;
  let failures: unknown[] = [];
  const fail = (cause: unknown) => { if (failures.length < 128) failures.push(cause); };
  const data = (value: object, key: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && !("value" in descriptor))
      throw new HistoricalCaptureDiagnosticError({ stage: "submissionAccessor" });
    return descriptor?.value;
  };
  const attach = (poolName: PoolName, client: PoolClient) => {
    if (restores.has(client)) return;
    const descriptor = Object.getOwnPropertyDescriptor(client, "query");
    const original = client.query;
    // SAFETY: the pg query overloads share this runtime argument/return protocol;
    // delegation is unchanged and the original descriptor is restored on close.
    const traced = function (this: PoolClient, ...args: readonly unknown[]) {
      const selected = current;
      if (selected === undefined) return Reflect.apply(original, this, args);
      let observation: HistoricalSubmission | undefined;
      try {
        const input = args[0];
        const config = typeof input === "object" && input !== null ? input : undefined;
        const text = typeof input === "string" ? input : config === undefined ? undefined : data(config, "text");
        const name = config === undefined ? null : data(config, "name") ?? null;
        const shape = structuralSql(text);
        observation = decodeSubmission({ ordinal: selected.length, pool: poolName, name,
          fingerprint: shape?.fingerprint ?? null, statementCount: shape?.statementCount ?? null,
          transactionAction: shape?.transactionAction ?? null,
          requiresPlan: shape !== null && /^(?:SELECT|WITH)\b/i.test(shape.template), backendPid: data(client, "processID") ?? null,
          startMonotonicMs: performance.now(), endMonotonicMs: null, outcome: "pending" });
      } catch (cause) { fail(cause); }
      // A synchronous pg validation throw is not a submitted query.
      const result: unknown = Reflect.apply(original, this, args);
      if (observation !== undefined) {
        if (selected.length >= 20_000) {
          fail(new HistoricalCaptureDiagnosticError({ stage: "submissionCapacity" }));
          return result;
        }
        const captured = observation;
        selected.push(captured);
        const index = selected.length - 1;
        if (result instanceof Promise) {
          const settle = (outcome: "success" | "failure") => {
            selected[index] = { ...captured, endMonotonicMs: performance.now(), outcome };
          };
          void result.then(() => settle("success"), () => settle("failure"));
        } else fail(new HistoricalCaptureDiagnosticError({ stage: "unsupportedSubmissionResult" }));
      }
      return result;
    } as typeof client.query;
    Object.defineProperty(client, "query", { value: traced, writable: true, configurable: true });
    restores.set(client, () => {
      if (client.query !== traced) throw new HistoricalCaptureDiagnosticError({ stage: "submissionObserverDisplaced" });
      if (descriptor === undefined) Reflect.deleteProperty(client, "query");
      else Object.defineProperty(client, "query", descriptor);
    });
  };
  for (const poolName of ["target", "setupControl", "managedReadControl"] as const) {
    const pool = pools[poolName];
    const acquire = (client: PoolClient) => attach(poolName, client);
    pool.on("acquire", acquire);
    listeners.push({ pool, acquire });
  }
  return {
    begin() {
      if (current !== undefined) throw new HistoricalCaptureDiagnosticError({ stage: "concurrentSubmissionWindow" });
      current = []; failures = [];
    },
    end() {
      if (current === undefined) throw new HistoricalCaptureDiagnosticError({ stage: "missingSubmissionWindow" });
      const submissions = current;
      current = undefined;
      return { submissions: [...submissions], failures: [...failures] };
    },
    close() {
      current = undefined;
      for (const { pool, acquire } of listeners) pool.off("acquire", acquire);
      const cleanup: unknown[] = [];
      for (const restore of restores.values()) {
        try { restore(); } catch (cause) { cleanup.push(cause); }
      }
      restores.clear();
      if (cleanup.length > 0) throw new AggregateError(cleanup, "Historical submission observer cleanup failed");
    },
  };
}
