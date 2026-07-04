import { Context, Effect, Layer, Schema } from "effect";
import { rejectedFinishPushResponse } from "../pushResponses.ts";
import {
  decodePushStatusFromRow,
  type DeploymentPushStatusRow,
} from "./Validation";
import { decodeDeploymentStorageExecutionArtifactRefJson } from "./StorageRows";
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

type DeploymentStoreWriteOperation = "startPush" | "finishPush" | "abandonPush";

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

export interface DeploymentSchemaTableApplication {
  readonly tableId: number;
  readonly name: string;
  readonly state: string;
  readonly schemaJson: string;
  readonly partitionRuleJson: string;
}

export interface DeploymentSchemaIndexApplication {
  readonly indexId: number;
  readonly tableId: number;
  readonly name: string;
  readonly fieldsJson: string;
  readonly state: string;
}

export interface DeploymentSchemaApplicationPlan {
  readonly version: number;
  readonly tables: ReadonlyArray<DeploymentSchemaTableApplication>;
  readonly indexes: ReadonlyArray<DeploymentSchemaIndexApplication>;
}

export interface DeploymentFunctionApplication {
  readonly path: string;
  readonly kind: string;
  readonly visibility: string | undefined;
  readonly argsJson: string;
  readonly returnsJson: string;
  readonly routeJson: string;
  readonly partitionJson: string;
  readonly positionJson: string | null;
}

export interface DeploymentFunctionsApplicationPlan {
  readonly functions: ReadonlyArray<DeploymentFunctionApplication>;
}

export interface DeploymentMetaApplication {
  readonly key: string;
  readonly value: string;
}

export interface DeploymentActiveMetadataApplicationPlan {
  readonly entries: ReadonlyArray<DeploymentMetaApplication>;
  readonly deleteKeys: ReadonlyArray<string>;
}

export interface DeploymentStartPushRowApplication {
  readonly pushId: string;
  readonly state: "analyzed" | "failed";
  readonly sourcePackageJson: string;
  readonly schemaJson: string | null;
  readonly functionsJson: string | null;
  readonly codegenAnalysisJson: string | null;
  readonly error: string | null;
  readonly diagnosticsJson: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface DeploymentStartPushApplicationPlan {
  readonly supersedeUpdatedAt: number;
  readonly row: DeploymentStartPushRowApplication;
}

export interface DeploymentAbandonPushApplicationPlan {
  readonly pushId: string;
  readonly error: string;
  readonly updatedAt: number;
}

export interface FinishPushActivationApplication {
  readonly schema: DeploymentSchemaApplicationPlan;
  readonly functions: DeploymentFunctionsApplicationPlan;
  readonly activeMetadata: DeploymentActiveMetadataApplicationPlan;
}

export type FinishableDeploymentPushStatus = PushStatus & {
  readonly state: "analyzed";
  readonly analysis: DeploymentAnalysis;
};

export type AnalyzedActiveDeploymentPushStatus = PushStatus & {
  readonly analysis: DeploymentAnalysis;
  readonly codegenAnalysis: DeploymentCodegenAnalysis;
};

export type FinishPushStoreDecision =
  | {
      readonly _tag: "activate";
      readonly status: FinishableDeploymentPushStatus;
    }
  | {
      readonly _tag: "reject";
      readonly response: FinishPushResponse;
    };

export const activeDeploymentStatusFromStoreParts = Effect.fn(
  "DeploymentPushStore.activeDeploymentStatusFromStoreParts",
)(function* (
  activePushId: string,
  activePush: AnalyzedActiveDeploymentPushStatus,
  executionArtifactRef: ExecutionArtifactRef,
  activatedAt: number,
): Effect.fn.Return<ActiveDeploymentStatus> {
  return {
    activePushId,
    activatedAt,
    schemaVersion: activePush.analysis.schema.version,
    executionArtifactRef,
    sourcePackage: activePush.sourcePackage,
    analysis: activePush.analysis,
    codegenAnalysis: activePush.codegenAnalysis,
  };
});

export const activeDeploymentExecutionArtifactRefFromMeta = Effect.fn(
  "DeploymentPushStore.activeDeploymentExecutionArtifactRefFromMeta",
)(function* (
  activePushId: string,
  rawExecutionArtifactRef: string | null,
): Effect.fn.Return<ExecutionArtifactRef, DeploymentActiveDeploymentInvalidError> {
  return yield* decodeDeploymentStorageExecutionArtifactRefJson(activePushId, rawExecutionArtifactRef);
});

export const activeDeploymentActivatedAtFromMeta = Effect.fn(
  "DeploymentPushStore.activeDeploymentActivatedAtFromMeta",
)(function* (
  rawActivatedAt: string | null,
  fallbackUpdatedAt: number,
): Effect.fn.Return<number> {
  return Number(rawActivatedAt ?? fallbackUpdatedAt);
});

export const deploymentSchemaApplicationPlan = Effect.fn(
  "DeploymentPushStore.deploymentSchemaApplicationPlan",
)(function* (
  schema: DeploymentSchema,
): Effect.fn.Return<DeploymentSchemaApplicationPlan> {
  return {
    version: schema.version,
    tables: schema.tables.map(table => ({
      tableId: table.tableId,
      name: table.name,
      state: table.state ?? "active",
      schemaJson: JSON.stringify(table.validator ?? null),
      partitionRuleJson: JSON.stringify(table.placement),
    })),
    indexes: schema.indexes.map(index => ({
      indexId: index.indexId,
      tableId: index.tableId,
      name: index.name,
      fieldsJson: JSON.stringify(index.fields),
      state: index.state ?? "enabled",
    })),
  };
});

export const deploymentFunctionsApplicationPlan = Effect.fn(
  "DeploymentPushStore.deploymentFunctionsApplicationPlan",
)(function* (
  functions: DeploymentFunctions,
): Effect.fn.Return<DeploymentFunctionsApplicationPlan> {
  return {
    functions: functions.functions.map(metadata => ({
      path: metadata.path,
      kind: metadata.kind,
      visibility: metadata.visibility,
      argsJson: JSON.stringify(metadata.args),
      returnsJson: JSON.stringify(metadata.returns),
      routeJson: JSON.stringify(metadata.route ?? null),
      partitionJson: JSON.stringify(metadata.partition ?? null),
      positionJson: metadata.position === undefined ? null : JSON.stringify(metadata.position),
    })),
  };
});

export const deploymentActiveMetadataApplicationPlan = Effect.fn(
  "DeploymentPushStore.deploymentActiveMetadataApplicationPlan",
)(function* (
  input: FinishPushStoreInput,
  sourcePackage: PushSourcePackage,
): Effect.fn.Return<DeploymentActiveMetadataApplicationPlan, DeploymentValidationError> {
  const authMetadata = yield* deploymentActiveAuthMetadataApplication(sourcePackage);
  return {
    deleteKeys: authMetadata.deleteKeys,
    entries: [
      { key: "active_push_id", value: input.pushId },
      { key: "active_activated_at", value: String(input.now) },
      { key: "active_execution_artifact_ref", value: JSON.stringify(input.executionArtifactRef) },
      ...authMetadata.entries,
    ],
  };
});

const deploymentActiveAuthMetadataApplication = Effect.fn(
  "DeploymentPushStore.deploymentActiveAuthMetadataApplication",
)(function* (
  sourcePackage: PushSourcePackage,
): Effect.fn.Return<DeploymentActiveMetadataApplicationPlan, DeploymentValidationError> {
  if (sourcePackage.authConfig === undefined) {
    if (sourcePackage.authConfigModule !== undefined) {
      return yield* Effect.fail(new DeploymentValidationError({
        message: "Active auth config module exists without auth config.",
      }));
    }
    return {
      deleteKeys: ["active_auth_config", "active_auth_config_module"],
      entries: [],
    };
  }
  if (
    typeof sourcePackage.authConfigModule !== "string" ||
    sourcePackage.authConfigModule.length === 0
  ) {
    return yield* Effect.fail(new DeploymentValidationError({
      message: "Active auth config requires a non-empty auth config module.",
    }));
  }
  return {
    deleteKeys: [],
    entries: [
      {
        key: "active_auth_config",
        value: JSON.stringify(sourcePackage.authConfig),
      },
      {
        key: "active_auth_config_module",
        value: sourcePackage.authConfigModule,
      },
    ],
  };
});

export const deploymentStartPushApplicationPlan = Effect.fn(
  "DeploymentPushStore.deploymentStartPushApplicationPlan",
)(function* (
  input: StartAnalyzedPushStoreInput,
): Effect.fn.Return<DeploymentStartPushApplicationPlan> {
  const hasAnalysis = "analysis" in input;
  return {
    supersedeUpdatedAt: input.now,
    row: {
      pushId: input.pushId,
      state: hasAnalysis ? "analyzed" : "failed",
      sourcePackageJson: JSON.stringify(input.sourcePackage),
      schemaJson: hasAnalysis ? JSON.stringify(input.analysis.schema) : null,
      functionsJson: hasAnalysis ? JSON.stringify(input.analysis.functions) : null,
      codegenAnalysisJson: hasAnalysis ? JSON.stringify(input.codegenAnalysis) : null,
      error: hasAnalysis ? null : input.error,
      diagnosticsJson: input.diagnostics.length === 0 ? null : JSON.stringify(input.diagnostics),
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
});

export const deploymentAbandonPushApplicationPlan = Effect.fn(
  "DeploymentPushStore.deploymentAbandonPushApplicationPlan",
)(function* (
  input: AbandonPushStoreInput,
): Effect.fn.Return<DeploymentAbandonPushApplicationPlan> {
  return {
    pushId: input.pushId,
    error: input.reason,
    updatedAt: input.now,
  };
});

export const finishPushActivationApplication = Effect.fn(
  "DeploymentPushStore.finishPushActivationApplication",
)(function* (
  input: FinishPushStoreInput,
  analysis: DeploymentAnalysis,
  sourcePackage: PushSourcePackage,
): Effect.fn.Return<FinishPushActivationApplication, DeploymentValidationError> {
  const schema = yield* deploymentSchemaApplicationPlan(analysis.schema);
  const functions = yield* deploymentFunctionsApplicationPlan(analysis.functions);
  const activeMetadata = yield* deploymentActiveMetadataApplicationPlan(input, sourcePackage);
  return { schema, functions, activeMetadata };
});

export const deploymentFinishPushStoreDecision = Effect.fn(
  "DeploymentPushStore.deploymentFinishPushStoreDecision",
)(function* (
  pushId: string,
  status: PushStatus | null,
): Effect.fn.Return<FinishPushStoreDecision, DeploymentStoredPushMissingError> {
  if (status === null) {
    return yield* Effect.fail(storedPushMissing("finishPush", pushId, "prevalidated"));
  }
  if (status.state !== "analyzed") {
    return {
      _tag: "reject",
      response: rejectedFinishPushResponse(
        status,
        "invalid_state",
        `Cannot finish push ${pushId} in state ${status.state}.`,
      ),
    };
  }
  if (status.analysis === undefined) {
    return {
      _tag: "reject",
      response: rejectedFinishPushResponse(
        status,
        "missing_analysis",
        `Push ${pushId} has no analysis to activate.`,
      ),
    };
  }
  return {
    _tag: "activate",
    status: {
      ...status,
      state: "analyzed",
      analysis: status.analysis,
    },
  };
});

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
            return yield* activeDeploymentExecutionArtifactRefFromMeta(activePushId, rawExecutionArtifactRef);
          },
        );

        const readActiveActivatedAt = Effect.fn("DeploymentPushStore.readActiveActivatedAt")(
          function* (
            fallbackUpdatedAt: number,
          ): Effect.fn.Return<number, DeploymentSqlError> {
            const activeActivatedAt = yield* readActiveMeta("active_activated_at");
            return yield* activeDeploymentActivatedAtFromMeta(activeActivatedAt, fallbackUpdatedAt);
          },
        );

        const applySchemaPlan = (plan: DeploymentSchemaApplicationPlan): void => {
          sql.exec("DELETE FROM indexes");
          sql.exec("DELETE FROM tables");
          for (const table of plan.tables) {
            sql.exec(
              `
              INSERT INTO tables (table_id, table_name, state, schema_json, partition_rule_json)
              VALUES (?, ?, ?, ?, ?)
              `,
              table.tableId,
              table.name,
              table.state,
              table.schemaJson,
              table.partitionRuleJson,
            );
          }
          for (const index of plan.indexes) {
            sql.exec(
              `
              INSERT INTO indexes (index_id, table_id, index_name, fields_json, state)
              VALUES (?, ?, ?, ?, ?)
              `,
              index.indexId,
              index.tableId,
              index.name,
              index.fieldsJson,
              index.state,
            );
          }
          setMeta("schema_version", String(plan.version));
        };

        const applyFunctionsPlan = (plan: DeploymentFunctionsApplicationPlan): void => {
          sql.exec("DELETE FROM functions");
          for (const metadata of plan.functions) {
            sql.exec(
              `
              INSERT INTO functions (function_path, kind, visibility, args_json, returns_json, route_json, partition_json, position_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              `,
              metadata.path,
              metadata.kind,
              metadata.visibility,
              metadata.argsJson,
              metadata.returnsJson,
              metadata.routeJson,
              metadata.partitionJson,
              metadata.positionJson,
            );
          }
        };

        const applyActiveMetadataPlan = (plan: DeploymentActiveMetadataApplicationPlan): void => {
          for (const key of plan.deleteKeys) {
            sql.exec("DELETE FROM meta WHERE key = ?", key);
          }
          for (const metadata of plan.entries) {
            setMeta(metadata.key, metadata.value);
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
            return yield* activeDeploymentStatusFromStoreParts(
              activePushId,
              activePush,
              executionArtifactRef,
              activatedAt,
            );
          },
        );

        const rollbackIfStoredPushMissing = (
          operation: DeploymentStoreWriteOperation,
          pushId: string,
          stage: string,
        ): void => {
          if (readPushRow(pushId) === undefined) {
            throw new DeploymentStoreWriteRollbackError(storedPushMissing(operation, pushId, stage));
          }
        };

        const storeWriteCauseToError = (
          operation: DeploymentStoreWriteOperation,
          cause: unknown,
        ): DeploymentStoredPushMissingError | DeploymentSqlError =>
          cause instanceof DeploymentStoreWriteRollbackError
            ? cause.failure
            : new DeploymentSqlError({ operation, cause });

        const runDeploymentStoreWriteTransaction = Effect.fn(
          "DeploymentPushStore.runDeploymentStoreWriteTransaction",
        )(function* <A>(
          operation: DeploymentStoreWriteOperation,
          transaction: (txn: DurableObjectTransaction) => Promise<A>,
        ): Effect.fn.Return<A, DeploymentStoredPushMissingError | DeploymentSqlError> {
          return yield* Effect.tryPromise({
            try: () => storage.transaction(transaction),
            catch: cause => storeWriteCauseToError(operation, cause),
          });
        });

        const runStartAnalyzedPushTransaction = Effect.fn(
          "DeploymentPushStore.runStartAnalyzedPushTransaction",
        )(function* (
          status: PushStatus,
          application: DeploymentStartPushApplicationPlan,
        ): Effect.fn.Return<PushStatus, DeploymentStoreWriteError> {
          return yield* runDeploymentStoreWriteTransaction("startPush", async () => {
            const row = application.row;
            sql.exec(
              "UPDATE pushes SET state = 'superseded', updated_at = ? WHERE state IN ('pending', 'analyzed')",
              application.supersedeUpdatedAt,
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
              row.pushId,
              row.state,
              row.sourcePackageJson,
              row.schemaJson,
              row.functionsJson,
              row.codegenAnalysisJson,
              row.error,
              row.diagnosticsJson,
              row.createdAt,
              row.updatedAt,
            );
            rollbackIfStoredPushMissing("startPush", row.pushId, "stored");
            return status;
          });
        });

        const runFinishPushTransaction = Effect.fn("DeploymentPushStore.runFinishPushTransaction")(
          function* (
            input: FinishPushStoreInput,
            status: PushStatus & {
              readonly analysis: DeploymentAnalysis;
            },
            application: FinishPushActivationApplication,
          ): Effect.fn.Return<FinishPushResponse, DeploymentStoreWriteError> {
            return yield* runDeploymentStoreWriteTransaction("finishPush", async () => {
              applySchemaPlan(application.schema);
              applyFunctionsPlan(application.functions);
              sql.exec(
                "UPDATE pushes SET state = 'activated', updated_at = ? WHERE push_id = ?",
                input.now,
                input.pushId,
              );
              applyActiveMetadataPlan(application.activeMetadata);
              rollbackIfStoredPushMissing("finishPush", input.pushId, "activated");
              return {
                result: "activated" as const,
                push: { ...status, state: "activated" as const, updatedAt: input.now },
              };
            });
          },
        );

        const runAbandonPushTransaction = Effect.fn("DeploymentPushStore.runAbandonPushTransaction")(
          function* (
            status: PushStatus,
            application: DeploymentAbandonPushApplicationPlan,
          ): Effect.fn.Return<PushStatus, DeploymentStoreWriteError> {
            return yield* runDeploymentStoreWriteTransaction("abandonPush", async () => {
              sql.exec(
                "UPDATE pushes SET state = 'abandoned', error = ?, updated_at = ? WHERE push_id = ?",
                application.error,
                application.updatedAt,
                application.pushId,
              );
              rollbackIfStoredPushMissing("abandonPush", application.pushId, "abandoned");
              return {
                ...status,
                state: "abandoned" as const,
                error: application.error,
                updatedAt: application.updatedAt,
              };
            });
          },
        );

        const startAnalyzedPush = Effect.fn("DeploymentPushStore.startAnalyzedPush")(
          function* (
            input: StartAnalyzedPushStoreInput,
          ): Effect.fn.Return<PushStatus, DeploymentStoreWriteError> {
            const status = yield* decodePushStatusFromRow(pushStatusRowFromStartAnalyzedPushStoreInput(input));
            const application = yield* deploymentStartPushApplicationPlan(input);
            return yield* runStartAnalyzedPushTransaction(status, application);
          },
        );

        const finishPush = Effect.fn("DeploymentPushStore.finishPush")(
          function* (input: FinishPushStoreInput): Effect.fn.Return<
            FinishPushResponse,
            DeploymentStoreWriteError
          > {
            const status = yield* readPush(input.pushId);
            const decision = yield* deploymentFinishPushStoreDecision(input.pushId, status);
            if (decision._tag === "reject") {
              return decision.response;
            }
            const application = yield* finishPushActivationApplication(
              input,
              decision.status.analysis,
              decision.status.sourcePackage,
            );
            return yield* runFinishPushTransaction(input, decision.status, application);
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
            const application = yield* deploymentAbandonPushApplicationPlan(input);
            return yield* runAbandonPushTransaction(status, application);
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
  operation: DeploymentStoreWriteOperation,
  pushId: string,
  stage: string,
): DeploymentStoredPushMissingError {
  return new DeploymentStoredPushMissingError({ operation, pushId, stage });
}

class DeploymentStoreWriteRollbackError extends Error {
  readonly failure: DeploymentStoredPushMissingError;

  constructor(failure: DeploymentStoredPushMissingError) {
    super(`Deployment store write rollback: ${failure.operation} ${failure.pushId} ${failure.stage}.`);
    this.name = "DeploymentStoreWriteRollbackError";
    this.failure = failure;
  }
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
