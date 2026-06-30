import { describe, expect, it } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { DeploymentArtifacts, DeploymentClock, DeploymentIds } from "../src/deployment/Runtime";
import {
  DeploymentActiveDeploymentInvalidError,
  DeploymentActiveDeploymentNotFoundError,
  DeploymentArtifactRefError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
  DeploymentStoredPushMissingError,
  DeploymentValidationError,
} from "../src/deployment/Errors";
import {
  DeploymentService,
  type StartAnalyzedPushInput,
} from "../src/deployment/Service";
import {
  DeploymentPushStore,
  DeploymentSqlError,
  type AbandonPushStoreInput,
  type DeploymentSqlStorage,
  type DeploymentTransactionStorage,
  type FinishPushStoreInput,
  type StartAnalyzedPushStoreInput,
} from "../src/deployment/Store";
import {
  codegenAnalysisFromDeploymentAnalysis,
  type DeploymentPushStatusRow,
} from "../src/deployment/Validation";
import type {
  ActiveDeploymentStatus,
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
  ExecutionArtifactRef,
  FinishPushResponse,
  PushSourcePackage,
  PushStatus,
} from "../src/types";

describe("DeploymentService", () => {
  it("loads the active deployment through the store", async () => {
    const active = activeDeploymentStatus("push-active");

    const result = await runDeployment(
      DeploymentService.use(service => service.getActiveDeployment()),
      {
        now: 1_600_000,
        pushId: "unused-push-id",
        store: {
          getActiveDeployment: () => Effect.succeed(active),
        },
      },
    );

    expect(result).toBe(active);
  });

  it("returns a typed not-found error for missing active deployments", async () => {
    const error = await runDeployment(
      DeploymentService.use(service => service.getActiveDeployment()).pipe(
        Effect.catchTag("DeploymentActiveDeploymentNotFoundError", error => Effect.succeed(error)),
      ),
      {
        now: 1_650_000,
        pushId: "unused-push-id",
        store: {
          getActiveDeployment: () => Effect.succeed(null),
        },
      },
    );

    expect(error).toBeInstanceOf(DeploymentActiveDeploymentNotFoundError);
  });

  it("preserves typed DeploymentSqlError failures from active deployment storage", async () => {
    const failure = new DeploymentSqlError({
      operation: "getActiveDeployment",
      cause: new Error("active read failed"),
    });

    const error = await runDeployment(
      DeploymentService.use(service => service.getActiveDeployment()).pipe(
        Effect.catchTag("DeploymentSqlError", error => Effect.succeed(error)),
      ),
      {
        now: 1_660_000,
        pushId: "unused-push-id",
        store: {
          getActiveDeployment: () => Effect.fail(failure),
        },
      },
    );

    expect(error).toBe(failure);
  });

  it("preserves typed invalid active deployment failures from storage", async () => {
    const failure = new DeploymentActiveDeploymentInvalidError({
      message: "Active push push-active is missing.",
    });

    const error = await runDeployment(
      DeploymentService.use(service => service.getActiveDeployment()).pipe(
        Effect.catchTag("DeploymentActiveDeploymentInvalidError", error => Effect.succeed(error)),
      ),
      {
        now: 1_670_000,
        pushId: "unused-push-id",
        store: {
          getActiveDeployment: () => Effect.fail(failure),
        },
      },
    );

    expect(error).toBe(failure);
  });

  it("loads push status through the store", async () => {
    const status = analyzedPushStatus("push-read");

    const result = await runDeployment(
      DeploymentService.use(service => service.getPush("push-read")),
      {
        now: 1_680_000,
        pushId: "unused-push-id",
        store: {
          getPush: pushId => Effect.succeed(pushId === "push-read" ? status : null),
        },
      },
    );

    expect(result).toBe(status);
  });

  it("returns a typed not-found error for missing push status reads", async () => {
    const error = await runDeployment(
      DeploymentService.use(service => service.getPush("missing-push")).pipe(
        Effect.catchTag("DeploymentPushNotFoundError", error => Effect.succeed(error)),
      ),
      {
        now: 1_690_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(null),
        },
      },
    );

    if (!(error instanceof DeploymentPushNotFoundError)) {
      throw new Error("Expected DeploymentPushNotFoundError.");
    }
    expect(error.pushId).toBe("missing-push");
  });

  it("preserves typed DeploymentSqlError failures from push status reads", async () => {
    const failure = new DeploymentSqlError({
      operation: "getPush",
      cause: new Error("push read failed"),
    });

    const error = await runDeployment(
      DeploymentService.use(service => service.getPush("push-read-storage-failed")).pipe(
        Effect.catchTag("DeploymentSqlError", error => Effect.succeed(error)),
      ),
      {
        now: 1_695_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.fail(failure),
        },
      },
    );

    expect(error).toBe(failure);
  });

  it("preserves typed DeploymentValidationError failures from stored push status reads", async () => {
    const status = analyzedPushStatus("push-stored-validation-failed");
    const row = pushStatusRow(status);
    const runtime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushRows([{
          ...row,
          source_package_json: "null",
        }]),
      ),
    );

    try {
      const error = await runtime.runPromise(
        DeploymentPushStore.use(store => store.getPush(status.pushId)).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );

      if (!(error instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(error.message).toBe("Source package must be an object.");
    } finally {
      await runtime.dispose();
    }
  });

  it("starts analyzed pushes with the controlled clock and push id", async () => {
    const writes: StartAnalyzedPushStoreInput[] = [];
    const input: StartAnalyzedPushInput = {
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: deploymentCodegenAnalysis(),
      diagnostics: [{ level: "log", message: "ok" }],
    };

    const result = await runDeployment(
      DeploymentService.use(service => service.startAnalyzedPush(input)),
      {
        now: 1_700_000,
        pushId: "push-analyzed",
        store: {
          startAnalyzedPush: storeInput =>
            Effect.sync(() => {
              writes.push(storeInput);
              return pushStatusFromStoreInput(storeInput);
            }),
        },
      },
    );

    expect(writes).toEqual([
      {
        pushId: "push-analyzed",
        now: 1_700_000,
        sourcePackage: input.sourcePackage,
        analysis: input.analysis,
        codegenAnalysis: input.codegenAnalysis,
        diagnostics: input.diagnostics,
      },
    ]);
    expect(result).toMatchObject({
      pushId: "push-analyzed",
      state: "analyzed",
      analysis: input.analysis,
      codegenAnalysis: input.codegenAnalysis,
    });
  });

  it("starts failed pushes without analysis metadata", async () => {
    const writes: StartAnalyzedPushStoreInput[] = [];
    const input: StartAnalyzedPushInput = {
      sourcePackage: sourcePackage(),
      error: "analysis failed",
      diagnostics: [{ level: "error", message: "failed" }],
    };

    const result = await runDeployment(
      DeploymentService.use(service => service.startAnalyzedPush(input)),
      {
        now: 1_800_000,
        pushId: "push-failed",
        store: {
          startAnalyzedPush: storeInput =>
            Effect.sync(() => {
              writes.push(storeInput);
              return pushStatusFromStoreInput(storeInput);
            }),
        },
      },
    );

    expect(writes).toEqual([
      {
        pushId: "push-failed",
        now: 1_800_000,
        sourcePackage: input.sourcePackage,
        error: "analysis failed",
        diagnostics: input.diagnostics,
      },
    ]);
    expect(result).toMatchObject({
      pushId: "push-failed",
      state: "failed",
      error: "analysis failed",
    });
  });

  it("preserves typed DeploymentSqlError failures from the store", async () => {
    const failure = new DeploymentSqlError({
      operation: "startPush",
      cause: new Error("insert failed"),
    });

    const error = await runDeployment(
      DeploymentService.use(service =>
        service.startAnalyzedPush({
          sourcePackage: sourcePackage(),
          error: "analysis failed",
          diagnostics: [],
        })
      ).pipe(
        Effect.catchTag("DeploymentSqlError", error => Effect.succeed(error)),
      ),
      {
        now: 1_900_000,
        pushId: "push-storage-failed",
        store: {
          startAnalyzedPush: () => Effect.fail(failure),
        },
      },
    );

    expect(error).toBe(failure);
  });

  it("reports missing stored start-push writes as typed store failures", async () => {
    const transaction = transactionRecorder();
    const runtime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        transaction.storage,
        sqlWithPushes([]),
      ),
    );

    try {
      const error = await runtime.runPromise(
        DeploymentPushStore.use(store =>
          store.startAnalyzedPush({
            pushId: "missing-start-write",
            now: 1_950_000,
            sourcePackage: sourcePackage(),
            diagnostics: [],
            error: "analysis failed",
          }),
        ).pipe(
          Effect.catchTag("DeploymentStoredPushMissingError", error => Effect.succeed(error)),
        ),
      );

      if (!(error instanceof DeploymentStoredPushMissingError)) {
        throw new Error("Expected DeploymentStoredPushMissingError.");
      }
      expect(error).toMatchObject({
        operation: "startPush",
        pushId: "missing-start-write",
        stage: "stored",
      });
      expect(transaction.committed).toBe(false);
      expect(transaction.rejected).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });

  it("finishes analyzed pushes with controlled clock and artifact refs", async () => {
    const preflight = analyzedPushStatus("push-finish");
    const finished: FinishPushResponse = {
      result: "activated",
      push: { ...preflight, state: "activated", updatedAt: 2_000_000 },
    };
    const artifactRequests: PushSourcePackage[] = [];
    const writes: FinishPushStoreInput[] = [];
    const ref = executionArtifactRef();

    const result = await runDeployment(
      DeploymentService.use(service => service.finishPush("push-finish")),
      {
        now: 2_000_000,
        pushId: "unused-push-id",
        artifactRef: ref,
        artifactRequests,
        store: {
          getPush: pushId => Effect.succeed(pushId === "push-finish" ? preflight : null),
          finishPush: input =>
            Effect.sync(() => {
              writes.push(input);
              return finished;
            }),
        },
      },
    );

    expect(artifactRequests).toEqual([preflight.sourcePackage]);
    expect(writes).toEqual([
      {
        pushId: "push-finish",
        now: 2_000_000,
        executionArtifactRef: ref,
      },
    ]);
    expect(result).toBe(finished);
  });

  it("preserves finish rejection responses from the store", async () => {
    const preflight = failedPushStatus("push-invalid-state");
    const rejection: FinishPushResponse = {
      result: "rejected",
      push: preflight,
      code: "invalid_state",
      error: "Cannot finish push push-invalid-state in state failed.",
      ...(preflight.diagnostics === undefined ? {} : { diagnostics: preflight.diagnostics }),
    };

    const result = await runDeployment(
      DeploymentService.use(service => service.finishPush("push-invalid-state")),
      {
        now: 2_100_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(preflight),
          finishPush: () => Effect.succeed(rejection),
        },
      },
    );

    expect(result).toBe(rejection);
  });

  it("returns a typed not-found error before artifact or finish work", async () => {
    const artifactRequests: PushSourcePackage[] = [];
    let finishCalled = false;

    const error = await runDeployment(
      DeploymentService.use(service => service.finishPush("missing-push")).pipe(
        Effect.catchTag("DeploymentPushNotFoundError", error => Effect.succeed(error)),
      ),
      {
        now: 2_200_000,
        pushId: "unused-push-id",
        artifactRequests,
        store: {
          getPush: () => Effect.succeed(null),
          finishPush: () =>
            Effect.sync(() => {
              finishCalled = true;
              return { result: "activated", push: analyzedPushStatus("missing-push") };
            }),
        },
      },
    );

    if (!(error instanceof DeploymentPushNotFoundError)) {
      throw new Error("Expected DeploymentPushNotFoundError.");
    }
    expect(error.pushId).toBe("missing-push");
    expect(artifactRequests).toEqual([]);
    expect(finishCalled).toBe(false);
  });

  it("preserves typed artifact ref failures before finish storage work", async () => {
    const preflight = analyzedPushStatus("push-artifact-failed");
    const artifactRequests: PushSourcePackage[] = [];
    let finishCalled = false;
    const failure = new DeploymentArtifactRefError({
      operation: "executionArtifactRefForSourcePackage",
      message: "artifact hash failed",
      cause: new Error("artifact hash failed"),
    });

    const error = await runDeployment(
      DeploymentService.use(service => service.finishPush("push-artifact-failed")).pipe(
        Effect.catchTag("DeploymentArtifactRefError", error => Effect.succeed(error)),
      ),
      {
        now: 2_250_000,
        pushId: "unused-push-id",
        artifactRequests,
        artifactError: failure,
        store: {
          getPush: () => Effect.succeed(preflight),
          finishPush: () =>
            Effect.sync(() => {
              finishCalled = true;
              return { result: "activated", push: preflight };
            }),
        },
      },
    );

    expect(error).toBe(failure);
    expect(artifactRequests).toEqual([preflight.sourcePackage]);
    expect(finishCalled).toBe(false);
  });

  it("preserves typed DeploymentSqlError failures from finish storage", async () => {
    const failure = new DeploymentSqlError({
      operation: "finishPush",
      cause: new Error("finish failed"),
    });

    const error = await runDeployment(
      DeploymentService.use(service => service.finishPush("push-storage-failed")).pipe(
        Effect.catchTag("DeploymentSqlError", error => Effect.succeed(error)),
      ),
      {
        now: 2_300_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(analyzedPushStatus("push-storage-failed")),
          finishPush: () => Effect.fail(failure),
        },
      },
    );

    expect(error).toBe(failure);
  });

  it("reports missing prevalidated finish writes as typed store failures", async () => {
    const transaction = transactionRecorder();
    const sql = sqlWithPushes([]);
    const runtime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        transaction.storage,
        sql,
      ),
    );

    try {
      const error = await runtime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: "missing-prevalidated-finish",
            now: 2_350_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentStoredPushMissingError", error => Effect.succeed(error)),
        ),
      );

      if (!(error instanceof DeploymentStoredPushMissingError)) {
        throw new Error("Expected DeploymentStoredPushMissingError.");
      }
      expect(error).toMatchObject({
        operation: "finishPush",
        pushId: "missing-prevalidated-finish",
        stage: "prevalidated",
      });
      expect(transaction.committed).toBe(false);
      expect(transaction.rejected).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });

  it("reports missing activated finish writes as typed store failures", async () => {
    const status = analyzedPushStatus("missing-activated-finish");
    const transaction = transactionRecorder();
    const runtime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        transaction.storage,
        sqlWithPushes([status], { deleteActivatedPush: true }),
      ),
    );

    try {
      const error = await runtime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: status.pushId,
            now: 2_360_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentStoredPushMissingError", error => Effect.succeed(error)),
        ),
      );

      if (!(error instanceof DeploymentStoredPushMissingError)) {
        throw new Error("Expected DeploymentStoredPushMissingError.");
      }
      expect(error).toMatchObject({
        operation: "finishPush",
        pushId: status.pushId,
        stage: "activated",
      });
      expect(transaction.committed).toBe(false);
      expect(transaction.rejected).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });

  it("maps activation validation failures before finish transaction writes", async () => {
    const typedStatus = analyzedPushStatus("push-typed-validation-failed");
    const typedRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedStatus,
          codegenAnalysis: {
            schema: typedStatus.analysis!.schema,
            functions: ["not-module"],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedError = await typedRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedStatus.pushId,
            now: 2_410_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedError.message).toBe("Codegen module at index 0 must be an object.");
    } finally {
      await typedRuntime.dispose();
    }

    const typedSchemaStatus = analyzedPushStatus("push-typed-schema-validation-failed");
    const typedSchemaRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedSchemaStatus,
          analysis: {
            schema: "not-schema",
            functions: typedSchemaStatus.analysis!.functions,
          } as unknown as DeploymentAnalysis,
          codegenAnalysis: {
            schema: typedSchemaStatus.analysis!.schema,
            functions: [],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedSchemaError = await typedSchemaRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedSchemaStatus.pushId,
            now: 2_412_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedSchemaError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedSchemaError.message).toBe("Schema must be an object.");
    } finally {
      await typedSchemaRuntime.dispose();
    }

    const typedPlacementStatus = analyzedPushStatus("push-typed-placement-validation-failed");
    const typedPlacementRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedPlacementStatus,
          analysis: {
            schema: {
              ...typedPlacementStatus.analysis!.schema,
              tables: [{
                tableId: 1,
                name: "messages",
                placement: { kind: "nearby" },
              }],
            },
            functions: typedPlacementStatus.analysis!.functions,
          } as unknown as DeploymentAnalysis,
          codegenAnalysis: {
            schema: typedPlacementStatus.analysis!.schema,
            functions: [],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedPlacementError = await typedPlacementRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedPlacementStatus.pushId,
            now: 2_412_500,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedPlacementError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedPlacementError.message).toBe("$schema.tables.messages.placement: Invalid placement.");
    } finally {
      await typedPlacementRuntime.dispose();
    }

    const typedValidatorJsonStatus = analyzedPushStatus("push-typed-validator-json-validation-failed");
    const typedValidatorJsonRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedValidatorJsonStatus,
          analysis: {
            schema: {
              ...typedValidatorJsonStatus.analysis!.schema,
              tables: [{
                tableId: 1,
                name: "messages",
                placement: { kind: "global" },
                validator: { type: "array", value: undefined },
              }],
            },
            functions: typedValidatorJsonStatus.analysis!.functions,
          } as unknown as DeploymentAnalysis,
          codegenAnalysis: {
            schema: typedValidatorJsonStatus.analysis!.schema,
            functions: [],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedValidatorJsonError = await typedValidatorJsonRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedValidatorJsonStatus.pushId,
            now: 2_412_750,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedValidatorJsonError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedValidatorJsonError.message).toBe(
        "Invalid validator metadata: $schema.tables.messages.validator.value: Validator is required.",
      );
    } finally {
      await typedValidatorJsonRuntime.dispose();
    }

    const typedFunctionMetadataStatus = analyzedPushStatus("push-typed-function-metadata-validation-failed");
    const typedFunctionMetadataRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedFunctionMetadataStatus,
          analysis: {
            schema: typedFunctionMetadataStatus.analysis!.schema,
            functions: {
              functions: [{ path: "lessons:list", kind: "query", route: "not-route" }],
            },
          } as unknown as DeploymentAnalysis,
          codegenAnalysis: {
            schema: typedFunctionMetadataStatus.analysis!.schema,
            functions: [],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedFunctionMetadataError = await typedFunctionMetadataRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedFunctionMetadataStatus.pushId,
            now: 2_413_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedFunctionMetadataError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedFunctionMetadataError.message).toBe("$functions.lessons:list.route: Invalid route policy.");
    } finally {
      await typedFunctionMetadataRuntime.dispose();
    }

    const typedPartitionStatus = analyzedPushStatus("push-typed-partition-validation-failed");
    const typedPartitionAnalysis = deploymentPartitionValidationAnalysis();
    const typedPartitionRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedPartitionStatus,
          analysis: typedPartitionAnalysis,
          codegenAnalysis: {
            schema: typedPartitionAnalysis.schema,
            functions: [],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedPartitionError = await typedPartitionRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedPartitionStatus.pushId,
            now: 2_415_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedPartitionError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedPartitionError.message).toBe("teams:create.partition: Unknown partition table missing.");
    } finally {
      await typedPartitionRuntime.dispose();
    }

    const typedModuleNameStatus = analyzedPushStatus("push-typed-module-name-validation-failed");
    const typedModuleNameRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedModuleNameStatus,
          codegenAnalysis: {
            schema: typedModuleNameStatus.analysis!.schema,
            functions: [{
              moduleName: "",
              functions: [],
            }],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedModuleNameError = await typedModuleNameRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedModuleNameStatus.pushId,
            now: 2_420_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedModuleNameError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedModuleNameError.message).toBe("Codegen module at index 0 has an invalid moduleName.");
    } finally {
      await typedModuleNameRuntime.dispose();
    }

    const typedModuleFunctionsStatus = analyzedPushStatus("push-typed-module-functions-validation-failed");
    const typedModuleFunctionsRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedModuleFunctionsStatus,
          codegenAnalysis: {
            schema: typedModuleFunctionsStatus.analysis!.schema,
            functions: [{
              moduleName: "messages",
              functions: "not-functions",
            }],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedModuleFunctionsError = await typedModuleFunctionsRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedModuleFunctionsStatus.pushId,
            now: 2_430_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedModuleFunctionsError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedModuleFunctionsError.message).toBe("Codegen module messages functions must be an array.");
    } finally {
      await typedModuleFunctionsRuntime.dispose();
    }

    const duplicateModuleStatus = analyzedPushStatus("push-duplicate-module-validation-failed");
    const duplicateModuleRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...duplicateModuleStatus,
          codegenAnalysis: {
            schema: duplicateModuleStatus.analysis!.schema,
            functions: [
              { moduleName: "messages", functions: [] },
              { moduleName: "messages", functions: [] },
            ],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const duplicateModuleError = await duplicateModuleRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: duplicateModuleStatus.pushId,
            now: 2_440_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(duplicateModuleError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(duplicateModuleError.message).toBe("Duplicate codegen module metadata: messages.");
    } finally {
      await duplicateModuleRuntime.dispose();
    }

    const typedFunctionObjectStatus = analyzedPushStatus("push-typed-function-object-validation-failed");
    const typedFunctionObjectRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedFunctionObjectStatus,
          codegenAnalysis: {
            schema: typedFunctionObjectStatus.analysis!.schema,
            functions: [{
              moduleName: "messages",
              functions: ["not-function"],
            }],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedFunctionObjectError = await typedFunctionObjectRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedFunctionObjectStatus.pushId,
            now: 2_450_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedFunctionObjectError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedFunctionObjectError.message).toBe("Codegen function messages[0] must be an object.");
    } finally {
      await typedFunctionObjectRuntime.dispose();
    }

    const typedFunctionModuleNameStatus = analyzedPushStatus("push-typed-function-module-name-validation-failed");
    const typedFunctionModuleNameRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedFunctionModuleNameStatus,
          codegenAnalysis: {
            schema: typedFunctionModuleNameStatus.analysis!.schema,
            functions: [{
              moduleName: "messages",
              functions: [{
                moduleName: "other",
                exportName: "list",
                kind: "query",
                visibility: "public",
                args: { type: "any" },
                returns: null,
                partition: null,
              }],
            }],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedFunctionModuleNameError = await typedFunctionModuleNameRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedFunctionModuleNameStatus.pushId,
            now: 2_460_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedFunctionModuleNameError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedFunctionModuleNameError.message).toBe(
        "Codegen function messages[0] moduleName must match its module.",
      );
    } finally {
      await typedFunctionModuleNameRuntime.dispose();
    }

    const typedFunctionExportNameStatus = analyzedPushStatus("push-typed-function-export-name-validation-failed");
    const typedFunctionExportNameRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedFunctionExportNameStatus,
          codegenAnalysis: {
            schema: typedFunctionExportNameStatus.analysis!.schema,
            functions: [{
              moduleName: "messages",
              functions: [{
                moduleName: "messages",
                exportName: "",
                kind: "query",
                visibility: "public",
                args: { type: "any" },
                returns: null,
                partition: null,
              }],
            }],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedFunctionExportNameError = await typedFunctionExportNameRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedFunctionExportNameStatus.pushId,
            now: 2_470_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedFunctionExportNameError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedFunctionExportNameError.message).toBe(
        "Codegen function messages[0] has an invalid exportName.",
      );
    } finally {
      await typedFunctionExportNameRuntime.dispose();
    }

    const typedCodegenMetadataStatus = analyzedPushStatus("push-typed-codegen-metadata-validation-failed");
    const typedCodegenMetadataRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedCodegenMetadataStatus,
          codegenAnalysis: {
            schema: typedCodegenMetadataStatus.analysis!.schema,
            functions: [{
              moduleName: "messages",
              functions: [{
                moduleName: "messages",
                exportName: "missing",
                kind: "query",
                visibility: "public",
                args: { type: "any" },
                returns: null,
                partition: null,
              }],
            }],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedCodegenMetadataError = await typedCodegenMetadataRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedCodegenMetadataStatus.pushId,
            now: 2_480_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedCodegenMetadataError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedCodegenMetadataError.message).toBe(
        "Codegen function messages:missing has no deployment function metadata.",
      );
    } finally {
      await typedCodegenMetadataRuntime.dispose();
    }

    const duplicateFunctionStatus = analyzedPushStatus("push-duplicate-function-validation-failed");
    const duplicateFunctionRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...duplicateFunctionStatus,
          codegenAnalysis: {
            schema: duplicateFunctionStatus.analysis!.schema,
            functions: [{
              moduleName: "lessons",
              functions: [
                {
                  moduleName: "lessons",
                  exportName: "list",
                  kind: "query",
                  visibility: "public",
                  args: { type: "object", value: {} },
                  returns: null,
                  partition: null,
                },
                {
                  moduleName: "lessons",
                  exportName: "list",
                  kind: "query",
                  visibility: "public",
                  args: { type: "object", value: {} },
                  returns: null,
                  partition: null,
                },
              ],
            }],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const duplicateFunctionError = await duplicateFunctionRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: duplicateFunctionStatus.pushId,
            now: 2_490_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(duplicateFunctionError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(duplicateFunctionError.message).toBe(
        "Duplicate codegen function metadata path: lessons:list.",
      );
    } finally {
      await duplicateFunctionRuntime.dispose();
    }

    const typedFunctionArgsStatus = analyzedPushStatus("push-typed-function-args-validation-failed");
    const typedFunctionArgsRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedFunctionArgsStatus,
          codegenAnalysis: {
            schema: typedFunctionArgsStatus.analysis!.schema,
            functions: [{
              moduleName: "lessons",
              functions: [{
                moduleName: "lessons",
                exportName: "list",
                kind: "query",
                visibility: "public",
                args: null,
                returns: null,
                partition: null,
              }],
            }],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedFunctionArgsError = await typedFunctionArgsRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedFunctionArgsStatus.pushId,
            now: 2_500_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedFunctionArgsError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedFunctionArgsError.message).toBe(
        "$codegen.functions.lessons:list.args: Validator is required.",
      );
    } finally {
      await typedFunctionArgsRuntime.dispose();
    }

    const typedFunctionMatchStatus = analyzedPushStatus("push-typed-function-match-validation-failed");
    const typedFunctionMatchRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedFunctionMatchStatus,
          codegenAnalysis: {
            schema: typedFunctionMatchStatus.analysis!.schema,
            functions: [{
              moduleName: "lessons",
              functions: [{
                moduleName: "lessons",
                exportName: "list",
                kind: "mutation",
                visibility: "public",
                args: { type: "object", value: {} },
                returns: null,
                partition: null,
              }],
            }],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedFunctionMatchError = await typedFunctionMatchRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedFunctionMatchStatus.pushId,
            now: 2_520_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedFunctionMatchError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedFunctionMatchError.message).toBe(
        "Codegen function lessons:list must match deployment function metadata.",
      );
    } finally {
      await typedFunctionMatchRuntime.dispose();
    }

    const typedCodegenCoverageStatus = analyzedPushStatus("push-typed-codegen-coverage-validation-failed");
    const typedCodegenCoverageRuntime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        {
          transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
        } as DeploymentTransactionStorage,
        sqlWithPushes([{
          ...typedCodegenCoverageStatus,
          codegenAnalysis: {
            schema: typedCodegenCoverageStatus.analysis!.schema,
            functions: [],
          } as unknown as DeploymentCodegenAnalysis,
        }]),
      ),
    );

    try {
      const typedCodegenCoverageError = await typedCodegenCoverageRuntime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: typedCodegenCoverageStatus.pushId,
            now: 2_510_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ).pipe(
          Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
        ),
      );
      if (!(typedCodegenCoverageError instanceof DeploymentValidationError)) {
        throw new Error("Expected DeploymentValidationError.");
      }
      expect(typedCodegenCoverageError.message).toBe(
        "Codegen analysis functions must cover every deployment function.",
      );
    } finally {
      await typedCodegenCoverageRuntime.dispose();
    }
  });

  it("writes active deployment metadata from the finish transaction", async () => {
    const status = analyzedPushStatus("push-store-metadata");
    const storage = {
      transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
    } as DeploymentTransactionStorage;
    const metadata = new Map<string, string>();
    const ref = executionArtifactRef();
    const sql = sqlWithPushes([status], { metadata });
    const runtime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        storage,
        sql,
      ),
    );

    try {
      const result = await runtime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: status.pushId,
            now: 2_450_000,
            executionArtifactRef: ref,
          }),
        ),
      );

      expect(result).toMatchObject({
        result: "activated",
        push: {
          pushId: status.pushId,
          state: "activated",
          updatedAt: 2_450_000,
        },
      });
      expect(metadata).toEqual(new Map<string, string>([
        ["schema_version", String(status.analysis?.schema.version)],
        ["active_push_id", status.pushId],
        ["active_activated_at", "2450000"],
        ["active_execution_artifact_ref", JSON.stringify(ref)],
      ]));
    } finally {
      await runtime.dispose();
    }
  });

  it("abandons eligible pushes with controlled clock and normalized reasons", async () => {
    const preflight = analyzedPushStatus("push-abandon");
    const abandoned: PushStatus = {
      ...preflight,
      state: "abandoned",
      error: "typecheck failed",
      updatedAt: 2_500_000,
    };
    const writes: AbandonPushStoreInput[] = [];

    const result = await runDeployment(
      DeploymentService.use(service => service.abandonPush("push-abandon", { reason: "typecheck failed" })),
      {
        now: 2_500_000,
        pushId: "unused-push-id",
        store: {
          getPush: pushId => Effect.succeed(pushId === "push-abandon" ? preflight : null),
          abandonPush: input =>
            Effect.sync(() => {
              writes.push(input);
              return abandoned;
            }),
        },
      },
    );

    expect(writes).toEqual([
      {
        pushId: "push-abandon",
        now: 2_500_000,
        reason: "typecheck failed",
      },
    ]);
    expect(result).toBe(abandoned);
  });

  it("defaults and truncates abandon reasons before storage", async () => {
    const writes: AbandonPushStoreInput[] = [];

    await runDeployment(
      DeploymentService.use(service => service.abandonPush("push-default-reason", {})),
      {
        now: 2_600_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(analyzedPushStatus("push-default-reason")),
          abandonPush: input =>
            Effect.sync(() => {
              writes.push(input);
              return { ...analyzedPushStatus(input.pushId), state: "abandoned", error: input.reason };
            }),
        },
      },
    );

    await runDeployment(
      DeploymentService.use(service => service.abandonPush("push-long-reason", { reason: "x".repeat(1_100) })),
      {
        now: 2_700_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(analyzedPushStatus("push-long-reason")),
          abandonPush: input =>
            Effect.sync(() => {
              writes.push(input);
              return { ...analyzedPushStatus(input.pushId), state: "abandoned", error: input.reason };
            }),
        },
      },
    );

    expect(writes[0]).toMatchObject({
      pushId: "push-default-reason",
      reason: "Push abandoned before activation.",
    });
    expect(writes[1]).toMatchObject({
      pushId: "push-long-reason",
      reason: "x".repeat(1_000),
    });
  });

  it("returns a typed not-found error before abandon storage work", async () => {
    let abandonCalled = false;

    const error = await runDeployment(
      DeploymentService.use(service => service.abandonPush("missing-push", {})).pipe(
        Effect.catchTag("DeploymentPushNotFoundError", error => Effect.succeed(error)),
      ),
      {
        now: 2_800_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(null),
          abandonPush: () =>
            Effect.sync(() => {
              abandonCalled = true;
              return failedPushStatus("missing-push");
            }),
        },
      },
    );

    if (!(error instanceof DeploymentPushNotFoundError)) {
      throw new Error("Expected DeploymentPushNotFoundError.");
    }
    expect(error.pushId).toBe("missing-push");
    expect(abandonCalled).toBe(false);
  });

  it("returns a typed invalid-state error before abandon storage work", async () => {
    const preflight: PushStatus = { ...analyzedPushStatus("push-activated"), state: "activated" };
    let abandonCalled = false;

    const error = await runDeployment(
      DeploymentService.use(service => service.abandonPush("push-activated", {})).pipe(
        Effect.catchTag("DeploymentPushInvalidStateError", error => Effect.succeed(error)),
      ),
      {
        now: 2_900_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(preflight),
          abandonPush: () =>
            Effect.sync(() => {
              abandonCalled = true;
              return preflight;
            }),
        },
      },
    );

    if (!(error instanceof DeploymentPushInvalidStateError)) {
      throw new Error("Expected DeploymentPushInvalidStateError.");
    }
    expect(error).toMatchObject({
      action: "abandon",
      pushId: "push-activated",
      state: "activated",
    });
    expect(abandonCalled).toBe(false);
  });

  it("preserves typed DeploymentSqlError failures from abandon storage", async () => {
    const failure = new DeploymentSqlError({
      operation: "abandonPush",
      cause: new Error("abandon failed"),
    });

    const error = await runDeployment(
      DeploymentService.use(service => service.abandonPush("push-abandon-storage-failed", {})).pipe(
        Effect.catchTag("DeploymentSqlError", error => Effect.succeed(error)),
      ),
      {
        now: 3_000_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(analyzedPushStatus("push-abandon-storage-failed")),
          abandonPush: () => Effect.fail(failure),
        },
      },
    );

    expect(error).toBe(failure);
  });

  it("persists prevalidated abandon writes through the store without HTTP-shaped business failures", async () => {
    const status = analyzedPushStatus("push-store-abandon");
    const storage = {
      transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
    } as DeploymentTransactionStorage;
    const sql = sqlWithPushes([status]);
    const runtime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        storage,
        sql,
      ),
    );

    try {
      const abandoned = await runtime.runPromise(
        DeploymentPushStore.use(store =>
          store.abandonPush({
            pushId: status.pushId,
            now: 3_100_000,
            reason: "typecheck failed",
          }),
        ),
      );
      expect(abandoned).toMatchObject({
        pushId: status.pushId,
        state: "abandoned",
        error: "typecheck failed",
        updatedAt: 3_100_000,
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("reports missing abandon writes as typed store failures", async () => {
    const transaction = transactionRecorder();
    const runtime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        transaction.storage,
        sqlWithPushes([]),
      ),
    );

    try {
      const error = await runtime.runPromise(
        DeploymentPushStore.use(store =>
          store.abandonPush({
            pushId: "missing-abandon-write",
            now: 3_150_000,
            reason: "typecheck failed",
          }),
        ).pipe(
          Effect.catchTag("DeploymentStoredPushMissingError", error => Effect.succeed(error)),
        ),
      );

      if (!(error instanceof DeploymentStoredPushMissingError)) {
        throw new Error("Expected DeploymentStoredPushMissingError.");
      }
      expect(error).toMatchObject({
        operation: "abandonPush",
        pushId: "missing-abandon-write",
        stage: "abandoned",
      });
      expect(transaction.committed).toBe(false);
      expect(transaction.rejected).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });

  it("reports invalid active deployment metadata as typed storage metadata failure", async () => {
    const status = analyzedPushStatus("push-active-metadata");
    const storage = {
      transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
    } as DeploymentTransactionStorage;
    const metadata = new Map<string, string>([
      ["active_push_id", status.pushId],
      ["active_activated_at", "3200000"],
    ]);
    const sql = sqlWithPushes([status], { metadata });
    const runtime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        storage,
        sql,
      ),
    );

    try {
      const error = await runtime.runPromise(
        DeploymentPushStore.use(store => store.getActiveDeployment()).pipe(
          Effect.catchTag("DeploymentActiveDeploymentInvalidError", error => Effect.succeed(error)),
        ),
      );
      if (!(error instanceof DeploymentActiveDeploymentInvalidError)) {
        throw new Error("Expected DeploymentActiveDeploymentInvalidError.");
      }
      expect(error).toBeInstanceOf(DeploymentActiveDeploymentInvalidError);
      expect(error.message).toBe(`Active push ${status.pushId} has no execution artifact reference.`);
    } finally {
      await runtime.dispose();
    }
  });

  it("reports malformed active execution artifact refs as typed active deployment failures", async () => {
    const status = analyzedPushStatus("push-active-artifact-ref");
    const storage = {
      transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
    } as DeploymentTransactionStorage;
    const metadata = new Map<string, string>([
      ["active_push_id", status.pushId],
      ["active_activated_at", "3300000"],
      ["active_execution_artifact_ref", JSON.stringify({ ...executionArtifactRef(), artifactId: "bad-ref" })],
    ]);
    const sql = sqlWithPushes([status], { metadata });
    const runtime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        storage,
        sql,
      ),
    );

    try {
      const error = await runtime.runPromise(
        DeploymentPushStore.use(store => store.getActiveDeployment()).pipe(
          Effect.catchTag("DeploymentActiveDeploymentInvalidError", error => Effect.succeed(error)),
        ),
      );
      if (!(error instanceof DeploymentActiveDeploymentInvalidError)) {
        throw new Error("Expected DeploymentActiveDeploymentInvalidError.");
      }
      expect(error.message).toBe("Stored execution artifact reference has an invalid artifact ID.");
    } finally {
      await runtime.dispose();
    }
  });
});

interface DeploymentTestStore {
  getPush?(pushId: string): Effect.Effect<PushStatus | null, DeploymentSqlError | DeploymentValidationError>;
  getActiveDeployment?(): Effect.Effect<
    ActiveDeploymentStatus | null,
    DeploymentActiveDeploymentInvalidError | DeploymentSqlError | DeploymentValidationError
  >;
  startAnalyzedPush?(
    input: StartAnalyzedPushStoreInput,
  ): Effect.Effect<PushStatus, DeploymentSqlError | DeploymentStoredPushMissingError | DeploymentValidationError>;
  finishPush?(input: FinishPushStoreInput): Effect.Effect<
    FinishPushResponse,
    DeploymentSqlError | DeploymentStoredPushMissingError | DeploymentValidationError
  >;
  abandonPush?(input: AbandonPushStoreInput): Effect.Effect<
    PushStatus,
    DeploymentSqlError | DeploymentStoredPushMissingError | DeploymentValidationError
  >;
}

interface DeploymentTestLayerOptions {
  readonly now: number;
  readonly pushId: string;
  readonly artifactRef?: ExecutionArtifactRef;
  readonly artifactError?: DeploymentArtifactRefError;
  readonly artifactRequests?: PushSourcePackage[];
  readonly store: DeploymentTestStore;
}

async function runDeployment<A, E>(
  effect: Effect.Effect<A, E, DeploymentService>,
  options: DeploymentTestLayerOptions,
): Promise<A> {
  const runtime = ManagedRuntime.make(deploymentTestLayer(options));
  try {
    return await runtime.runPromise(effect);
  } finally {
    await runtime.dispose();
  }
}

function deploymentTestLayer(options: DeploymentTestLayerOptions) {
  const store = testStore(options.store);
  return DeploymentService.layer.pipe(
    Layer.provide(
      Layer.succeed(
        DeploymentPushStore,
        DeploymentPushStore.of({
          getPush: store.getPush,
          getActiveDeployment: store.getActiveDeployment,
          startAnalyzedPush: store.startAnalyzedPush,
          finishPush: store.finishPush,
          abandonPush: store.abandonPush,
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        DeploymentArtifacts,
        DeploymentArtifacts.of({
          executionArtifactRefForSourcePackage: sourcePackage => {
            options.artifactRequests?.push(sourcePackage);
            if (options.artifactError !== undefined) {
              return Effect.fail(options.artifactError);
            }
            return Effect.succeed(options.artifactRef ?? executionArtifactRef());
          },
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        DeploymentClock,
        DeploymentClock.of({
          currentTimeMillis: Effect.succeed(options.now),
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        DeploymentIds,
        DeploymentIds.of({
          pushId: Effect.succeed(options.pushId),
        }),
      ),
    ),
  );
}

function transactionRecorder(): {
  readonly storage: DeploymentTransactionStorage;
  committed: boolean;
  rejected: boolean;
} {
  const recorder = {
    committed: false,
    rejected: false,
    storage: {
      transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => {
        try {
          const value = await callback();
          recorder.committed = true;
          return value;
        } catch (error) {
          recorder.rejected = true;
          throw error;
        }
      },
    } as DeploymentTransactionStorage,
  };
  return recorder;
}

function testStore(store: DeploymentTestStore): Required<DeploymentTestStore> {
  return {
    getPush: store.getPush ?? (() => Effect.succeed(null)),
    getActiveDeployment: store.getActiveDeployment ?? (() => Effect.succeed(null)),
    startAnalyzedPush: store.startAnalyzedPush ?? (input => Effect.succeed(pushStatusFromStoreInput(input))),
    finishPush: store.finishPush ?? (() => Effect.succeed({
      result: "activated",
      push: analyzedPushStatus("default-finished-push"),
    })),
    abandonPush: store.abandonPush ?? (input => Effect.succeed({
      ...analyzedPushStatus(input.pushId),
      state: "abandoned",
      error: input.reason,
      updatedAt: input.now,
    })),
  };
}

function pushStatusFromStoreInput(input: StartAnalyzedPushStoreInput): PushStatus {
  const base = {
    pushId: input.pushId,
    sourcePackage: input.sourcePackage,
    diagnostics: [...input.diagnostics],
    createdAt: input.now,
    updatedAt: input.now,
  };
  if ("analysis" in input) {
    return {
      ...base,
      state: "analyzed",
      analysis: input.analysis,
      codegenAnalysis: input.codegenAnalysis,
    };
  }
  return {
    ...base,
    state: "failed",
    error: input.error,
  };
}

function sqlWithPushes(
  pushes: ReadonlyArray<PushStatus>,
  options: {
    readonly metadata?: Map<string, string>;
    readonly onExec?: (query: string) => void;
    readonly deleteActivatedPush?: boolean;
  } = {},
): DeploymentSqlStorage {
  return sqlWithPushRows(pushes.map(pushStatusRow), options);
}

function sqlWithPushRows(
  pushRows: ReadonlyArray<DeploymentPushStatusRow>,
  options: {
    readonly metadata?: Map<string, string>;
    readonly onExec?: (query: string) => void;
    readonly deleteActivatedPush?: boolean;
  } = {},
): DeploymentSqlStorage {
  const rows = new Map(pushRows.map(row => [row.push_id, row]));
  const metadata = options.metadata ?? new Map<string, string>();
  return {
    exec: (query: string, ...args: ReadonlyArray<unknown>) => {
      options.onExec?.(query);
      if (query.includes("INSERT INTO meta")) {
        const [key, value] = args;
        if (typeof key === "string" && typeof value === "string") {
          metadata.set(key, value);
        }
      }
      if (query.includes("UPDATE pushes SET state = 'activated'")) {
        const [updatedAt, pushId] = args;
        if (typeof pushId === "string" && typeof updatedAt === "number") {
          const row = rows.get(pushId);
          if (row === undefined) return { toArray: () => [] };
          if (options.deleteActivatedPush === true) {
            rows.delete(pushId);
            return { toArray: () => [] };
          }
          rows.set(pushId, { ...row, state: "activated", updated_at: updatedAt });
        }
      }
      if (query.includes("UPDATE pushes SET state = 'abandoned'")) {
        const [error, updatedAt, pushId] = args;
        if (typeof pushId === "string" && typeof updatedAt === "number" && typeof error === "string") {
          const row = rows.get(pushId);
          if (row === undefined) return { toArray: () => [] };
          rows.set(pushId, {
            ...row,
            state: "abandoned",
            error,
            updated_at: updatedAt,
          });
        }
      }
      return {
        toArray: () => {
          if (query.includes("SELECT value FROM meta")) {
            const key = args[0];
            const value = typeof key === "string" ? metadata.get(key) : undefined;
            return value === undefined ? [] : [{ value }];
          }
          const pushId = args[0];
          if (typeof pushId !== "string") return [];
          const row = rows.get(pushId);
          return row === undefined ? [] : [row];
        },
      };
    },
  } as unknown as DeploymentSqlStorage;
}

function pushStatusRow(push: PushStatus): DeploymentPushStatusRow {
  return {
    push_id: push.pushId,
    state: push.state,
    source_package_json: JSON.stringify(push.sourcePackage),
    schema_json: push.analysis === undefined ? null : JSON.stringify(push.analysis.schema),
    functions_json: push.analysis === undefined ? null : JSON.stringify(push.analysis.functions),
    codegen_analysis_json: push.codegenAnalysis === undefined
      ? push.analysis === undefined
        ? null
        : JSON.stringify(codegenAnalysisFromDeploymentAnalysis(push.analysis))
      : JSON.stringify(push.codegenAnalysis),
    error: push.error ?? null,
    diagnostics_json: push.diagnostics === undefined || push.diagnostics.length === 0
      ? null
      : JSON.stringify(push.diagnostics),
    created_at: push.createdAt,
    updated_at: push.updatedAt,
  };
}

function analyzedPushStatus(pushId: string): PushStatus {
  return {
    pushId,
    state: "analyzed",
    sourcePackage: sourcePackage(),
    analysis: deploymentAnalysis(),
    codegenAnalysis: deploymentCodegenAnalysis(),
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

function failedPushStatus(pushId: string): PushStatus {
  return {
    pushId,
    state: "failed",
    sourcePackage: sourcePackage(),
    error: "analysis failed",
    diagnostics: [{ level: "error", message: "failed" }],
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

function activeDeploymentStatus(activePushId: string): ActiveDeploymentStatus {
  const source = sourcePackage();
  const analysis = deploymentAnalysis();
  const codegenAnalysis = deploymentCodegenAnalysis();
  return {
    activePushId,
    activatedAt: 2_000,
    schemaVersion: analysis.schema.version,
    executionArtifactRef: executionArtifactRef(),
    sourcePackage: source,
    analysis,
    codegenAnalysis,
  };
}

function executionArtifactRef(): ExecutionArtifactRef {
  return {
    runtime: "dynamic-worker",
    artifactId: "artifact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sourcePackageHash: "a".repeat(64),
    executionModule: "__execution.ts",
  };
}

function sourcePackage(): PushSourcePackage {
  return {
    modules: [
      {
        path: "lessons.ts",
        environment: "isolate",
        sha256: "a".repeat(64),
      },
      {
        path: "__execution.ts",
        environment: "isolate",
        sha256: "b".repeat(64),
      },
    ],
    functions: ["lessons.ts"],
    execution: "__execution.ts",
  };
}

function deploymentAnalysis(): DeploymentAnalysis {
  return {
    schema: {
      version: 1,
      tables: [],
      indexes: [],
    },
    functions: {
      functions: [
        {
          path: "lessons:list",
          kind: "query",
          visibility: "public",
          args: { type: "object", value: {} },
          returns: null,
          route: null,
          partition: null,
        },
      ],
    },
  };
}

function deploymentPartitionValidationAnalysis(): DeploymentAnalysis {
  return {
    schema: {
      version: 1,
      tables: [{
        tableId: 1,
        name: "teams",
        placement: { kind: "partitionBy", field: "slug" },
      }],
      indexes: [],
    },
    functions: {
      functions: [{
        path: "teams:create",
        kind: "mutation",
        args: { type: "object", value: { teamSlug: { fieldType: { type: "string" }, optional: false } } },
        route: { type: "args", field: "teamSlug" },
        partition: {
          type: "partition",
          table: "missing",
          selector: "byId",
          partitionField: "_id",
          argField: "teamSlug",
        },
      }],
    },
  };
}

function deploymentCodegenAnalysis(): DeploymentCodegenAnalysis {
  return {
    schema: deploymentAnalysis().schema,
    functions: [
      {
        moduleName: "lessons",
        functions: [
          {
            moduleName: "lessons",
            exportName: "list",
            kind: "query",
            visibility: "public",
            args: { type: "object", value: {} },
            returns: null,
            partition: null,
          },
        ],
      },
    ],
  };
}
