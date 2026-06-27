import { Context, Effect, Layer, Schema } from "effect";
import type {
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
  PushDiagnostic,
  PushSourcePackage,
  PushStatus,
} from "../types";

const DeploymentSqlOperation = Schema.Union([
  Schema.Literal("startPush"),
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

export class DeploymentPushStore extends Context.Service<DeploymentPushStore, {
  startAnalyzedPush(input: StartAnalyzedPushStoreInput): Effect.Effect<PushStatus, DeploymentSqlError>;
}>()("flarex-backend/deployment/DeploymentPushStore") {
  static layer(
    storage: DeploymentTransactionStorage,
    sql: DeploymentSqlStorage,
    readPush: (pushId: string) => PushStatus | null,
  ) {
    return Layer.effect(
      DeploymentPushStore,
      Effect.gen(function* () {
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

        return DeploymentPushStore.of({
          startAnalyzedPush,
        });
      }),
    );
  }
}
