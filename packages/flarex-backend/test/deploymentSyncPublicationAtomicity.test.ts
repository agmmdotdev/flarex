import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  DeploymentQuerySyncAdapterInvariantDefect,
} from "../src/deploymentSync/StateStorage";
import {
  type EvaluationSqlProbe,
  type PreparedEvaluationState,
  prepareEvaluationState,
  snapshotEvaluationState,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";
import {
  CLAIM_WRITE_STAGES,
  COMPLETION_READ_STAGES,
  COMPLETION_WRITE_STAGES,
  OUTCOME_READ_STAGES,
  OUTCOME_WRITE_STAGES,
  PENDING_CLAIM_READ_STAGES,
  type PublicationSqlStage,
  acceptanceFor,
  claimInstalledPublication,
  installPendingPublication,
  makePublicationSqlProbe,
} from "./deploymentSyncPublicationTestSupport";

type PublicationWriteOperation =
  | "claimPublication"
  | "recordPublicationAttemptOutcome"
  | "completePublication";

interface PublicationWriteProgram {
  readonly prepared: PreparedEvaluationState;
  readonly operation: PublicationWriteOperation;
  readonly successTag: "claimed" | "recorded" | "completed";
  readonly readStages: readonly PublicationSqlStage[];
  readonly writeStages: readonly PublicationSqlStage[];
  readonly runExit: () => Promise<Exit.Exit<unknown, unknown>>;
  readonly runSuccess: () => Promise<unknown>;
}

const operationCases = Object.freeze([
  Object.freeze({
    operation: "claimPublication" as const,
    writeStages: CLAIM_WRITE_STAGES,
  }),
  Object.freeze({
    operation: "recordPublicationAttemptOutcome" as const,
    writeStages: OUTCOME_WRITE_STAGES,
  }),
  Object.freeze({
    operation: "completePublication" as const,
    writeStages: COMPLETION_WRITE_STAGES,
  }),
]);

const logicalWriteCases = operationCases.flatMap(({ operation, writeStages }) =>
  writeStages.map((stage, index) => Object.freeze({
    operation,
    stage,
    writeOrdinal: index + 1,
  }))
);

const affectedRowCases = logicalWriteCases.flatMap(writeCase =>
  (["skip", "zeroRowsWritten"] as const).map(mode => Object.freeze({
    ...writeCase,
    defectStage: writeCase.stage === "scope-cas"
      ? "write"
      : writeCase.stage,
    mode,
  }))
);

describe("deployment query-sync publication transaction closure", () => {
  it.each(logicalWriteCases)(
    "rolls back a failure before $operation write $writeOrdinal ($stage)",
    async ({ operation, writeOrdinal }) => {
      const probe = makePublicationSqlProbe();
      const program = await prepareWriteProgram(operation, probe);
      try {
        const before = snapshotEvaluationState(program.prepared.database);
        const cause = new Error(
          `failure before ${operation} write ${writeOrdinal}`,
        );
        probe.start({ phase: "before", writeOrdinal, cause });

        const exit = await program.runExit();

        expectDefect(exit, cause);
        expect(probe.stop()).toEqual([
          ...program.readStages,
          ...program.writeStages.slice(0, writeOrdinal),
        ]);
        expect(snapshotEvaluationState(program.prepared.database)).toEqual(
          before,
        );
        probe.start();
        await expect(program.runSuccess()).resolves.toMatchObject({
          _tag: program.successTag,
        });
        expect(probe.stop()).toEqual([
          ...program.readStages,
          ...program.writeStages,
        ]);
      } finally {
        program.prepared.database.close();
      }
    },
  );

  it.each(affectedRowCases)(
    "refuses $mode affected-row evidence for $operation write $writeOrdinal ($stage)",
    async ({ operation, defectStage, writeOrdinal, mode }) => {
      const probe = makePublicationSqlProbe();
      const program = await prepareWriteProgram(operation, probe);
      try {
        const before = snapshotEvaluationState(program.prepared.database);
        probe.startAffectedRowRefusal(writeOrdinal, mode);

        const exit = await program.runExit();
        const defect = expectDefect(exit);

        expect(defect).toBeInstanceOf(
          DeploymentQuerySyncAdapterInvariantDefect,
        );
        expect(defect).toMatchObject({ operation, stage: defectStage });
        expect(probe.completed().at(-1)).toMatchObject({
          rowsRead: mode === "skip" ? 0 : 1,
          rowsWritten: 0,
        });
        expect(probe.stop()).toEqual([
          ...program.readStages,
          ...program.writeStages.slice(0, writeOrdinal),
        ]);
        expect(snapshotEvaluationState(program.prepared.database)).toEqual(
          before,
        );
        probe.start();
        await expect(program.runSuccess()).resolves.toMatchObject({
          _tag: program.successTag,
        });
        expect(probe.stop()).toEqual([
          ...program.readStages,
          ...program.writeStages,
        ]);
      } finally {
        program.prepared.database.close();
      }
    },
  );
});

async function prepareWriteProgram(
  operation: PublicationWriteOperation,
  probe: EvaluationSqlProbe<PublicationSqlStage>,
): Promise<PublicationWriteProgram> {
  const prepared = await prepareEvaluationState(probe.hooks);
  await installPendingPublication(
    prepared,
    operation === "claimPublication"
      ? 70
      : operation === "recordPublicationAttemptOutcome"
        ? 71
        : 72,
    `publication-atomicity-${operation}`,
  );
  if (operation === "claimPublication") {
    return Object.freeze({
      prepared,
      operation,
      successTag: "claimed",
      readStages: PENDING_CLAIM_READ_STAGES,
      writeStages: CLAIM_WRITE_STAGES,
      runExit: () => Effect.runPromiseExit(
        prepared.state.claimPublication(),
      ),
      runSuccess: () => Effect.runPromise(
        prepared.state.claimPublication(),
      ),
    });
  }
  const attempt = await claimInstalledPublication(prepared);
  if (operation === "recordPublicationAttemptOutcome") {
    return Object.freeze({
      prepared,
      operation,
      successTag: "recorded",
      readStages: OUTCOME_READ_STAGES,
      writeStages: OUTCOME_WRITE_STAGES,
      runExit: () => Effect.runPromiseExit(
        prepared.state.recordPublicationAttemptOutcome(
          attempt,
          "outcomeUnknown",
        ),
      ),
      runSuccess: () => Effect.runPromise(
        prepared.state.recordPublicationAttemptOutcome(
          attempt,
          "outcomeUnknown",
        ),
      ),
    });
  }
  const evidence = acceptanceFor(attempt);
  return Object.freeze({
    prepared,
    operation,
    successTag: "completed",
    readStages: COMPLETION_READ_STAGES,
    writeStages: COMPLETION_WRITE_STAGES,
    runExit: () => Effect.runPromiseExit(
      prepared.state.completePublication(evidence),
    ),
    runSuccess: () => Effect.runPromise(
      prepared.state.completePublication(evidence),
    ),
  });
}

function expectDefect(
  exit: Exit.Exit<unknown, unknown>,
  expected?: Error,
): unknown {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect defect.");
  expect(Cause.hasDies(exit.cause)).toBe(true);
  const defect = success(Cause.findDefect(exit.cause));
  if (expected !== undefined) expect(defect).toBe(expected);
  return defect;
}
