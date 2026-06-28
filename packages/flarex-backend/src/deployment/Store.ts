import { Context, Effect, Layer, Schema } from "effect";
import { validateExecutionArtifactRef } from "flarex/artifacts";
import { HttpError } from "../http";
import { rejectedFinishPushResponse } from "../pushResponses.ts";
import {
  pushStatusFromRow,
  validateFunctions,
  validateSchema,
  type DeploymentPushStatusRow,
} from "./Validation";
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
  abandonPush(input: AbandonPushStoreInput): Effect.Effect<PushStatus, DeploymentSqlError>;
}>()("flarex-backend/deployment/DeploymentPushStore") {
  static layer(
    storage: DeploymentTransactionStorage,
    sql: DeploymentSqlStorage,
  ) {
    return Layer.effect(
      DeploymentPushStore,
      Effect.gen(function* () {
        const setMeta = (key: string, value: string): void => {
          sql.exec(
            "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            key,
            value,
          );
        };

        const getMeta = (key: string): string | null => {
          const row = sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
          return row?.value ?? null;
        };

        const readPush = (pushId: string): PushStatus | null => {
          const row = sql
            .exec<DeploymentPushStatusRow>(
              `
              SELECT push_id, state, source_package_json, schema_json, functions_json, codegen_analysis_json, error, diagnostics_json, created_at, updated_at
              FROM pushes
              WHERE push_id = ?
              `,
              pushId,
            )
            .toArray()[0];
          return row === undefined ? null : pushStatusFromRow(row);
        };

        const applySchema = (schema: DeploymentSchema): DeploymentSchema => {
          const normalized = validateSchema(schema);
          sql.exec("DELETE FROM indexes");
          sql.exec("DELETE FROM tables");
          for (const table of normalized.tables) {
            sql.exec(
              `
              INSERT INTO tables (table_id, table_name, state, schema_json, partition_rule_json)
              VALUES (?, ?, ?, ?, ?)
              `,
              table.tableId,
              table.name,
              table.state ?? "active",
              JSON.stringify(table.validator ?? null),
              JSON.stringify(table.placement),
            );
          }
          for (const index of normalized.indexes) {
            sql.exec(
              `
              INSERT INTO indexes (index_id, table_id, index_name, fields_json, state)
              VALUES (?, ?, ?, ?, ?)
              `,
              index.indexId,
              index.tableId,
              index.name,
              JSON.stringify(index.fields),
              index.state ?? "enabled",
            );
          }
          setMeta("schema_version", String(normalized.version));
          return normalized;
        };

        const applyFunctions = (functions: DeploymentFunctions): DeploymentFunctions => {
          const normalized = validateFunctions(functions);
          sql.exec("DELETE FROM functions");
          for (const metadata of normalized.functions) {
            sql.exec(
              `
              INSERT INTO functions (function_path, kind, visibility, args_json, returns_json, route_json, partition_json, position_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              `,
              metadata.path,
              metadata.kind,
              metadata.visibility,
              JSON.stringify(metadata.args),
              JSON.stringify(metadata.returns),
              JSON.stringify(metadata.route ?? null),
              JSON.stringify(metadata.partition ?? null),
              metadata.position === undefined ? null : JSON.stringify(metadata.position),
            );
          }
          return normalized;
        };

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
                  if (!status) throw new Error(`Prevalidated finish push ${input.pushId} disappeared.`);
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
          function* (input: AbandonPushStoreInput): Effect.fn.Return<PushStatus, DeploymentSqlError> {
            return yield* Effect.tryPromise({
              try: () =>
                storage.transaction(async () => {
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
              catch: cause => new DeploymentSqlError({ operation: "abandonPush", cause }),
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
