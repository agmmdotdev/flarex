import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeApplicationTaskRunCreationAuthorityPreimageV1,
  decodeApplicationTaskRunCreationAuthorityV1,
  decodeApplicationTaskRuntimeTargetV1,
  encodeApplicationTaskRunCreationAuthorityPreimageV1,
  encodeApplicationTaskRuntimeTargetPreimageV1,
  hashApplicationTaskRunCreationAuthorityV1,
  hashApplicationTaskRuntimeTargetV1,
  APPLICATION_TASK_CATALOG_BINDING_CODEC_V1,
  APPLICATION_TASK_DEFINITION_BINDING_CODEC_V1,
  decodeApplicationTaskCatalogBindingV1,
  hashApplicationTaskCatalogBindingV1,
  produceApplicationTaskBindingsV1,
} from "../src/applicationTaskBinding/v1";
import {
  hashCanonicalTaskCatalogV1,
  makeStandardApplicationTaskSha256V1,
  StandardApplicationTaskSha256InputV1Error,
  type HashedCanonicalTaskCatalogV1,
  type StandardApplicationTaskSha256V1,
} from "../src/taskDefinition/v1";
import { prepareStandardApplicationDefinitionV1 } from "../src/preparedDefinitionV1";

const UTF8 = new TextDecoder();
const sha256 = makeStandardApplicationTaskSha256V1((input) =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);
const authority = Object.freeze({
  scopeId: "scope-orders",
  revisionId: "revision-orders-v2",
  candidateId: "candidate-orders",
  analysisId: "analysis-orders",
  publicationSha256: "11".repeat(32),
  sourceArtifactRootSha256: "22".repeat(32),
});
const runtimePolicy = Object.freeze({
  runtimeHostIdentity: "application-runtime-host",
  compatibilityDate: "2026-06-14",
});

describe("Application task binding V1", () => {
  it("produces deterministic new bindings without displaced runtime evidence", async () => {
    const definition = makeDefinition();
    const catalog = await makeCatalog();
    const first = await Effect.runPromise(produceApplicationTaskBindingsV1({
      definition,
      catalog,
      authority,
      runtimePolicy,
    }, sha256));
    const replay = await Effect.runPromise(produceApplicationTaskBindingsV1({
      definition,
      catalog,
      authority,
      runtimePolicy,
    }, sha256));

    expect(first).toEqual(replay);
    expect(first.definitions).toHaveLength(1);
    expect(first.definitions[0]?.binding.handler).toEqual({
      logicalModulePath: "tasks/orders",
      sourceModulePath: "tasks/orders.js",
      exportName: "run",
    });
    const catalogText = UTF8.decode(first.catalog.canonicalBytes);
    const definitionText = UTF8.decode(first.definitions[0]?.canonicalBytes);
    expect(catalogText).toContain(APPLICATION_TASK_CATALOG_BINDING_CODEC_V1);
    expect(definitionText).toContain(
      APPLICATION_TASK_DEFINITION_BINDING_CODEC_V1,
    );
    for (const displaced of [
      "artifactSha256",
      "candidateSha256",
      "packageSha256",
      "projectionSha256",
      "semanticRootSha256",
    ]) {
      expect(catalogText).not.toContain(displaced);
      expect(definitionText).not.toContain(displaced);
    }
  });

  it("represents an explicitly empty task catalog with one header", async () => {
    const catalog = await Effect.runPromise(hashCanonicalTaskCatalogV1({
      version: 1,
      tasks: [],
    }, sha256));
    const produced = await Effect.runPromise(produceApplicationTaskBindingsV1({
      definition: makeDefinition(),
      catalog,
      authority,
      runtimePolicy,
    }, sha256));

    expect(produced.catalog.binding.taskCount).toBe(0);
    expect(produced.definitions).toEqual([]);
  });

  it("canonicalizes one Application task runtime target without Legacy evidence", async () => {
    const produced = await Effect.runPromise(produceApplicationTaskBindingsV1({
      definition: makeDefinition(),
      catalog: await makeCatalog(),
      authority,
      runtimePolicy,
    }, sha256));
    const definition = produced.definitions[0]!;
    const targetInput = {
      version: 1,
      ...authority,
      ...runtimePolicy,
      applicationTaskCatalogBindingSha256: produced.catalog.sha256,
      applicationTaskDefinitionBindingSha256: definition.sha256,
      taskCatalogSha256: produced.catalog.binding.taskCatalogSha256,
      taskId: definition.binding.taskId,
      canonicalTaskManifestSha256:
        definition.binding.canonicalTaskManifestSha256,
      handler: definition.binding.handler,
    };
    const target = Result.getOrThrow(
      decodeApplicationTaskRuntimeTargetV1(targetInput),
    );
    const bytes = Result.getOrThrow(
      encodeApplicationTaskRuntimeTargetPreimageV1(target),
    );
    const digest = await Effect.runPromise(
      hashApplicationTaskRuntimeTargetV1(target, sha256),
    );
    const text = UTF8.decode(bytes);

    expect(target.handler).toEqual(definition.binding.handler);
    expect(digest).toHaveLength(32);
    expect(text).toContain("application-task-runtime-target/v1");
    for (const displaced of [
      "applicationRevisionId",
      "artifactSha256",
      "packageSha256",
      "semanticRootSha256",
      "taskDefinitionRevisionId",
    ]) expect(text).not.toContain(displaced);

    expect(Result.isFailure(decodeApplicationTaskRuntimeTargetV1({
      ...targetInput,
      extra: true,
    }))).toBe(true);
  });

  it("binds run creation to the selected active Application task authority", async () => {
    const produced = await Effect.runPromise(produceApplicationTaskBindingsV1({
      definition: makeDefinition(),
      catalog: await makeCatalog(),
      authority,
      runtimePolicy,
    }, sha256));
    const definition = produced.definitions[0]!;
    const runtimeTarget = Result.getOrThrow(
      decodeApplicationTaskRuntimeTargetV1({
        version: 1,
        ...authority,
        ...runtimePolicy,
        applicationTaskCatalogBindingSha256: produced.catalog.sha256,
        applicationTaskDefinitionBindingSha256: definition.sha256,
        taskCatalogSha256: produced.catalog.binding.taskCatalogSha256,
        taskId: definition.binding.taskId,
        canonicalTaskManifestSha256:
          definition.binding.canonicalTaskManifestSha256,
        handler: definition.binding.handler,
      }),
    );
    const callerHead = new Uint8Array(32).fill(0x61);
    const callerReadiness = new Uint8Array(32).fill(0x62);
    const callerTarget = new Uint8Array(32).fill(0x63);
    const creationAuthority = Result.getOrThrow(
      decodeApplicationTaskRunCreationAuthorityV1({
        version: 1,
        scopeId: authority.scopeId,
        activationSequence: 7n,
        activeHeadSha256: callerHead,
        readinessSha256: callerReadiness,
        runtimeTarget,
        applicationTaskRuntimeTargetSha256: callerTarget,
      }),
    );

    callerHead.fill(0xff);
    callerReadiness.fill(0xff);
    callerTarget.fill(0xff);
    expect(creationAuthority.activeHeadSha256).toEqual(
      new Uint8Array(32).fill(0x61),
    );
    expect(creationAuthority.readinessSha256).toEqual(
      new Uint8Array(32).fill(0x62),
    );
    expect(creationAuthority.applicationTaskRuntimeTargetSha256).toEqual(
      new Uint8Array(32).fill(0x63),
    );

    const bytes = Result.getOrThrow(
      encodeApplicationTaskRunCreationAuthorityPreimageV1(creationAuthority),
    );
    const replay = Result.getOrThrow(
      decodeApplicationTaskRunCreationAuthorityPreimageV1(bytes),
    );
    const digest = await Effect.runPromise(
      hashApplicationTaskRunCreationAuthorityV1(creationAuthority, sha256),
    );
    const text = UTF8.decode(bytes);

    expect(replay).toEqual(creationAuthority);
    expect(replay.activeHeadSha256).not.toBe(
      creationAuthority.activeHeadSha256,
    );
    expect(digest).toHaveLength(32);
    expect(text).toContain(
      "application-task-run-creation-authority/v1",
    );
    expect(text).toContain('"activationSequence":"7"');
    for (const displaced of [
      "artifactSha256",
      "candidateSha256",
      "taskDefinitionRevisionId",
    ]) expect(text).not.toContain(displaced);

    const nonCanonical = new TextEncoder().encode(
      text.replace('"activationSequence":"7"', '"activationSequence":"07"'),
    );
    expect(Result.isFailure(
      decodeApplicationTaskRunCreationAuthorityPreimageV1(nonCanonical),
    )).toBe(true);
    const oversized = new Uint8Array(16 * 1_024 * 1_024 + 1);
    Object.defineProperty(oversized, "byteLength", { value: 0 });
    expect(Result.isFailure(
      decodeApplicationTaskRunCreationAuthorityPreimageV1(oversized),
    )).toBe(true);
    const oversizedDecimal = new TextEncoder().encode(
      text.replace('"activationSequence":"7"',
        `"activationSequence":"${"9".repeat(1_000_000)}"`),
    );
    expect(Result.isFailure(
      decodeApplicationTaskRunCreationAuthorityPreimageV1(oversizedDecimal),
    )).toBe(true);
    expect(Result.isFailure(decodeApplicationTaskRunCreationAuthorityV1({
      ...creationAuthority,
      taskDefinitionRevisionId: "legacy",
    }))).toBe(true);
  });

  it("rejects a forged catalog digest before producing bindings", async () => {
    const catalog = await makeCatalog();
    const forged = Object.freeze({
      ...catalog,
      taskCatalogSha256: new Uint8Array(32),
    }) as HashedCanonicalTaskCatalogV1;

    await expect(Effect.runPromise(produceApplicationTaskBindingsV1({
      definition: makeDefinition(),
      catalog: forged,
      authority,
      runtimePolicy,
    }, sha256))).rejects.toMatchObject({
      _tag: "InvalidApplicationTaskBindingV1Error",
      operation: "produce",
      reason: "catalogDigestMismatch",
      path: "catalog",
    });
  });

  it("rejects a task handler that disagrees with the prepared source mapping", async () => {
    const catalog = await makeCatalog("tasks/other.js");

    await expect(Effect.runPromise(produceApplicationTaskBindingsV1({
      definition: makeDefinition(),
      catalog,
      authority,
      runtimePolicy,
    }, sha256))).rejects.toMatchObject({
      _tag: "InvalidApplicationTaskBindingV1Error",
      operation: "produce",
      reason: "handlerMappingMismatch",
      path: "tasks[tasks.orders.process].handler.sourceModulePath",
    });
  });

  it("strictly decodes and snapshots catalog bindings", async () => {
    const catalog = await makeCatalog();
    const digest = catalog.taskCatalogSha256;
    const decoded = Result.getOrThrow(decodeApplicationTaskCatalogBindingV1({
      version: 1,
      ...authority,
      ...runtimePolicy,
      taskCatalogSha256: digest,
      taskCount: 1,
    }));
    digest[0] = digest[0]! ^ 0xff;
    expect(decoded.taskCatalogSha256).not.toBe(digest);
    expect(decoded.taskCatalogSha256[0]).not.toBe(digest[0]);
    expect(Result.isFailure(decodeApplicationTaskCatalogBindingV1({
      ...decoded,
      unexpected: true,
    }))).toBe(true);
    let getterReads = 0;
    const accessor = {
      ...decoded,
      get scopeId() {
        getterReads += 1;
        return authority.scopeId;
      },
    };
    expect(Result.isFailure(
      decodeApplicationTaskCatalogBindingV1(accessor),
    )).toBe(true);
    expect(getterReads).toBe(0);
    const throwingProxy = new Proxy({}, {
      ownKeys() {
        throw new Error("reflection denied");
      },
    });
    expect(Result.isFailure(
      decodeApplicationTaskCatalogBindingV1(throwingProxy),
    )).toBe(true);
    const descriptorProxy = new Proxy(decoded, {
      getOwnPropertyDescriptor() {
        throw new Error("descriptor denied");
      },
    });
    expect(Result.isFailure(
      decodeApplicationTaskCatalogBindingV1(descriptorProxy),
    )).toBe(true);
  });

  it("admits only NUL-free Unicode scalar runtime-host identities", async () => {
    const catalog = await makeCatalog();
    for (const runtimeHostIdentity of ["\0", "\ud800", "\udc00"]) {
      const decoded = decodeApplicationTaskCatalogBindingV1({
        version: 1,
        ...authority,
        ...runtimePolicy,
        runtimeHostIdentity,
        taskCatalogSha256: catalog.taskCatalogSha256,
        taskCount: 1,
      });
      expect(Result.isFailure(decoded)).toBe(true);
      if (Result.isFailure(decoded)) {
        expect(decoded.failure).toMatchObject({
          reason: "invalidRuntimePolicy",
          path: "runtimeHostIdentity",
        });
      }
    }
    expect(Result.isSuccess(decodeApplicationTaskCatalogBindingV1({
      version: 1,
      ...authority,
      ...runtimePolicy,
      runtimeHostIdentity: "application-runtime-\ud83d\ude80",
      taskCatalogSha256: catalog.taskCatalogSha256,
      taskCount: 1,
    }))).toBe(true);
    expect(Result.isSuccess(decodeApplicationTaskCatalogBindingV1({
      version: 1,
      ...authority,
      ...runtimePolicy,
      runtimeHostIdentity: "h".repeat(1_024),
      taskCatalogSha256: catalog.taskCatalogSha256,
      taskCount: 1,
    }))).toBe(true);
    expect(decodeApplicationTaskCatalogBindingV1({
      version: 1,
      ...authority,
      ...runtimePolicy,
      runtimeHostIdentity: "h".repeat(1_025),
      taskCatalogSha256: catalog.taskCatalogSha256,
      taskCount: 1,
    })).toMatchObject({
      _tag: "Failure",
      failure: {
        reason: "invalidRuntimePolicy",
        path: "runtimeHostIdentity",
      },
    });
    expect(decodeApplicationTaskCatalogBindingV1({
      version: 1,
      ...authority,
      ...runtimePolicy,
      scopeId: "scope\0unsafe",
      taskCatalogSha256: catalog.taskCatalogSha256,
      taskCount: 1,
    })).toMatchObject({
      _tag: "Failure",
      failure: {
        reason: "invalidAuthority",
        path: "scopeId",
      },
    });
  });

  it("retains the exact four-digit compatibility-date contract", async () => {
    const catalog = await makeCatalog();
    const input = {
      version: 1,
      ...authority,
      ...runtimePolicy,
      taskCatalogSha256: catalog.taskCatalogSha256,
      taskCount: 1,
    };

    for (const compatibilityDate of [
      "0000-01-01",
      "2000-02-29",
      "2026-08-28",
      "9999-12-31",
    ]) {
      expect(Result.isSuccess(decodeApplicationTaskCatalogBindingV1({
        ...input,
        compatibilityDate,
      }))).toBe(true);
    }

    for (const compatibilityDate of [
      0,
      "2026-8-28",
      "+010000-01-01",
      "2026-02-29",
      "2026-02-30",
      "2026-13-01",
    ]) {
      expect(decodeApplicationTaskCatalogBindingV1({
        ...input,
        compatibilityDate,
      })).toMatchObject({
        _tag: "Failure",
        failure: {
          reason: "invalidRuntimePolicy",
          path: "compatibilityDate",
        },
      });
    }
  });

  it("treats impossible binding digest input failures as defects", async () => {
    const catalog = await makeCatalog();
    const binding = Result.getOrThrow(decodeApplicationTaskCatalogBindingV1({
      version: 1,
      ...authority,
      ...runtimePolicy,
      taskCatalogSha256: catalog.taskCatalogSha256,
      taskCount: 1,
    }));
    expect(findDefect(await Effect.runPromiseExit(
      hashApplicationTaskCatalogBindingV1(binding, invalidInputSha256),
    ))).toMatchObject({
      _tag: "ApplicationTaskBindingSha256InvariantV1Defect",
      operation: "hash_catalog_binding",
      reason: "invalidBytes",
    });
  });

  it("treats impossible catalog rehash input failures as defects", async () => {
    const catalog = await makeCatalog();
    expect(findDefect(await Effect.runPromiseExit(
      produceApplicationTaskBindingsV1({
        definition: makeDefinition(),
        catalog,
        authority,
        runtimePolicy,
      }, invalidInputSha256),
    ))).toMatchObject({
      _tag: "ApplicationTaskBindingSha256InvariantV1Defect",
      operation: "produce",
      reason: "invalidBytes",
    });
  });
});

const invalidInputSha256: StandardApplicationTaskSha256V1 = () =>
  Effect.fail(new StandardApplicationTaskSha256InputV1Error({
    reason: "invalidBytes",
  }));

async function makeCatalog(
  sourceModulePath = "tasks/orders.js",
): Promise<HashedCanonicalTaskCatalogV1> {
  return Effect.runPromise(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: [{
      version: 1,
      taskId: "tasks.orders.process",
      handler: {
        logicalModulePath: "tasks/orders",
        artifactModulePath: sourceModulePath,
        exportName: "run",
      },
      payloadValidator: { type: "any" },
      outputValidator: null,
      runAttemptPolicy: {
        version: 1,
        retry: {
          maxAttempts: 3,
          factor: 2,
          minTimeoutInMs: 1_000,
          maxTimeoutInMs: 60_000,
          randomize: true,
        },
        outOfMemory: { kind: "disabled" },
      },
      maximumDurationInSeconds: 300,
      computeProfile: "standard-1x",
      queue: { kind: "default" },
    }],
  }, sha256));
}

function makeDefinition() {
  return Result.getOrThrow(prepareStandardApplicationDefinitionV1({
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 1,
      maximumIdentifierUtf8Bytes: 1_024,
      maximumValidatorNodes: 32,
      maximumValidatorDepth: 8,
      maximumValidatorStringUtf8Bytes: 1_024,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: { tables: [], indexes: [] },
      modules: [{
        modulePath: "tasks/orders",
        functions: [{
          exportName: "lookup",
          kind: "query",
          visibility: "internal",
          argsValidator: { type: "any" },
          returnsValidator: null,
        }],
      }],
    },
    materializationBudgetInput: {
      maximumModules: 1,
      maximumEntryBindings: 1,
      maximumSourceBytes: 4_096,
      maximumSourceMapBytes: 0,
      maximumBytesMaterialized: 16_384,
      maximumSemanticRecords: 16,
      maximumSemanticRecordBytes: 4_096,
      maximumSemanticStreamBytes: 16_384,
    },
    graphInput: {
      modules: [{
        path: "tasks/orders.js",
        roles: ["function", "execution"],
        sourceBytes: new TextEncoder().encode(
          "export const lookup = () => null; export const run = () => null;\n",
        ),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "tasks/orders",
        artifactModulePath: "tasks/orders.js",
      }],
      executionPath: "tasks/orders.js",
      schemaPath: null,
      authPath: null,
    },
  }));
}

function findDefect(exit: Exit.Exit<unknown, unknown>): unknown {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) throw new Error("Expected defect exit.");
  return Result.getOrThrow(Cause.findDefect(exit.cause));
}
