import { Context, Effect, Layer, Schema } from "effect";
import { validateExecutionArtifactRef } from "flarex/artifacts";
import { rejectedFinishPushResponse } from "../pushResponses.ts";
import {
  decodePushStatusFromRow,
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
import {
  DeploymentActiveDeploymentInvalidError,
  DeploymentStoredPushMissingError,
  DeploymentValidationError,
} from "./Errors";

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

export type DeploymentStoreWriteError =
  | DeploymentSqlError
  | DeploymentStoredPushMissingError
  | DeploymentValidationError;

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
  getPush(pushId: string): Effect.Effect<PushStatus | null, DeploymentSqlError | DeploymentValidationError>;
  getActiveDeployment(): Effect.Effect<
    ActiveDeploymentStatus | null,
    DeploymentActiveDeploymentInvalidError | DeploymentSqlError | DeploymentValidationError
  >;
  startAnalyzedPush(input: StartAnalyzedPushStoreInput): Effect.Effect<
    PushStatus,
    DeploymentStoreWriteError
  >;
  finishPush(input: FinishPushStoreInput): Effect.Effect<
    FinishPushResponse,
    DeploymentStoreWriteError
  >;
  abandonPush(input: AbandonPushStoreInput): Effect.Effect<PushStatus, DeploymentStoreWriteError>;
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

        const readPushRow = (pushId: string): DeploymentPushStatusRow | undefined =>
          sql
            .exec<DeploymentPushStatusRow>(
              `
              SELECT push_id, state, source_package_json, schema_json, functions_json, codegen_analysis_json, error, diagnostics_json, created_at, updated_at
              FROM pushes
              WHERE push_id = ?
              `,
              pushId,
            )
            .toArray()[0];

        const decodePushRow = Effect.fn("DeploymentPushStore.decodePushRow")(
          function* (
            row: DeploymentPushStatusRow | undefined,
          ): Effect.fn.Return<PushStatus | null, DeploymentValidationError> {
            return row === undefined ? null : yield* decodePushStatusFromRow(row);
          },
        );

        const readPush = Effect.fn("DeploymentPushStore.readPush")(
          function* (
            pushId: string,
          ): Effect.fn.Return<PushStatus | null, DeploymentSqlError | DeploymentValidationError> {
            const row = yield* Effect.try({
              try: () => readPushRow(pushId),
              catch: cause => new DeploymentSqlError({ operation: "getPush", cause }),
            });
            return yield* decodePushRow(row);
          },
        );

        const readActiveMeta = Effect.fn("DeploymentPushStore.readActiveMeta")(
          function* (
            key: string,
          ): Effect.fn.Return<string | null, DeploymentSqlError> {
            return yield* Effect.try({
              try: () => getMeta(key),
              catch: cause => new DeploymentSqlError({ operation: "getActiveDeployment", cause }),
            });
          },
        );

        const readActivePushId = Effect.fn("DeploymentPushStore.readActivePushId")(
          function* (): Effect.fn.Return<string | null, DeploymentSqlError> {
            return yield* readActiveMeta("active_push_id");
          },
        );

        const readActivePush = Effect.fn("DeploymentPushStore.readActivePush")(
          function* (
            activePushId: string,
          ): Effect.fn.Return<PushStatus | null, DeploymentSqlError | DeploymentValidationError> {
            const row = yield* Effect.try({
              try: () => readPushRow(activePushId),
              catch: cause => new DeploymentSqlError({ operation: "getActiveDeployment", cause }),
            });
            return yield* decodePushRow(row);
          },
        );

        const requireAnalyzedActivePush = Effect.fn("DeploymentPushStore.requireAnalyzedActivePush")(
          function* (
            activePushId: string,
            push: PushStatus | null,
          ): Effect.fn.Return<
            PushStatus & {
              readonly analysis: DeploymentAnalysis;
              readonly codegenAnalysis: DeploymentCodegenAnalysis;
            },
            DeploymentActiveDeploymentInvalidError
          > {
            if (push === null) {
              return yield* Effect.fail(new DeploymentActiveDeploymentInvalidError({
                message: `Active push ${activePushId} is missing.`,
              }));
            }
            if (push.analysis === undefined || push.codegenAnalysis === undefined) {
              return yield* Effect.fail(new DeploymentActiveDeploymentInvalidError({
                message: `Active push ${activePushId} has no analyzed deployment metadata.`,
              }));
            }
            return {
              ...push,
              analysis: push.analysis,
              codegenAnalysis: push.codegenAnalysis,
            };
          },
        );

        const readActiveExecutionArtifactRef = Effect.fn("DeploymentPushStore.readActiveExecutionArtifactRef")(
          function* (
            activePushId: string,
          ): Effect.fn.Return<
            ExecutionArtifactRef,
            DeploymentActiveDeploymentInvalidError | DeploymentSqlError
          > {
            const rawExecutionArtifactRef = yield* readActiveMeta("active_execution_artifact_ref");
            if (rawExecutionArtifactRef === null) {
              return yield* Effect.fail(new DeploymentActiveDeploymentInvalidError({
                message: `Active push ${activePushId} has no execution artifact reference.`,
              }));
            }
            return yield* parseExecutionArtifactRefEffect(rawExecutionArtifactRef);
          },
        );

        const readActiveActivatedAt = Effect.fn("DeploymentPushStore.readActiveActivatedAt")(
          function* (
            fallbackUpdatedAt: number,
          ): Effect.fn.Return<number, DeploymentSqlError> {
            const activeActivatedAt = yield* readActiveMeta("active_activated_at");
            return Number(activeActivatedAt ?? fallbackUpdatedAt);
          },
        );

        const applySchema = (schema: DeploymentSchema): void => {
          sql.exec("DELETE FROM indexes");
          sql.exec("DELETE FROM tables");
          for (const table of schema.tables) {
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
          for (const index of schema.indexes) {
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
          setMeta("schema_version", String(schema.version));
        };

        const applyFunctions = (functions: DeploymentFunctions): void => {
          sql.exec("DELETE FROM functions");
          for (const metadata of functions.functions) {
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
        };

        const getPush = Effect.fn("DeploymentPushStore.getPush")(
          function* (
            pushId: string,
          ): Effect.fn.Return<PushStatus | null, DeploymentSqlError | DeploymentValidationError> {
            return yield* readPush(pushId);
          },
        );

        const getActiveDeployment = Effect.fn("DeploymentPushStore.getActiveDeployment")(
          function* (): Effect.fn.Return<
            ActiveDeploymentStatus | null,
            DeploymentActiveDeploymentInvalidError | DeploymentSqlError | DeploymentValidationError
          > {
            const activePushId = yield* readActivePushId();
            if (activePushId === null) return null;
            const push = yield* readActivePush(activePushId);
            const activePush = yield* requireAnalyzedActivePush(activePushId, push);
            const executionArtifactRef = yield* readActiveExecutionArtifactRef(activePushId);
            const activatedAt = yield* readActiveActivatedAt(activePush.updatedAt);
            return {
              activePushId,
              activatedAt,
              schemaVersion: activePush.analysis.schema.version,
              executionArtifactRef,
              sourcePackage: activePush.sourcePackage,
              analysis: activePush.analysis,
              codegenAnalysis: activePush.codegenAnalysis,
            };
          },
        );

        const assertStoredPushAfterWrite = (
          operation: "startPush" | "finishPush" | "abandonPush",
          pushId: string,
          stage: string,
        ): void => {
          if (readPushRow(pushId) === undefined) {
            throw storedPushMissing(operation, pushId, stage);
          }
        };

        const storeWriteCauseToError = (
          operation: "startPush" | "finishPush" | "abandonPush",
          cause: unknown,
        ): DeploymentStoredPushMissingError | DeploymentSqlError =>
          cause instanceof DeploymentStoredPushMissingError
            ? cause
            : new DeploymentSqlError({ operation, cause });

        const runStartAnalyzedPushTransaction = Effect.fn(
          "DeploymentPushStore.runStartAnalyzedPushTransaction",
        )(function* (
          input: StartAnalyzedPushStoreInput,
          status: PushStatus,
        ): Effect.fn.Return<PushStatus, DeploymentStoreWriteError> {
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
                assertStoredPushAfterWrite("startPush", input.pushId, "stored");
                return status;
              }),
            catch: cause => storeWriteCauseToError("startPush", cause),
          });
        });

        const runFinishPushTransaction = Effect.fn("DeploymentPushStore.runFinishPushTransaction")(
          function* (
            input: FinishPushStoreInput,
            status: PushStatus & {
              readonly analysis: DeploymentAnalysis;
            },
          ): Effect.fn.Return<FinishPushResponse, DeploymentStoreWriteError> {
            return yield* Effect.tryPromise({
              try: () =>
                storage.transaction(async () => {
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
                  assertStoredPushAfterWrite("finishPush", input.pushId, "activated");
                  return {
                    result: "activated" as const,
                    push: { ...status, state: "activated" as const, updatedAt: input.now },
                  };
                }),
              catch: cause => storeWriteCauseToError("finishPush", cause),
            });
          },
        );

        const runAbandonPushTransaction = Effect.fn("DeploymentPushStore.runAbandonPushTransaction")(
          function* (
            input: AbandonPushStoreInput,
            status: PushStatus,
          ): Effect.fn.Return<PushStatus, DeploymentStoreWriteError> {
            return yield* Effect.tryPromise({
              try: () =>
                storage.transaction(async () => {
                  sql.exec(
                    "UPDATE pushes SET state = 'abandoned', error = ?, updated_at = ? WHERE push_id = ?",
                    input.reason,
                    input.now,
                    input.pushId,
                  );
                  assertStoredPushAfterWrite("abandonPush", input.pushId, "abandoned");
                  return {
                    ...status,
                    state: "abandoned" as const,
                    error: input.reason,
                    updatedAt: input.now,
                  };
                }),
              catch: cause => storeWriteCauseToError("abandonPush", cause),
            });
          },
        );

        const startAnalyzedPush = Effect.fn("DeploymentPushStore.startAnalyzedPush")(
          function* (
            input: StartAnalyzedPushStoreInput,
          ): Effect.fn.Return<PushStatus, DeploymentStoreWriteError> {
            const status = yield* decodePushStatusFromRow(pushStatusRowFromStartAnalyzedPushStoreInput(input));
            return yield* runStartAnalyzedPushTransaction(input, status);
          },
        );

        const finishPush = Effect.fn("DeploymentPushStore.finishPush")(
          function* (input: FinishPushStoreInput): Effect.fn.Return<
            FinishPushResponse,
            DeploymentStoreWriteError
          > {
            const status = yield* readPush(input.pushId);
            if (status === null) {
              return yield* Effect.fail(storedPushMissing("finishPush", input.pushId, "prevalidated"));
            }
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
            return yield* runFinishPushTransaction(input, {
              ...status,
              analysis: status.analysis,
            });
          },
        );

        const abandonPush = Effect.fn("DeploymentPushStore.abandonPush")(
          function* (
            input: AbandonPushStoreInput,
          ): Effect.fn.Return<PushStatus, DeploymentStoreWriteError> {
            const status = yield* readPush(input.pushId);
            if (status === null) {
              return yield* Effect.fail(storedPushMissing("abandonPush", input.pushId, "abandoned"));
            }
            return yield* runAbandonPushTransaction(input, status);
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

function storedPushMissing(
  operation: "startPush" | "finishPush" | "abandonPush",
  pushId: string,
  stage: string,
): DeploymentStoredPushMissingError {
  return new DeploymentStoredPushMissingError({ operation, pushId, stage });
}

function pushStatusRowFromStartAnalyzedPushStoreInput(input: StartAnalyzedPushStoreInput): DeploymentPushStatusRow {
  if ("analysis" in input) {
    return {
      push_id: input.pushId,
      state: "analyzed",
      source_package_json: JSON.stringify(input.sourcePackage),
      schema_json: JSON.stringify(input.analysis.schema),
      functions_json: JSON.stringify(input.analysis.functions),
      codegen_analysis_json: JSON.stringify(input.codegenAnalysis),
      error: null,
      diagnostics_json: input.diagnostics.length === 0 ? null : JSON.stringify(input.diagnostics),
      created_at: input.now,
      updated_at: input.now,
    };
  }
  return {
    push_id: input.pushId,
    state: "failed",
    source_package_json: JSON.stringify(input.sourcePackage),
    schema_json: null,
    functions_json: null,
    codegen_analysis_json: null,
    error: input.error,
    diagnostics_json: input.diagnostics.length === 0 ? null : JSON.stringify(input.diagnostics),
    created_at: input.now,
    updated_at: input.now,
  };
}

const parseExecutionArtifactRefEffect = Effect.fn("DeploymentPushStore.parseExecutionArtifactRef")(
  function* (
    raw: string,
  ): Effect.fn.Return<ExecutionArtifactRef, DeploymentActiveDeploymentInvalidError> {
    return yield* Effect.try({
      try: () => validateExecutionArtifactRef(JSON.parse(raw)),
      catch: cause => new DeploymentActiveDeploymentInvalidError({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
    });
  },
);
