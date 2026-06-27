import { Context, Effect, Layer, Schema } from "effect";
import { validateExecutionArtifactRef } from "flarex/artifacts";
import { HttpError } from "../http";
import { rejectedFinishPushResponse } from "../pushResponses.ts";
import type {
  ActiveDeploymentStatus,
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
  DeploymentFunctions,
  DeploymentSchema,
  ExecutionArtifactRef,
  FinishPushResponse,
  PushDiagnostic,
  PushSourcePackage,
  PushStatus,
} from "../types";

const DeploymentSqlOperation = Schema.Union([
  Schema.Literal("getPush"),
  Schema.Literal("startPush"),
  Schema.Literal("finishPush"),
  Schema.Literal("abandonPush"),
  Schema.Literal("getActiveDeployment"),
]);

export class DeploymentSqlError extends Schema.TaggedErrorClass<DeploymentSqlError>()(
  "DeploymentSqlError",
  {
    operation: DeploymentSqlOperation,
    cause: Schema.Defect(),
  },
) {}

export type DeploymentSqlStorage = DurableObjectState["storage"]["sql"];
export type DeploymentTransactionStorage = DurableObjectState["storage"];

export type StartAnalyzedPushStoreInput = {
  readonly pushId: string;
  readonly now: number;
  readonly sourcePackage: PushSourcePackage;
  readonly diagnostics: ReadonlyArray<PushDiagnostic>;
} & (
  | {
      readonly analysis: DeploymentAnalysis;
      readonly codegenAnalysis: DeploymentCodegenAnalysis;
    }
  | {
      readonly error: string;
    }
);

export interface FinishPushStoreInput {
  readonly pushId: string;
  readonly now: number;
  readonly executionArtifactRef: ExecutionArtifactRef;
}

export interface AbandonPushStoreInput {
  readonly pushId: string;
  readonly now: number;
  readonly reason: string;
}

export class DeploymentPushStore extends Context.Service<DeploymentPushStore, {
  getPush(pushId: string): Effect.Effect<PushStatus | null, DeploymentSqlError>;
  getActiveDeployment(): Effect.Effect<ActiveDeploymentStatus | null, DeploymentSqlError | HttpError>;
  startAnalyzedPush(input: StartAnalyzedPushStoreInput): Effect.Effect<PushStatus, DeploymentSqlError>;
  finishPush(input: FinishPushStoreInput): Effect.Effect<FinishPushResponse, DeploymentSqlError | HttpError>;
  abandonPush(input: AbandonPushStoreInput): Effect.Effect<PushStatus, DeploymentSqlError | HttpError>;
}>()("flarex-backend/deployment/DeploymentPushStore") {
  static layer(
    storage: DeploymentTransactionStorage,
    sql: DeploymentSqlStorage,
    readPush: (pushId: string) => PushStatus | null,
    applySchema: (schema: DeploymentSchema) => DeploymentSchema,
    applyFunctions: (functions: DeploymentFunctions) => DeploymentFunctions,
    setMeta: (key: string, value: string) => void,
    getMeta: (key: string) => string | null,
  ) {
    return Layer.effect(
      DeploymentPushStore,
      Effect.gen(function* () {
        const getPush = Effect.fn("DeploymentPushStore.getPush")(
          function* (pushId: string): Effect.fn.Return<PushStatus | null, DeploymentSqlError> {
            return yield* Effect.try({
              try: () => readPush(pushId),
              catch: cause => new DeploymentSqlError({ operation: "getPush", cause }),
            });
          },
        );

        const getActiveDeployment = Effect.fn("DeploymentPushStore.getActiveDeployment")(
          function* (): Effect.fn.Return<ActiveDeploymentStatus | null, DeploymentSqlError | HttpError> {
            return yield* Effect.try({
              try: () => {
                const activePushId = getMeta("active_push_id");
                if (activePushId === null) return null;
                const push = readPush(activePushId);
                if (push === null) {
                  throw new HttpError(500, `Active push ${activePushId} is missing.`);
                }
                if (push.analysis === undefined || push.codegenAnalysis === undefined) {
                  throw new HttpError(500, `Active push ${activePushId} has no analyzed deployment metadata.`);
                }
                const rawExecutionArtifactRef = getMeta("active_execution_artifact_ref");
                if (rawExecutionArtifactRef === null) {
                  throw new HttpError(500, `Active push ${activePushId} has no execution artifact reference.`);
                }
                const executionArtifactRef = parseExecutionArtifactRef(rawExecutionArtifactRef);
                return {
                  activePushId,
                  activatedAt: Number(getMeta("active_activated_at") ?? push.updatedAt),
                  schemaVersion: push.analysis.schema.version,
                  executionArtifactRef,
                  sourcePackage: push.sourcePackage,
                  analysis: push.analysis,
                  codegenAnalysis: push.codegenAnalysis,
                };
              },
              catch: cause =>
                cause instanceof HttpError
                  ? cause
                  : new DeploymentSqlError({ operation: "getActiveDeployment", cause }),
            });
          },
        );

        const startAnalyzedPush = Effect.fn("DeploymentPushStore.startAnalyzedPush")(
          function* (input: StartAnalyzedPushStoreInput): Effect.fn.Return<PushStatus, DeploymentSqlError> {
            return yield* Effect.tryPromise({
              try: () =>
                storage.transaction(async () => {
                  const hasAnalysis = "analysis" in input;
                  sql.exec(
                    "UPDATE pushes SET state = 'superseded', updated_at = ? WHERE state IN ('pending', 'analyzed')",
                    input.now,
                  );
                  sql.exec(
                    `
                    INSERT INTO pushes (
                      push_id,
                      state,
                      source_package_json,
                      schema_json,
                      functions_json,
                      codegen_analysis_json,
                      error,
                      diagnostics_json,
                      created_at,
                      updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                    input.pushId,
                    hasAnalysis ? "analyzed" : "failed",
                    JSON.stringify(input.sourcePackage),
                    hasAnalysis ? JSON.stringify(input.analysis.schema) : null,
                    hasAnalysis ? JSON.stringify(input.analysis.functions) : null,
                    hasAnalysis ? JSON.stringify(input.codegenAnalysis) : null,
                    hasAnalysis ? null : input.error,
                    input.diagnostics.length === 0 ? null : JSON.stringify(input.diagnostics),
                    input.now,
                    input.now,
                  );
                  const status = readPush(input.pushId);
                  if (!status) throw new Error(`Push ${input.pushId} was not stored.`);
                  return status;
                }),
              catch: cause => new DeploymentSqlError({ operation: "startPush", cause }),
            });
          },
        );

        const finishPush = Effect.fn("DeploymentPushStore.finishPush")(
          function* (input: FinishPushStoreInput): Effect.fn.Return<FinishPushResponse, DeploymentSqlError | HttpError> {
            return yield* Effect.tryPromise({
              try: () =>
                storage.transaction(async () => {
                  const status = readPush(input.pushId);
                  if (!status) throw new HttpError(404, `Unknown push: ${input.pushId}`);
                  if (status.state !== "analyzed") {
                    return rejectedFinishPushResponse(
                      status,
                      "invalid_state",
                      `Cannot finish push ${input.pushId} in state ${status.state}.`,
                    );
                  }
                  if (status.analysis === undefined) {
                    return rejectedFinishPushResponse(
                      status,
                      "missing_analysis",
                      `Push ${input.pushId} has no analysis to activate.`,
                    );
                  }
                  applySchema(status.analysis.schema);
                  applyFunctions(status.analysis.functions);
                  sql.exec(
                    "UPDATE pushes SET state = 'activated', updated_at = ? WHERE push_id = ?",
                    input.now,
                    input.pushId,
                  );
                  setMeta("active_push_id", input.pushId);
                  setMeta("active_activated_at", String(input.now));
                  setMeta("active_execution_artifact_ref", JSON.stringify(input.executionArtifactRef));
                  const activated = readPush(input.pushId);
                  if (!activated) throw new Error(`Activated push ${input.pushId} disappeared.`);
                  const response: FinishPushResponse = { result: "activated", push: activated };
                  return response;
                }),
              catch: cause =>
                cause instanceof HttpError
                  ? cause
                  : new DeploymentSqlError({ operation: "finishPush", cause }),
            });
          },
        );

        const abandonPush = Effect.fn("DeploymentPushStore.abandonPush")(
          function* (input: AbandonPushStoreInput): Effect.fn.Return<PushStatus, DeploymentSqlError | HttpError> {
            return yield* Effect.tryPromise({
              try: () =>
                storage.transaction(async () => {
                  const status = readPush(input.pushId);
                  if (!status) throw new HttpError(404, `Unknown push: ${input.pushId}`);
                  if (status.state !== "pending" && status.state !== "analyzed") {
                    throw new HttpError(409, `Cannot abandon push ${input.pushId} in state ${status.state}.`);
                  }
                  sql.exec(
                    "UPDATE pushes SET state = 'abandoned', error = ?, updated_at = ? WHERE push_id = ?",
                    input.reason,
                    input.now,
                    input.pushId,
                  );
                  const abandoned = readPush(input.pushId);
                  if (!abandoned) throw new Error(`Abandoned push ${input.pushId} disappeared.`);
                  return abandoned;
                }),
              catch: cause =>
                cause instanceof HttpError
                  ? cause
                  : new DeploymentSqlError({ operation: "abandonPush", cause }),
            });
          },
        );

        return DeploymentPushStore.of({
          getPush,
          getActiveDeployment,
          startAnalyzedPush,
          finishPush,
          abandonPush,
        });
      }),
    );
  }
}

function parseExecutionArtifactRef(raw: string): ExecutionArtifactRef {
  try {
    return validateExecutionArtifactRef(JSON.parse(raw));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new HttpError(500, message);
  }
}
