import { webcrypto } from "node:crypto";
import { canonicalizeApplicationManifestV1 } from
  "@flarex/analysis/application-analysis";
import {
  hashCanonicalTaskCatalogV1,
  makeStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  MAX_APPLICATION_TASK_BINDING_EVIDENCE_BYTES_V1,
  produceApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { prepareStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/v1";
import { Effect, Result } from "effect";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
} from "../src/applicationAnalysisRegistration";
import { makeApplicationPublicationRepository } from
  "../src/applicationPublication";
import {
  createApplicationTaskCatalogSnapshotPort,
  makeApplicationTaskBindingRepository,
} from "../src/applicationTaskBindings";
import { createPGlitePersistence } from "../src/pglite";
import { runEffect } from "./effectTestRuntime";
import {
  insertSessionTestScope,
  SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
} from "./sessionAuthorityTestSupport";

const ROOT = "a".repeat(64);
const SOURCE = "b".repeat(64);
const SCHEMA_SOURCE = "c".repeat(64);
const AUTHORITY: ApplicationAnalysisAuthority = Object.freeze({
  scopeId: ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`),
  storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
  storageGenerationFence: StorageGenerationFenceSchema.make(1n),
  epoch: ScopeEpochSchema.make(`epoch_${SESSION_TEST_EPOCH_UUID}`),
});
const taskSha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application task-binding persistence", () => {
  it("registers a populated catalog and replays it exactly", async () => {
    const fixture = await taskBindingFixture();
    const first = await runEffect(fixture.repository.register(fixture.input));
    const replay = await runEffect(fixture.repository.register(fixture.input));

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      scopeId: AUTHORITY.scopeId,
      taskCount: 1,
      runtimeHostIdentity: "application-runtime-host",
      compatibilityDate: "2026-06-14",
    });
    expect((await fixture.persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_system_application_task_catalog_v1",
    )).rows).toEqual([{ count: "1" }]);
    expect((await fixture.persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_system_application_task_definition_v1",
    )).rows).toEqual([{ count: "1" }]);
  });

  it("returns an owned frozen populated snapshot", async () => {
    const fixture = await taskBindingFixture();
    await runEffect(fixture.repository.register(fixture.input));
    const port = createApplicationTaskCatalogSnapshotPort();
    const load = () => fixture.persistence.drizzle.transaction(tx => runEffect(
      port.loadInTransaction(tx, AUTHORITY, fixture.publication.revisionId),
    ));

    const first = await load();
    if (first === null) throw new Error("Expected task-catalog snapshot.");
    const expectedTaskCatalogSha256 = first.taskCatalogSha256.slice();
    const firstCatalog = first.readTaskCatalog();
    const expectedManifestSha256 =
      firstCatalog.entries[0]?.canonicalTaskManifestSha256.slice();

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(firstCatalog)).toBe(true);
    expect(Object.isFrozen(firstCatalog.entries)).toBe(true);
    first.taskCatalogSha256.fill(0);
    firstCatalog.taskCatalogSha256.fill(0);
    firstCatalog.entries[0]?.canonicalTaskManifestSha256.fill(0);

    const second = await load();
    if (second === null) {
      throw new Error("Expected replayed task-catalog snapshot.");
    }
    expect(second.taskCatalogSha256).toEqual(expectedTaskCatalogSha256);
    expect(second.taskCatalogSha256).not.toBe(first.taskCatalogSha256);
    const secondCatalog = second.readTaskCatalog();
    expect(secondCatalog.taskCatalogSha256).toEqual(expectedTaskCatalogSha256);
    expect(secondCatalog.entries[0]?.canonicalTaskManifestSha256)
      .toEqual(expectedManifestSha256);
    expect(secondCatalog).not.toBe(firstCatalog);
  });

  it("converges concurrent exact registration", async () => {
    const fixture = await taskBindingFixture();
    const registrations = await Promise.all([
      runEffect(fixture.repository.register(fixture.input)),
      runEffect(fixture.repository.register(fixture.input)),
    ]);

    expect(registrations[1]).toEqual(registrations[0]);
    expect((await taskBindingCounts(fixture.persistence))).toEqual({
      catalogs: "1",
      definitions: "1",
    });
  });

  it("replays a collation-sensitive multi-task catalog by exact task ID", async () => {
    const fixture = await taskBindingFixture();
    const bindings = await makeBindings(
      fixture.publication,
      false,
      "application-runtime-host",
      ["tasks.Zebra", "tasks.apple", "tasks.\u00e9clair", "tasks.\u00c1lpha"],
    );
    const input = Object.freeze({ authority: AUTHORITY, bindings });
    const first = await runEffect(fixture.repository.register(input));
    const replay = await runEffect(fixture.repository.register(input));

    expect(replay).toEqual(first);
    expect(replay.taskCount).toBe(4);
    expect((await taskBindingCounts(fixture.persistence))).toEqual({
      catalogs: "1",
      definitions: "4",
    });
  });

  it("serializes competing registration to one exact winner", async () => {
    const fixture = await taskBindingFixture();
    const competing = await makeBindings(
      fixture.publication,
      false,
      "competing-runtime-host",
    );
    const outcomes = await Promise.all([
      runEffect(Effect.result(fixture.repository.register(fixture.input))),
      runEffect(Effect.result(fixture.repository.register({
        authority: AUTHORITY,
        bindings: competing,
      }))),
    ]);

    expect(outcomes.filter(Result.isSuccess)).toHaveLength(1);
    const failures = outcomes.filter(Result.isFailure);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.failure.reason).toBe("conflictingReplay");
    expect((await taskBindingCounts(fixture.persistence))).toEqual({
      catalogs: "1",
      definitions: "1",
    });
  });

  it("persists an explicit empty catalog header without child rows", async () => {
    const fixture = await taskBindingFixture(true);
    const registered = await runEffect(
      fixture.repository.register(fixture.input),
    );

    expect(registered.taskCount).toBe(0);
    expect((await fixture.persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_system_application_task_catalog_v1",
    )).rows).toEqual([{ count: "1" }]);
    expect((await fixture.persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_system_application_task_definition_v1",
    )).rows).toEqual([{ count: "0" }]);
  });

  it("rejects a conflicting runtime-policy replay", async () => {
    const fixture = await taskBindingFixture();
    await runEffect(fixture.repository.register(fixture.input));
    const conflictingBindings = await makeBindings(
      fixture.publication,
      false,
      "other-runtime-host",
    );
    const conflict = await runEffect(Effect.result(
      fixture.repository.register({
        authority: AUTHORITY,
        bindings: conflictingBindings,
      }),
    ));

    expect(Result.isFailure(conflict)).toBe(true);
    if (Result.isFailure(conflict)) {
      expect(conflict.failure.reason).toBe("conflictingReplay");
    }
  });

  it("rejects replay after stored child evidence is corrupted", async () => {
    const fixture = await taskBindingFixture();
    await runEffect(fixture.repository.register(fixture.input));
    await fixture.persistence.query(
      "update fx_system_application_task_definition_v1 set binding_bytes = $1 where scope_id = $2",
      [new Uint8Array([1]), AUTHORITY.scopeId],
    );
    const replay = await runEffect(Effect.result(
      fixture.repository.register(fixture.input),
    ));

    expect(Result.isFailure(replay)).toBe(true);
    if (Result.isFailure(replay)) {
      expect(replay.failure.reason).toBe("conflictingReplay");
    }
  });

  it("rejects stale authority and a fresh caller for the stale candidate", async () => {
    const fixture = await taskBindingFixture();
    await fixture.persistence.query(
      "update fx_system_scope_clock set storage_generation_fence = 2 where scope_id = $1",
      [AUTHORITY.scopeId],
    );
    const stale = await runEffect(Effect.result(
      fixture.repository.register(fixture.input),
    ));
    const freshAuthority: ApplicationAnalysisAuthority = Object.freeze({
      ...AUTHORITY,
      storageGenerationFence: StorageGenerationFenceSchema.make(2n),
    });
    const fresh = await runEffect(Effect.result(
      fixture.repository.register({
        ...fixture.input,
        authority: freshAuthority,
      }),
    ));

    for (const result of [stale, fresh]) {
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("authorityChanged");
      }
    }
  });

  it("revalidates caller-owned canonical bytes before opening a transaction", async () => {
    const fixture = await taskBindingFixture();
    const firstByte = fixture.input.bindings.catalog.canonicalBytes[0];
    if (firstByte === undefined) throw new Error("Expected catalog bytes.");
    fixture.input.bindings.catalog.canonicalBytes[0] = firstByte ^ 0xff;
    const result = await runEffect(Effect.result(
      fixture.repository.register(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe("invalidInput");
    }
    expect((await fixture.persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_system_application_task_catalog_v1",
    )).rows).toEqual([{ count: "0" }]);
  });

  it("rejects non-exact and detached wrapper evidence before SHA", async () => {
    const fixture = await taskBindingFixture();
    const definition = fixture.input.bindings.definitions[0];
    if (definition === undefined) throw new Error("Expected task definition.");
    const overCountBindings = Object.freeze({
      ...fixture.input.bindings,
      definitions: Object.freeze([definition, definition]),
    });
    const sparseDefinitions = new Array<typeof definition>(1);
    const sparseBindings = Object.freeze({
      ...fixture.input.bindings,
      definitions: Object.freeze(sparseDefinitions),
    });
    const decoratedDefinitions = [definition];
    Object.defineProperty(decoratedDefinitions, "ignored", {
      enumerable: true,
      value: definition,
    });
    const decoratedBindings = Object.freeze({
      ...fixture.input.bindings,
      definitions: Object.freeze(decoratedDefinitions),
    });
    let accessorReads = 0;
    const accessorDefinitions = new Array<typeof definition>(1);
    Object.defineProperty(accessorDefinitions, "0", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return definition;
      },
    });
    const accessorBindings = Object.freeze({
      ...fixture.input.bindings,
      definitions: Object.freeze(accessorDefinitions),
    });
    const detachedBuffer = new ArrayBuffer(1);
    const detachedBytes = new Uint8Array(detachedBuffer);
    structuredClone(detachedBuffer, { transfer: [detachedBuffer] });
    const detachedBindings = Object.freeze({
      ...fixture.input.bindings,
      catalog: Object.freeze({
        ...fixture.input.bindings.catalog,
        canonicalBytes: detachedBytes,
      }),
    });
    let digestCalls = 0;
    const subtle = {
      digest(): Promise<ArrayBuffer> {
        digestCalls += 1;
        return Promise.resolve(new ArrayBuffer(32));
      },
    };
    vi.stubGlobal("crypto", { subtle });
    try {
      for (const bindings of [
        overCountBindings,
        sparseBindings,
        decoratedBindings,
        accessorBindings,
        detachedBindings,
      ]) {
        const result = await runEffect(Effect.result(
          fixture.repository.register({ authority: AUTHORITY, bindings }),
        ));
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("invalidInput");
        }
      }
      expect(accessorReads).toBe(0);
      expect(digestCalls).toBe(0);
      expect((await taskBindingCounts(fixture.persistence))).toEqual({
        catalogs: "0",
        definitions: "0",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects resizable byte views before a nested Proxy can grow them", async () => {
    const fixture = await taskBindingFixture();
    const definition = fixture.input.bindings.definitions[0];
    if (definition === undefined) throw new Error("Expected task definition.");
    const resizableBuffer = Reflect.construct(ArrayBuffer, [
      1,
      { maxByteLength: 1_024 },
    ]);
    if (!(resizableBuffer instanceof ArrayBuffer)) {
      throw new Error("Expected resizable ArrayBuffer.");
    }
    const resize = Reflect.get(resizableBuffer, "resize");
    if (typeof resize !== "function") {
      throw new Error("Resizable ArrayBuffer support is required.");
    }
    const lengthTrackingBytes = new Uint8Array(resizableBuffer);
    let resizeCalls = 0;
    const resizingBinding = new Proxy(definition.binding, {
      ownKeys(target) {
        resizeCalls += 1;
        Reflect.apply(resize, resizableBuffer, [100]);
        return Reflect.ownKeys(target);
      },
    });
    const bindings = Object.freeze({
      ...fixture.input.bindings,
      definitions: Object.freeze([Object.freeze({
        ...definition,
        binding: resizingBinding,
        canonicalManifestBytes: lengthTrackingBytes,
      })]),
    });
    let digestCalls = 0;
    const subtle = {
      digest(): Promise<ArrayBuffer> {
        digestCalls += 1;
        return Promise.resolve(new ArrayBuffer(32));
      },
    };
    vi.stubGlobal("crypto", { subtle });
    try {
      const result = await runEffect(Effect.result(
        fixture.repository.register({ authority: AUTHORITY, bindings }),
      ));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("invalidInput");
      }
      expect(resizeCalls).toBe(0);
      expect(digestCalls).toBe(0);
      expect((await taskBindingCounts(fixture.persistence))).toEqual({
        catalogs: "0",
        definitions: "0",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("enforces the aggregate evidence-byte budget before SHA", async () => {
    const fixture = await taskBindingFixture();
    const bindings = await makeBindings(
      fixture.publication,
      false,
      "application-runtime-host",
      ["tasks.aggregate.a", "tasks.aggregate.b"],
    );
    const fixedByteLength = bindings.catalog.canonicalBytes.byteLength +
      bindings.definitions.reduce(
        (total, definition) => total + definition.canonicalBytes.byteLength,
        0,
      );
    const manifestBudget =
      MAX_APPLICATION_TASK_BINDING_EVIDENCE_BYTES_V1 - fixedByteLength;
    const firstManifestByteLength = Math.floor(manifestBudget / 2);
    const secondManifestByteLength = manifestBudget - firstManifestByteLength;
    const resizeManifests = (lengths: readonly [number, number]) =>
      Object.freeze({
        ...bindings,
        definitions: Object.freeze(bindings.definitions.map(
          (definition, index) => {
            const byteLength = lengths[index];
            if (byteLength === undefined) {
              throw new Error("Expected aggregate manifest length.");
            }
            return Object.freeze({
              ...definition,
              canonicalManifestBytes: new Uint8Array(byteLength),
            });
          },
        )),
      });
    const exact = resizeManifests([
      firstManifestByteLength,
      secondManifestByteLength,
    ]);
    const over = resizeManifests([
      firstManifestByteLength,
      secondManifestByteLength + 1,
    ]);
    const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
    let digestCalls = 0;
    const subtle = {
      digest(
        this: unknown,
        algorithm: AlgorithmIdentifier,
        data: BufferSource,
      ): Promise<ArrayBuffer> {
        digestCalls += 1;
        return nativeDigest(algorithm, data);
      },
    };
    vi.stubGlobal("crypto", { subtle });
    try {
      const overResult = await runEffect(Effect.result(
        fixture.repository.register({ authority: AUTHORITY, bindings: over }),
      ));
      expect(Result.isFailure(overResult)).toBe(true);
      if (Result.isFailure(overResult)) {
        expect(overResult.failure.reason).toBe("invalidInput");
      }
      expect(digestCalls).toBe(0);

      const exactResult = await runEffect(Effect.result(
        fixture.repository.register({ authority: AUTHORITY, bindings: exact }),
      ));
      expect(Result.isFailure(exactResult)).toBe(true);
      if (Result.isFailure(exactResult)) {
        expect(exactResult.failure.reason).toBe("invalidInput");
      }
      expect(digestCalls).toBeGreaterThan(0);
      expect((await taskBindingCounts(fixture.persistence))).toEqual({
        catalogs: "0",
        definitions: "0",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("owns validated binding scalars before asynchronous hashing", async () => {
    const fixture = await taskBindingFixture();
    const mutableBinding = {
      ...fixture.input.bindings.catalog.binding,
    };
    const bindings = Object.freeze({
      ...fixture.input.bindings,
      catalog: Object.freeze({
        ...fixture.input.bindings.catalog,
        binding: mutableBinding,
      }),
    });
    const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
    let digestStarted!: () => void;
    const digestStartedPromise = new Promise<void>(resolve => {
      digestStarted = resolve;
    });
    let releaseDigest!: () => void;
    const digestReleasePromise = new Promise<void>(resolve => {
      releaseDigest = resolve;
    });
    let digestCalls = 0;
    const subtle = {
      digest(
        this: unknown,
        algorithm: AlgorithmIdentifier,
        data: BufferSource,
      ): Promise<ArrayBuffer> {
        digestCalls += 1;
        if (digestCalls !== 1) return nativeDigest(algorithm, data);
        digestStarted();
        return digestReleasePromise.then(() => nativeDigest(algorithm, data));
      },
    };
    vi.stubGlobal("crypto", { subtle });
    try {
      const pending = runEffect(fixture.repository.register({
        authority: AUTHORITY,
        bindings,
      }));
      await digestStartedPromise;
      mutableBinding.runtimeHostIdentity = "mutated-after-validation";
      releaseDigest();
      const registered = await pending;

      expect(registered.runtimeHostIdentity).toBe("application-runtime-host");
      expect((await fixture.persistence.query<{
        runtimeHostIdentity: string;
      }>(`
        select runtime_host_identity as "runtimeHostIdentity"
        from fx_system_application_task_catalog_v1
      `)).rows).toEqual([{
        runtimeHostIdentity: "application-runtime-host",
      }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects database-unsafe runtime-host text before persistence", async () => {
    const fixture = await taskBindingFixture();
    for (const runtimeHostIdentity of ["\0", "\ud800", "\udc00"]) {
      const result = await runEffect(Effect.result(
        fixture.repository.register({
          authority: AUTHORITY,
          bindings: Object.freeze({
            ...fixture.input.bindings,
            catalog: Object.freeze({
              ...fixture.input.bindings.catalog,
              binding: Object.freeze({
                ...fixture.input.bindings.catalog.binding,
                runtimeHostIdentity,
              }),
            }),
          }),
        }),
      ));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("invalidInput");
      }
    }
    expect((await taskBindingCounts(fixture.persistence))).toEqual({
      catalogs: "0",
      definitions: "0",
    });
  });

  it("rolls back the catalog header when child insertion fails", async () => {
    const fixture = await taskBindingFixture();
    await fixture.persistence.query(`
      alter table fx_system_application_task_definition_v1
      add constraint test_force_task_child_failure check (false) not valid
    `);
    const result = await runEffect(Effect.result(
      fixture.repository.register(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe("resourceFailure");
    }
    expect((await taskBindingCounts(fixture.persistence))).toEqual({
      catalogs: "0",
      definitions: "0",
    });
  });
});

async function taskBindingCounts(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
): Promise<Readonly<{ readonly catalogs: string; readonly definitions: string }>> {
  const rows = await persistence.query<{
    catalogs: string;
    definitions: string;
  }>(`
    select
      (select count(*)::text from fx_system_application_task_catalog_v1)
        as catalogs,
      (select count(*)::text from fx_system_application_task_definition_v1)
        as definitions
  `);
  const row = rows.rows[0];
  if (row === undefined) throw new Error("Expected task-binding counts.");
  return Object.freeze({ ...row });
}

async function taskBindingFixture(empty = false) {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await insertSessionTestScope(persistence);
  const identities = [
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002",
    "20000000-0000-4000-8000-000000000003",
  ];
  let identityIndex = 0;
  const analyses = makeApplicationAnalysisRepository(persistence.drizzle, {
    randomUuid: () => {
      const identity = identities[identityIndex];
      if (identity === undefined) throw new Error("Identity fixture exhausted.");
      identityIndex += 1;
      return identity;
    },
  });
  const pending = await runEffect(analyses.begin({
    authority: AUTHORITY,
    requestKey: "request:application-task-binding:1",
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: "analyzer-1",
    analyzerPolicyIdentity: "policy-1",
  }));
  const canonical = canonicalManifest();
  const analyzed = await runEffect(analyses.settle(AUTHORITY, {
    kind: "analyzed",
    candidateId: pending.candidateId,
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: "analyzer-1",
    analyzerPolicyIdentity: "policy-1",
    canonicalManifest: canonical.canonicalText,
  }));
  if (analyzed.status !== "analyzed") {
    throw new Error("Expected analyzed task-binding fixture.");
  }
  const publication = await runEffect(
    makeApplicationPublicationRepository(persistence.drizzle).publish({
      authority: AUTHORITY,
      revisionId: analyzed.revision.revisionId,
      candidateId: analyzed.candidateId,
      analysisId: analyzed.analysisId,
      manifestSha256: analyzed.manifestSha256,
      manifest: analyzed.manifest,
    }),
  );
  return Object.freeze({
    persistence,
    publication,
    repository: makeApplicationTaskBindingRepository(persistence.drizzle),
    input: Object.freeze({
      authority: AUTHORITY,
      bindings: await makeBindings(publication, empty),
    }),
  });
}

async function makeBindings(
  publication: Readonly<{
    readonly scopeId: typeof AUTHORITY.scopeId;
    readonly revisionId: string;
    readonly candidateId: string;
    readonly analysisId: string;
    readonly sourceArtifactRootSha256: string;
    readonly publicationSha256: string;
  }>,
  empty: boolean,
  runtimeHostIdentity = "application-runtime-host",
  taskIds: ReadonlyArray<string> = empty ? [] : ["tasks.orders.process"],
) {
  const catalog = await runEffect(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: taskIds.map(taskId => taskManifest(taskId)),
  }, taskSha256));
  return runEffect(produceApplicationTaskBindingsV1({
    definition: preparedDefinition(),
    catalog,
    authority: {
      scopeId: publication.scopeId,
      revisionId: publication.revisionId,
      candidateId: publication.candidateId,
      analysisId: publication.analysisId,
      sourceArtifactRootSha256: publication.sourceArtifactRootSha256,
      publicationSha256: publication.publicationSha256,
    },
    runtimePolicy: {
      runtimeHostIdentity,
      compatibilityDate: "2026-06-14",
    },
  }, taskSha256));
}

function taskManifest(taskId = "tasks.orders.process") {
  return {
    version: 1,
    taskId,
    handler: {
      logicalModulePath: "tasks/orders",
      artifactModulePath: "tasks/orders.js",
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
  };
}

function preparedDefinition() {
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

function canonicalManifest() {
  return Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: "flarex.application-manifest",
    version: 1,
    sourceArtifact: {
      rootSha256: ROOT,
      executionModulePath: "_flarex/application.js",
      schemaModulePath: "_flarex/schema.js",
      modules: [{
        path: "_flarex/application.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: SOURCE,
        sourceByteLength: 128,
      }, {
        path: "_flarex/schema.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
        sourceSha256: SCHEMA_SOURCE,
        sourceByteLength: 128,
      }],
    },
    schema: { version: 1, tables: [], indexes: [] },
    functions: [],
  }));
}
