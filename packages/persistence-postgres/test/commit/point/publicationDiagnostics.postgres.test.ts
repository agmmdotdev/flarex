import { readCe0Environment } from "../../performance/ce0Environment";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { withPostgresExecutionObservation } from "../../performance/postgresExecutionObservation";
import { expect, it } from "vitest";
import { type PointCommitSqlOperationV1 } from "../../../src/commit/point/errors";
import { runEffect } from "../../support/effectTestRuntime";
import {
  withPostgresPersistence,
  uuidFactory,
  createScope,
  createAttempt,
  enableIntrinsicIndexForPostgres,
  createPublisher,
  durableState,
  intrinsicIndexState,
  compareIntrinsicIndexRows,
  describePostgres,
} from "./support/postgresFixture";
import { percentileNearestRank } from "./support/postgresDiagnostics";

describePostgres("real Postgres O06 point-commit transaction kernel", () => {
  it("measures CE0 publication SQL and paired observer overhead through real COMMIT", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96440000");
      const environment = await readCe0Environment(persistence, ["../commit/point/publicationDiagnostics.postgres.test.ts"]);
      const samples: Array<{
        readonly rowCount: number;
        readonly pair: number;
        readonly instrumented: boolean;
        readonly elapsedMilliseconds: number;
        readonly preCommitKernelMilliseconds: number | null;
        readonly settlementInclusiveMilliseconds: number | null;
        readonly observation: Awaited<ReturnType<typeof withPostgresExecutionObservation>>["observation"] | null;
      }> = [];
      // One warm-up pair, then five pairs per size, alternating order. Each
      // sample starts with a fresh empty scope and one enabled intrinsic index.
      // Journal creation/sealing and index installation are outside timing.
      for (const rowCount of [1, 8, 32, 128]) {
        for (let pair = -1; pair < 5; pair += 1) {
          for (const instrumented of pair % 2 === 0
            ? [false, true]
            : [true, false]) {
            const label = `ce0_${rowCount}_${pair + 1}_${instrumented ? "obs" : "raw"}`;
            const scope = await createScope(persistence, randomUuid, label);
            const attempt = await createAttempt(
              persistence,
              randomUuid,
              scope,
              label,
              rowCount,
            );
            const intrinsic = await enableIntrinsicIndexForPostgres(
              persistence,
              scope,
            );
            const coarseQueries: PointCommitSqlOperationV1[] = [];
            let clockLockedAt: number | undefined;
            let beforeCommitAt: number | undefined;
            const started = performance.now();
            const measured = instrumented
              ? await withPostgresExecutionObservation(
                  persistence.pool,
                  async (markStep) =>
                    runEffect(
                      createPublisher(persistence, {
                        ...intrinsic,
                        observeQuery: (query) => {
                          coarseQueries.push(query.name);
                        },
                        afterTransactionStep: (event) => {
                          markStep(event.step);
                          if (event.step === "clockLocked")
                            clockLockedAt = performance.now();
                          if (event.step === "beforeCommit")
                            beforeCommitAt = performance.now();
                          return Promise.resolve();
                        },
                      }).publish(attempt.publicationCommand),
                    ),
                )
              : {
                  value: await runEffect(
                    createPublisher(persistence, intrinsic).publish(
                      attempt.publicationCommand,
                    ),
                  ),
                  observation: null,
                };
            const elapsedMilliseconds = performance.now() - started;
            expect(measured.value).toMatchObject({
              kind: "published",
              token: { commitSeq: 1n },
            });
            expect(
              await durableState(
                persistence,
                attempt.command.sealIdentity.scopeUuid,
              ),
            ).toEqual({
              revisions: String(rowCount),
              current_rows: String(rowCount),
              commit_headers: "1",
              commit_changes: String(rowCount),
              outcomes: "1",
              wakes: "1",
              last_commit_seq: "1",
            });
            const indexState = await intrinsicIndexState(
              persistence,
              attempt.command.sealIdentity.scopeUuid,
            );
            const expectedSidecars = attempt.command.rowIntents
              .map((intent) => ({
                tableId: intent.tableId.toString(),
                rowIdHex: intent.rowId.replaceAll("-", ""),
                commitSeq: "1",
                isTombstone: false,
              }))
              .sort(compareIntrinsicIndexRows);
            expect(indexState).toEqual({
              revisions: expectedSidecars,
              current: expectedSidecars.map(({ isTombstone: _, ...row }) => row),
            });
            if (measured.observation !== null) {
              expect(measured.observation.commands.begin).toBe(1);
              expect(measured.observation.commands.commit).toBe(1);
              expect(measured.observation.commands.rollback ?? 0).toBe(0);
              expect(measured.observation.queryCalls).toBeGreaterThan(
                coarseQueries.length,
              );
              expect(measured.observation.transmittedBytes).toBeGreaterThan(0);
              expect(
                measured.observation.familyQueries.fx_app_row_rev,
              ).toBe(1 + 2 * Math.ceil(rowCount / 32));
              expect(
                measured.observation.familyQueries.fx_app_index_entry_rev,
              ).toBe(3 * Math.ceil(rowCount / 32));
              expect(clockLockedAt).toBeTypeOf("number");
              expect(beforeCommitAt).toBeTypeOf("number");
            }
            if (pair >= 0)
              samples.push({
                rowCount,
                pair,
                instrumented,
                elapsedMilliseconds,
                preCommitKernelMilliseconds:
                  clockLockedAt === undefined || beforeCommitAt === undefined
                    ? null
                    : beforeCommitAt - clockLockedAt,
                settlementInclusiveMilliseconds:
                  clockLockedAt === undefined
                    ? null
                    : started + elapsedMilliseconds - clockLockedAt,
                observation: measured.observation,
              });
          }
        }
      }
      const summaries = [1, 8, 32, 128].map((rowCount) => {
        const normal = samples.filter(
          (sample) => sample.rowCount === rowCount && !sample.instrumented,
        );
        const observed = samples.filter(
          (sample) => sample.rowCount === rowCount && sample.instrumented,
        );
        const pairedRatios = observed.map((sample) => {
          const partner = normal.find((other) => other.pair === sample.pair);
          if (partner === undefined)
            throw new Error("Missing CE0 normal/instrumented pair.");
          return sample.elapsedMilliseconds / partner.elapsedMilliseconds;
        });
        const medianPairedRatio = percentileNearestRank(
          pairedRatios.sort((a, b) => a - b),
          0.5,
        );
        return {
          rowCount,
          medianPairedRatio,
          observerWithinTolerance: Math.abs(medianPairedRatio - 1) <= 0.05,
          normalMedianMilliseconds: percentileNearestRank(
            normal
              .map((sample) => sample.elapsedMilliseconds)
              .sort((a, b) => a - b),
            0.5,
          ),
          observedMedianMilliseconds: percentileNearestRank(
            observed
              .map((sample) => sample.elapsedMilliseconds)
              .sort((a, b) => a - b),
            0.5,
          ),
        };
      });
      const report = {
        ...environment,
        workload:
          "private native publisher; fresh scopes; intrinsic index; concurrency 1",
        warmupPairs: 1,
        measuredPairs: 5,
        observerMedianTolerance: 0.05,
        summaries,
        samples,
      };
      // Optional local artifact; no timing receipts belong in living roadmaps.
      if (process.env.FLAREX_CE0_REPORT_PATH !== undefined) {
        await writeFile(
          process.env.FLAREX_CE0_REPORT_PATH,
          JSON.stringify(report, null, 2) + "\n",
        );
      }
      console.info("CE0 publication baseline", JSON.stringify(report));
    });
  }, 900_000);

  it("attributes CE0 native persistence lifecycle work and recovery-only replay", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96460000");
      const environment = await readCe0Environment(persistence, [
        "../commit/point/publicationDiagnostics.postgres.test.ts",
      ]);
      const samples = [];
      for (const rowCount of [1, 8, 32, 128]) {
        for (let trial = -1; trial < 3; trial += 1) {
          const label = `ce0_lifecycle_${rowCount}_${trial + 1}`;
          const scope = await createScope(persistence, randomUuid, label);
          const intrinsic = await enableIntrinsicIndexForPostgres(
            persistence,
            scope,
          );
          const measured = await withPostgresExecutionObservation(
            persistence.pool,
            async (markPhase) => {
              const attempt = await createAttempt(
                persistence,
                randomUuid,
                scope,
                label,
                rowCount,
                markPhase,
              );
              markPhase("publication");
              const published = await runEffect(
                createPublisher(persistence, intrinsic).publish(
                  attempt.publicationCommand,
                ),
              );
              return { attempt, published };
            },
          );
          expect(measured.value.published).toMatchObject({
            kind: "published",
            token: { commitSeq: 1n },
          });
          const beforeReplay = await durableState(
            persistence,
            measured.value.attempt.command.sealIdentity.scopeUuid,
          );
          expect(beforeReplay).toEqual({
            revisions: String(rowCount),
            current_rows: String(rowCount),
            commit_headers: "1",
            commit_changes: String(rowCount),
            outcomes: "1",
            wakes: "1",
            last_commit_seq: "1",
          });
          const replay = await withPostgresExecutionObservation(
            persistence.pool,
            async (markPhase) => {
              markPhase("replay");
              return runEffect(
                createPublisher(persistence, intrinsic).publish(
                  measured.value.attempt.publicationCommand,
                ),
              );
            },
          );
          expect(replay.value).toMatchObject({
            kind: "replayed",
            token: measured.value.published.token,
          });
          expect(
            await durableState(
              persistence,
              measured.value.attempt.command.sealIdentity.scopeUuid,
            ),
          ).toEqual(beforeReplay);
          expect(replay.observation.commands.insert ?? 0).toBe(0);
          expect(replay.observation.commands.update ?? 0).toBe(0);
          expect(replay.observation.commands.delete ?? 0).toBe(0);
          for (const phase of [
            "sessionActivation",
            "journalOpen",
            "tableResolution",
            "pointOperations",
            "sealPreparation",
            "sealPersistence",
            "runningEvidenceCapture",
            "enterFinishing",
            "finishingEvidenceCapture",
            "publication",
          ] as const) {
            expect(
              measured.observation.phases[phase]?.queryCalls,
            ).toBeGreaterThan(0);
          }
          expect(
            measured.observation.phases.sealCanonicalization?.queryCalls,
          ).toBe(0);
          expect(measured.observation.phases.commandProjection?.queryCalls).toBe(
            0,
          );
          expect(
            Object.values(measured.observation.phases).reduce(
              (sum, phase) => sum + phase.elapsedMilliseconds,
              0,
            ),
          ).toBeCloseTo(measured.observation.elapsedMilliseconds, 6);
          expect(measured.observation.queryCalls).toBeGreaterThan(
            measured.observation.phases.publication?.queryCalls ?? Infinity,
          );
          if (trial >= 0)
            samples.push({
              rowCount,
              trial,
              lifecycle: measured.observation,
              replay: replay.observation,
            });
        }
      }
      const report = {
        ...environment,
        workload:
          "private native persistence lifecycle; trusted fixture inputs; intrinsic index; excludes hosted admission, user-code execution and transport",
        warmupTrials: 1,
        measuredTrials: 3,
        samples,
      };
      if (process.env.FLAREX_CE0_LIFECYCLE_REPORT_PATH !== undefined)
        await writeFile(
          process.env.FLAREX_CE0_LIFECYCLE_REPORT_PATH,
          JSON.stringify(report, null, 2) + "\n",
        );
      console.info("CE0 native persistence lifecycle", JSON.stringify(report));
    });
  }, 900_000);
});
