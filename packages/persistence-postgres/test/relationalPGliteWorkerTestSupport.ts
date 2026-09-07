import { Worker } from "node:worker_threads";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { Cause, Effect, Exit } from "effect";
import { createPGlitePersistence } from "../src/pglite";
import type { QueryResult } from "../src/index";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { issueRelationalSession } from "../src/relationalTransaction/session";
import type { RunRelationalSession } from "../src/relationalTransaction/session";
import {
  RelationalSessionError,
  relationalLimits,
} from "../src/relationalTransaction/model";

/** One Wasm instance, one lease, with an external watchdog that can stop active SQL. */
export async function createRelationalPGliteFixture(options: { readonly fileBacked?: boolean } = {}) {
  // Only this fixture-created directory is removed by its registered cleanup.
  const dataDir = options.fileBacked === true ? await mkdtemp(join(tmpdir(), "flarex-relational-")) : undefined;
  const worker = new Worker(
    new URL("./relationalPGliteWorker.mjs", import.meta.url),
    { workerData: { dataDir } },
  );
  let id = 0;
  let timeoutMs = 30_000;
  let dead = false;
  let blockNext = false;
  let terminated: Promise<number> | undefined;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (cause: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const terminate = async (cause: unknown) => {
    dead = true;
    terminated ??= worker.terminate();
    await terminated;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(cause);
    }
    pending.clear();
  };
  worker.on("error", (cause) => {
    void terminate(cause);
  });
  worker.on(
    "message",
    (message: {
      id: number;
      ok: boolean;
      value?: unknown;
      error?: { message: string; code?: string };
    }) => {
      const item = pending.get(message.id);
      if (item === undefined) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.ok) item.resolve(message.value);
      else
        item.reject(
          Object.assign(
            new Error(message.error?.message ?? "PGlite worker failure"),
            { code: message.error?.code },
          ),
        );
    },
  );
  onTestFinished(async () => {
    await terminate(new Error("Fixture closed"));
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  });
  const request = (
    method: "query" | "exec" | "reopen",
    query: string,
    params?: readonly unknown[],
    rowMode?: string,
  ): Promise<unknown> => {
    if (dead) return Promise.reject(new Error("PGlite instance quarantined"));
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        void terminate(new Error("PGlite active-statement deadline exceeded"));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      worker.postMessage({ id: requestId, method, query, params, rowMode });
    });
  };
  let tail: Promise<unknown> = Promise.resolve();
  const serialized = <Value>(run: () => Promise<Value>): Promise<Value> => {
    const result = tail.then(run);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const query = async <Row extends Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
    options?: { rowMode?: string },
  ): Promise<QueryResult<Row>> => {
    if (blockNext && text.includes("jsonb_build_object")) {
      blockNext = false;
      await request(
        "query",
        "select sum(i) from generate_series(1,1000000000) i",
      );
    }
    const result = await request("query", text, params, options?.rowMode);
    // SAFETY: exact PGlite query response crosses structured clone, without re-shaping rows or fields.
    return result as QueryResult<Row>;
  };
  const tx = { query, exec: (text: string) => request("exec", text) };
  const client = {
    query: <Row extends Record<string, unknown>>(
      text: string,
      params?: readonly unknown[],
      options?: { rowMode?: string },
    ) => serialized(() => query<Row>(text, params, options)),
    exec: (text: string) => serialized(() => tx.exec(text)),
    transaction: <Value>(work: (transaction: typeof tx) => Promise<Value>) =>
      serialized(async () => {
        timeoutMs = 30_000;
        await tx.exec("begin");
        try {
          const value = await work(tx);
          await tx.exec("commit");
          return value;
        } catch (cause) {
          await tx.exec("rollback");
          throw cause;
        }
      }),
  };
  const persistence = await createPGlitePersistence({ db: client });
  await persistence.migrate();
  const run: RunRelationalSession = Effect.fn(
    "RelationalPGliteTestSession.run",
  )(<Value, Failure>(
    work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>,
  ) => {
    // Runtime bridge owns the controller and waits for the whole transaction on interruption.
    let settled: Promise<Value> | undefined;
    const controller = new AbortController();
    let callbackCause: Cause.Cause<Failure> | undefined;
    const rollback = new Error("Relational callback rollback");
    return Effect.callback<Value, Failure | RelationalSessionError>(
      (resume) => {
        settled = persistence.drizzle.transaction(async (transaction) => {
          // Set the budget only after obtaining this instance's transaction lease.
          timeoutMs = relationalLimits.statementMs;
          const exit = await Effect.runPromiseExit(work(transaction), {
            signal: controller.signal,
          });
          if (Exit.isFailure(exit)) {
            callbackCause = exit.cause;
            throw rollback;
          }
          return exit.value;
        });
        settled.then(
          (value) => resume(Effect.succeed(value)),
          (cause) =>
            resume(
              cause === rollback && callbackCause !== undefined
                ? Effect.failCause(callbackCause)
                : callbackCause === undefined
                  ? Effect.fail(
                      new RelationalSessionError({
                        reason: "resourceFailure",
                        cause,
                      }),
                    )
                  : Effect.failCause(
                      Cause.combine(
                        callbackCause,
                        Cause.fail(
                          new RelationalSessionError({
                            reason: "cleanupFailure",
                            cause,
                          }),
                        ),
                      ),
                    ),
            ),
        );
        return Effect.uninterruptible(
          Effect.promise(async () => {
            controller.abort();
            await settled?.catch(() => undefined);
          }),
        );
      },
    );
  });
  const session = issueRelationalSession(persistence.drizzle, run);
  return {
    persistence,
    session,
    reopen: () => serialized(async () => {
      if (dataDir === undefined) throw new Error("Reopen requires a file-backed fixture");
      timeoutMs = 30_000;
      await request("reopen", "");
    }),
    isQuarantined: () => dead,
    blockNextStoreRead: () => {
      blockNext = true;
    },
  };
}
