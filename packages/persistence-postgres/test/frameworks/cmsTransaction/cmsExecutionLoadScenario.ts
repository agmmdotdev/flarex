import { Cause, Clock, Effect, Exit, Result, Schema } from "effect";
import { expect } from "vitest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeAppDocumentIdentityV1Result } from "flarex-protocol/app-document-id";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import { findSqlState } from "../../../src/commit/pointCommitErrors";
import { CmsTransactionError } from "../../../src/frameworks/cmsTransaction/model";
import { ScopeAuthorizationRevocationEpochPersistenceError } from "../../../src/scope/scopeClock";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { withPostgresExecutionObservation } from "../../performance/postgresExecutionObservation";
import { runEffect } from "../../support/effectTestRuntime";

const decodeDocuments = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ _id: Schema.String })),
);

interface CmsLoadConfiguration {
  readonly scopes: 1 | 4;
  readonly concurrency: 1 | 4 | 12;
  readonly requests: 24;
  readonly samples: 1 | 3;
}

interface CmsLoadSample {
  readonly sample: number;
  readonly startingRows: readonly number[];
  readonly offered: number;
  readonly settled: number;
  readonly completed: number;
  readonly failed: number;
  readonly zeroRefusalTargetMet: boolean;
  readonly explicitRetries: number;
  readonly admissionDeadlines: number;
  readonly publicationDeadlines: number;
  readonly elapsedMilliseconds: number;
  readonly completedRequestsPerSecond: number;
  readonly peakActive: number;
  readonly sampledPoolWaiters: number | null;
  readonly sampledBorrowedClients: number | null;
  readonly queue: ReturnType<typeof distribution>;
  readonly execution: ReturnType<typeof distribution>;
  readonly response: ReturnType<typeof distribution>;
  readonly requests: readonly {
    readonly index: number;
    readonly scopeIndex: number;
    readonly succeeded: boolean;
    readonly executionAttempts: number;
    readonly sqlStates: readonly (string | null)[];
    readonly queueMilliseconds: number;
    readonly executionMilliseconds: number;
    readonly responseMilliseconds: number;
  }[];
  readonly observation:
    | Awaited<
        ReturnType<typeof withPostgresExecutionObservation>
      >["observation"]
    | null;
}

/** Finite offered bursts, not a sustained arrival-rate/capacity generator. */
export async function cmsExecutionLoadScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  session: RelationalSession,
  configuration: CmsLoadConfiguration,
) {
  const fixtures: Awaited<ReturnType<typeof cmsExecutionMeasurementFixture>>[] =
    [];
  for (let index = 0; index < configuration.scopes; index++) {
    const tested = await cmsExecutionMeasurementFixture(persistence, session);
    const before = await tested.inventory();
    const value = await runEffect(
      tested.host.run(tested.host.newRequestKey(), tested.insert, {
        count: 8,
        prefix: "warmup",
      }),
    );
    await tested.verifyInsert(before, value, 8, "warmup");
    fixtures.push(tested);
  }
  const first = fixtures[0];
  if (first === undefined) throw new Error("Missing load scope");
  const pool = "pool" in persistence ? persistence.pool : undefined;
  const samples: CmsLoadSample[] = [];
  for (let sample = 0; sample < configuration.samples; sample++) {
    const before = await Promise.all(
      fixtures.map((tested) => tested.inventory()),
    );
    const executions = fixtures.map((tested) => tested.executionCount());
    // Equal request keys and natural keys deliberately coexist across scopes.
    const keys = Array.from(
      { length: configuration.requests / configuration.scopes },
      () => first.host.newRequestKey(),
    );
    const requests = Array.from(
      { length: configuration.requests },
      (_, index) => {
        const scopeIndex = index % configuration.scopes;
        const ordinal = Math.floor(index / configuration.scopes);
        const tested = fixtures[scopeIndex];
        const key = keys[ordinal];
        if (tested === undefined || key === undefined)
          throw new Error("Missing load request owner");
        return {
          index,
          scopeIndex,
          tested,
          key,
          args: { count: 8, prefix: `load-${sample}-${ordinal}` },
        };
      },
    );
    const execute = () =>
      runEffect(
        Effect.scoped(
          Effect.gen(function* () {
            let active = 0;
            let peakActive = 0;
            let sampledPoolWaiters = 0;
            let sampledBorrowedClients = 0;
            const samplePool = () => {
              if (pool === undefined) return;
              sampledPoolWaiters = Math.max(
                sampledPoolWaiters,
                pool.waitingCount,
              );
              sampledBorrowedClients = Math.max(
                sampledBorrowedClients,
                pool.totalCount - pool.idleCount,
              );
            };
            if (pool !== undefined) {
              yield* Effect.gen(function* () {
                while (true) {
                  samplePool();
                  yield* Effect.sleep("5 millis");
                }
              }).pipe(Effect.forkScoped);
            }
            const offeredAt = yield* Clock.monotonicTimeNanos;
            const results = yield* Effect.forEach(
              requests,
              Effect.fn(function* (request) {
                const startedAt = yield* Clock.monotonicTimeNanos;
                active++;
                peakActive = Math.max(peakActive, active);
                samplePool();
                const exit = yield* request.tested.host
                  .run(request.key, request.tested.insert, request.args)
                  .pipe(
                    Effect.exit,
                    Effect.ensuring(
                      Effect.sync(() => {
                        active--;
                        samplePool();
                      }),
                    ),
                  );
                const finishedAt = yield* Clock.monotonicTimeNanos;
                return {
                  request,
                  exit,
                  queueMilliseconds: Number(startedAt - offeredAt) / 1e6,
                  executionMilliseconds: Number(finishedAt - startedAt) / 1e6,
                  responseMilliseconds: Number(finishedAt - offeredAt) / 1e6,
                };
              }),
              { concurrency: configuration.concurrency },
            );
            const finishedAt = yield* Clock.monotonicTimeNanos;
            expect(active).toBe(0);
            return {
              results,
              elapsedMilliseconds: Number(finishedAt - offeredAt) / 1e6,
              peakActive,
              sampledPoolWaiters,
              sampledBorrowedClients,
            };
          }),
        ),
      );
    // A single phase covers all interleaved requests. Per-request attribution
    // using the observer's mutable phase label would misassign concurrent SQL.
    const observed =
      pool === undefined
        ? null
        : await withPostgresExecutionObservation(pool, async (mark) => {
            mark("cmsRequest");
            return execute();
          });
    const measured = observed === null ? await execute() : observed.value;
    const completed = measured.results.filter((result) =>
      Exit.isSuccess(result.exit),
    ).length;
    const timing = {
      sample,
      startingRows: before.map((state) => state.rows.length),
      offered: requests.length,
      settled: measured.results.length,
      completed,
      failed: measured.results.length - completed,
      zeroRefusalTargetMet: completed === requests.length,
      elapsedMilliseconds: measured.elapsedMilliseconds,
      completedRequestsPerSecond:
        (completed * 1000) / measured.elapsedMilliseconds,
      peakActive: measured.peakActive,
      sampledPoolWaiters:
        pool === undefined ? null : measured.sampledPoolWaiters,
      sampledBorrowedClients:
        pool === undefined ? null : measured.sampledBorrowedClients,
      queue: distribution(
        measured.results.map((result) => result.queueMilliseconds),
      ),
      execution: distribution(
        measured.results.map((result) => result.executionMilliseconds),
      ),
      response: distribution(
        measured.results.map((result) => result.responseMilliseconds),
      ),
      requests: measured.results.map((result) => ({
        index: result.request.index,
        scopeIndex: result.request.scopeIndex,
        succeeded: Exit.isSuccess(result.exit),
        executionAttempts: result.request.tested.prefixExecutionCount(result.request.args.prefix),
        sqlStates: Exit.isSuccess(result.exit)
          ? []
          : result.exit.cause.reasons.map((reason) =>
              Cause.isFailReason(reason)
                ? (findSqlState(reason.error) ?? null)
                : null,
            ),
        queueMilliseconds: result.queueMilliseconds,
        executionMilliseconds: result.executionMilliseconds,
        responseMilliseconds: result.responseMilliseconds,
      })),
      observation: observed?.observation ?? null,
    };
    // Keep the measured failure count visible even when correctness fails below.
    console.info(
      "CMS load burst",
      JSON.stringify({ configuration, ...timing }),
    );
    expect(timing.settled).toBe(configuration.requests);
    let admissionDeadlines = 0;
    let publicationDeadlines = 0;
    for (const result of measured.results) {
      const attempts = result.request.tested.prefixExecutionCount(result.request.args.prefix);
      if (Exit.isSuccess(result.exit)) {
        expect(attempts).toBe(1);
        continue;
      }
      // Identify the precise boundary, then independently prove callback count
      // and absence of durable effects. SQLSTATE alone never establishes retry.
      expect(pool).toBeDefined();
      expect(configuration.concurrency).toBeGreaterThan(1);
      const boundary = assertCmsLoadDeadline(result.exit.cause);
      expect(attempts).toBe(boundary === "admission" ? 0 : 1);
      if (boundary === "admission") admissionDeadlines++;
      else publicationDeadlines++;
    }
    expect(timing.peakActive).toBeLessThanOrEqual(configuration.concurrency);
    for (const result of measured.results) {
      expect(result.queueMilliseconds).toBeGreaterThanOrEqual(0);
      expect(result.executionMilliseconds).toBeGreaterThan(0);
      expect(result.responseMilliseconds).toBeCloseTo(
        result.queueMilliseconds + result.executionMilliseconds,
        6,
      );
    }
    if (pool !== undefined) {
      expect(pool.waitingCount).toBe(0);
      expect(pool.totalCount).toBe(pool.idleCount);
    }
    const successful = measured.results.flatMap((result) => {
      if (Exit.isFailure(result.exit)) return [];
      return [{ ...result.request, value: result.exit.value }];
    });
    for (const [scopeIndex, tested] of fixtures.entries()) {
      const prior = before[scopeIndex];
      if (prior === undefined) throw new Error("Missing scope inventory");
      const scoped = successful.filter(
        (result) => result.scopeIndex === scopeIndex,
      );
      const refused = measured.results.filter(
        (result) =>
          result.request.scopeIndex === scopeIndex &&
          Exit.isFailure(result.exit),
      );
      const after = await tested.verifyInserts(
        prior,
        scoped.map((result) => ({ value: result.value, ...result.args })),
      );
      const refusedExecutions = refused.reduce((sum, result) =>
        sum + tested.prefixExecutionCount(result.request.args.prefix), 0);
      expect(tested.executionCount()).toBe(
        (executions[scopeIndex] ?? -1) + scoped.length + refusedExecutions,
      );
      for (const result of refused)
        expect(
          after.outcomes.some((row) => row.requestKey === result.request.key),
        ).toBe(false);
      for (const result of scoped) {
        const outcome = after.outcomes.find(
          (row) => row.requestKey === result.key,
        );
        if (outcome === undefined) throw new Error("Missing request outcome");
        const identities = decodeDocuments(result.value).map((document) =>
          Result.getOrThrow(decodeAppDocumentIdentityV1Result(document._id)),
        );
        const expectedFacts = identities
          .map((identity) => `${identity.tableId}/${identity.rowId}`)
          .toSorted();
        expect(
          after.facts
            .filter((fact) => fact.commitSeq === outcome.commitSeq)
            .map(
              (fact) =>
                `${fact.tableId}/${encodeBytesToLowercaseHex(fact.rowId)}`,
            )
            .toSorted(),
        ).toEqual(expectedFacts);
        expect(
          await runEffect(
            tested.host.run(result.key, tested.insert, result.args),
          ),
        ).toEqual(result.value);
        expect(tested.prefixExecutionCount(result.args.prefix)).toBe(1);
        const other = fixtures[(scopeIndex + 1) % fixtures.length];
        if (other !== undefined && other !== tested) {
          const ids = decodeDocuments(result.value).map(
            (document) => document._id,
          );
          expect(await runEffect(other.host.read(other.read, ids))).toEqual(
            ids.map(() => null),
          );
        }
      }
      expect(tested.executionCount()).toBe(
        (executions[scopeIndex] ?? -1) + scoped.length + refusedExecutions,
      );
      expect(await tested.inventory()).toEqual(after);
      // Explicit retries are outside timing and only follow completed rollback
      // plus absence of every refused request's durable publication. This
      // fixture only stages transactional inserts; it has no external effects.
      // This is not retry authorization for arbitrary framework callbacks.
      for (const result of refused) {
        const beforeRetry = await tested.inventory();
        const executed = tested.executionCount();
        const prefixExecuted = tested.prefixExecutionCount(result.request.args.prefix);
        const value = await runEffect(
          tested.host.run(
            result.request.key,
            tested.insert,
            result.request.args,
          ),
        );
        const afterRetry = await tested.verifyInsert(
          beforeRetry,
          value,
          8,
          result.request.args.prefix,
        );
        expect(tested.executionCount()).toBe(executed + 1);
        expect(tested.prefixExecutionCount(result.request.args.prefix)).toBe(prefixExecuted + 1);
        expect(
          await runEffect(
            tested.host.run(
              result.request.key,
              tested.insert,
              result.request.args,
            ),
          ),
        ).toEqual(value);
        expect(tested.executionCount()).toBe(executed + 1);
        expect(tested.prefixExecutionCount(result.request.args.prefix)).toBe(prefixExecuted + 1);
        expect(await tested.inventory()).toEqual(afterRetry);
      }
    }
    samples.push({ ...timing, admissionDeadlines, publicationDeadlines, explicitRetries: timing.failed });
  }
  return { configuration, samples };
}

function distribution(values: readonly number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const median = sorted[Math.ceil(sorted.length * 0.5) - 1];
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  const maximum = sorted.at(-1);
  if (median === undefined || p95 === undefined || maximum === undefined)
    throw new Error("Missing load samples");
  return { samples: values.length, median, p95, maximum };
}

/** Test assertion only; callback counts and rollback must be proved separately. */
export function assertCmsLoadDeadline(
  cause: Cause.Cause<CmsTransactionError>,
): "admission" | "publication" {
  expect(cause.reasons.length).toBeGreaterThan(0);
  let boundary: "admission" | "publication" | undefined;
  for (const reason of cause.reasons) {
    if (!Cause.isFailReason(reason))
      throw new Error("Unexpected load failure", {
        cause: cause,
      });
    expect(reason.error).toBeInstanceOf(CmsTransactionError);
    expect(["55P03", "57014"], Cause.pretty(cause)).toContain(
      findSqlState(reason.error),
    );
    if (reason.error.reason === "resourceFailure") continue;
    expect(boundary, "One primary deadline owner is required").toBeUndefined();
    const owner = reason.error.cause;
    if (!(owner instanceof ScopeAuthorizationRevocationEpochPersistenceError))
      throw new Error("Missing load deadline owner", { cause });
    if (reason.error.reason === "invalidAuthority" && owner.operation === "lockForSnapshotRead")
      boundary = "admission";
    else if (reason.error.reason === "statementFailure" && owner.operation === "lockForOrdinaryWrite")
      boundary = "publication";
    else throw new Error("Unexpected load deadline boundary", { cause });
  }
  if (boundary === undefined) throw new Error("Missing primary load deadline", { cause });
  return boundary;
}
