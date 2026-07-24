import { execFileSync } from "node:child_process";

import { Effect } from "effect";
import {
  executionArtifactSourcePackageKey,
  executionArtifactRefForSourcePackage,
  type ExecutionArtifactRef,
} from "flarex/artifacts";
import {
  decodePointMutationExactRuntimeRequestV1Effect,
  POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1,
  POINT_MUTATION_EXACT_RUNTIME_FORMAT_V1,
  POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
  type PointMutationExactRuntimeArtifactRefV1,
  type PointMutationExactRuntimeRequestV1,
} from "flarex-protocol/point-mutation-exact-runtime";
import {
  requirePointMutationArgumentSemanticSizeV1,
} from "flarex-protocol/point-mutation-start";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  R2BackendExecutionArtifactStore,
  type BackendExecutionArtifactStore,
  type R2BucketLike,
} from "../src/artifactStore";
import {
  loadPointMutationExactRuntimeWorkerDefinitionV1Effect,
  POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1,
  POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
  POINT_MUTATION_EXACT_RUNTIME_MAIN_MODULE_V1,
  PointMutationExactRuntimeHostV1Error,
  pointMutationExactRuntimeWorkerCodeIdentityV1,
  pointMutationExactRuntimeWorkerSource,
} from "../src/artifactRuntime";
import {
  POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SHA256_V1,
  POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
} from "../src/artifactRuntime/PointMutationExactRuntimeWorkerCore.generated";
import type { PushSourcePackage } from "../src/types";
import { sourceModuleSha256ForTest } from "./sourcePackageHashFixture";

const testOrderId = "1:11111111-1111-1111-1111-111111111111";
const testInsertedOrderId = "1:22222222-2222-2222-2222-222222222222";

describe("point mutation exact-runtime Dynamic Worker host", () => {
  const orderId = testOrderId;
  const insertedOrderId = testInsertedOrderId;

  it("generates a named RPC-only exact mutation entrypoint", () => {
    const source = testExactRuntimeWorkerSource();

    expect(source).toContain(
      `export class ${POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1} extends WorkerEntrypoint`,
    );
    expect(source).toContain("async run(input, journal)");
    expect(source).toContain("journal.resolvePointTable(name)");
    expect(source).toContain("table.runPointOperation");
    expect(source).not.toContain("globalOutbound");
    expect(source).not.toContain("FLAREX_EXECUTOR");
    expect(source).not.toContain("/invoke/start");
    expect(source).not.toContain("/invoke/syscall");
    expect(source).not.toContain("/invoke/finish");
    expect(source).not.toContain("/invoke/abort");
    expect(source).not.toContain("async fetch(");
    expect(source).not.toContain("Bearer ");

    expect(() => new Function(executableGeneratedSource(source, false)))
      .not.toThrow();
  });

  it("routes exact mutation database calls through nested table capabilities", async () => {
    const calls: Array<Readonly<{
      readonly table: string;
      readonly operation: Readonly<Record<string, unknown>>;
    }>> = [];
    const request = await exactRequest(testArtifact());
    const handler = vi.fn(async (ctx: ExactTestContext, args: unknown) => {
      const identity = await ctx.auth.getUserIdentity();
      expect(identity).toEqual({
        tokenIdentifier: "token-1",
        issuer: "https://auth.example.com",
        subject: "user-1",
        email: "user@example.com",
        emailVerified: true,
        role: "admin",
      });
      if (identity === null) throw new Error("Expected test user identity.");
      expect(Object.keys(identity)).toEqual([
        "tokenIdentifier",
        "issuer",
        "subject",
        "email",
        "emailVerified",
        "role",
      ]);
      expect(args).toEqual({ orderId });
      const get = ctx.db.get(orderId);
      const insertFields = { status: "new" };
      const insert = ctx.db.insert("orders", insertFields);
      insertFields.status = "mutated-after-call";
      expect(await get).toEqual({
        _id: orderId,
        _creationTime: 100,
        status: "open",
      });
      expect(await insert).toBe(insertedOrderId);
      const patchFields = { status: "done" };
      const patch = ctx.db.patch(orderId, patchFields);
      patchFields.status = "mutated-after-call";
      await patch;
      await ctx.db.replace(orderId, { status: "replaced" });
      void ctx.db.delete(orderId);
      return { ok: true };
    });
    const Runtime = generatedRuntimeClass(
      testExactRuntimeWorkerSource(),
      Object.freeze({
        isMutation: true,
        isPublic: true,
        _handler: handler,
      }),
    );
    const runtime = new Runtime();
    let tableResolutionCount = 0;
    const journal = {
      resolvePointTable: async (table: string) => {
        tableResolutionCount += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        return {
          runPointOperation: async (
            operation: Readonly<Record<string, unknown>>,
          ) => {
            calls.push({ table, operation });
            switch (operation.kind) {
              case "get":
                return {
                  kind: "present",
                  document: {
                    _id: orderId,
                    _creationTime: 100,
                    status: "open",
                  },
                };
              case "insert":
                return {
                  kind: "inserted",
                  documentId: insertedOrderId,
                  document: {
                    _id: insertedOrderId,
                    _creationTime: 100,
                    status: "new",
                  },
                };
              case "patch":
              case "replace":
              case "delete":
                if (operation.kind === "delete") {
                  await new Promise<void>((resolve) =>
                    setTimeout(resolve, 5)
                  );
                }
                return { kind: "unit", operation: operation.kind };
              default:
                throw new Error("Unexpected test journal operation.");
            }
          },
        };
      },
    };

    await expect(runtime.run(request, journal)).resolves.toEqual({
      format: POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
      version: 1,
      value: { ok: true },
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(tableResolutionCount).toBe(1);
    expect(calls[1]?.operation.fields).toEqual({ status: "new" });
    expect(calls[2]?.operation.patch).toEqual({ status: "done" });
    expect(calls.map((call) => [
      call.table,
      call.operation.kind,
      call.operation.syscallSequence,
    ])).toEqual([
      ["orders", "get", 1n],
      ["orders", "insert", 2n],
      ["orders", "patch", 3n],
      ["orders", "replace", 4n],
      ["orders", "delete", 5n],
    ]);
  });

  it("disposes every received journal stub after the exact call settles", async () => {
    const request = await exactRequest(testArtifact());
    const invalidRequestDispose = vi.fn(() => {
      throw new Error("cleanup must not replace request decoding");
    });
    const InvalidRequestRuntime = generatedRuntimeClass(
      testExactRuntimeWorkerSource(),
      Object.freeze({}),
    );
    await expect(new InvalidRequestRuntime().run(
      { ...request, version: 2 },
      {
        resolvePointTable: () =>
          Promise.reject(new Error("journal must not run")),
        [Symbol.dispose]: invalidRequestDispose,
      },
    )).rejects.toThrow(
      "Unsupported exact-runtime protocol format or version.",
    );
    expect(invalidRequestDispose).toHaveBeenCalledOnce();

    const invalidJournalDispose = vi.fn();
    const InvalidJournalRuntime = generatedRuntimeClass(
      testExactRuntimeWorkerSource(),
      Object.freeze({}),
    );
    await expect(new InvalidJournalRuntime().run(request, {
      [Symbol.dispose]: invalidJournalDispose,
    })).rejects.toThrow(
      "Exact-runtime journal RPC capability is unavailable.",
    );
    expect(invalidJournalDispose).toHaveBeenCalledOnce();

    const tableDispose = vi.fn();
    const parentDispose = vi.fn();
    const Runtime = generatedRuntimeClass(
      testExactRuntimeWorkerSource(),
      Object.freeze({
        isMutation: true,
        isPublic: true,
        _handler: (ctx: ExactTestContext) => ctx.db.get(orderId),
      }),
    );

    await expect(new Runtime().run(request, {
      resolvePointTable: async () => ({
        runPointOperation: async () => ({
          kind: "missing",
          document: null,
        }),
        [Symbol.dispose]: tableDispose,
      }),
      [Symbol.dispose]: parentDispose,
    })).resolves.toMatchObject({
      value: null,
    });
    expect(tableDispose).toHaveBeenCalledOnce();
    expect(parentDispose).toHaveBeenCalledOnce();

    const failingParentDispose = vi.fn();
    const failingRuntime = generatedRuntimeClass(
      testExactRuntimeWorkerSource(),
      Object.freeze({}),
    );
    await expect(new failingRuntime().run(request, {
      resolvePointTable: () => {
        throw new Error("journal must not run");
      },
      [Symbol.dispose]: failingParentDispose,
    })).rejects.toThrow(
      "Exact-runtime target must be exactly one public mutation.",
    );
    expect(failingParentDispose).toHaveBeenCalledOnce();

    const cleanupFailure = new Error("table disposal failed");
    const cleanupRuntime = generatedRuntimeClass(
      testExactRuntimeWorkerSource(),
      Object.freeze({
        isMutation: true,
        isPublic: true,
        _handler: (ctx: ExactTestContext) => ctx.db.get(orderId),
      }),
    );
    await expect(new cleanupRuntime().run(request, {
      resolvePointTable: async () => ({
        runPointOperation: async () => ({
          kind: "missing",
          document: null,
        }),
        [Symbol.dispose]: () => {
          throw cleanupFailure;
        },
      }),
      [Symbol.dispose]: vi.fn(),
    })).rejects.toMatchObject({
      name: "PointMutationExactRuntimeJournalBoundaryV1Error",
      cause: cleanupFailure,
    });
  });

  it("runs with fixed time, seeded randomness, hardened intrinsics, and fresh one-shot state", () => {
    const first = runGeneratedRuntimeInFreshProcess(5);
    const replay = runGeneratedRuntimeInFreshProcess(5);
    const differentSeed = runGeneratedRuntimeInFreshProcess(6);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      first: {
        value: {
          firstNow: 100,
          secondNow: 100,
          dateNow: 100,
          performanceNow: 0,
          cryptoRandomBlocked: true,
          cryptoSubtleBlocked: true,
          cachesBlocked: true,
          datePrototypeConstructorNow: 100,
          cryptoPrototypeNull: true,
          subtlePrototypeNull: true,
          cachesPrototypeNull: true,
          defaultCachePrototypeNull: true,
          performancePrototypeNull: true,
          timersBlocked: true,
          abortTimeoutBlocked: true,
          inheritedTimerBlocked: true,
          messageChannelBlocked: true,
          webAssemblyAsyncBlocked: true,
          fetchBlocked: true,
          implicitIntlTimeBlocked: true,
          explicitIntlTime: true,
          tamperBlocked: true,
          got: {
            _id: orderId,
            _creationTime: 100,
            status: "open",
          },
          inserted: insertedOrderId,
        },
      },
      secondFailure: "Error",
      sequences: ["1", "2"],
      capturedInsertStatus: "new",
    });
    expect(differentSeed.first.value.randomValues).not.toEqual(
      first.first.value.randomValues,
    );
  });

  it("fails closed when an ignored journal operation rejects", async () => {
    const request = await exactRequest(testArtifact());
    const handler = vi.fn((ctx: ExactTestContext) => {
      void ctx.db.delete(orderId);
      void ctx.db.patch(orderId, { status: "must-not-run" });
      return { ok: true };
    });
    const Runtime = generatedRuntimeClass(
      testExactRuntimeWorkerSource(),
      Object.freeze({
        isMutation: true,
        isPublic: true,
        _handler: handler,
      }),
    );
    const operations: Array<Readonly<Record<string, unknown>>> = [];
    const journal = {
      resolvePointTable: async () => ({
        runPointOperation: async (
          operation: Readonly<Record<string, unknown>>,
        ) => {
          operations.push(operation);
          throw new Error("journal RPC unavailable");
        },
      }),
    };

    await expect(new Runtime().run(request, journal)).rejects.toMatchObject({
      name: "PointMutationExactRuntimeJournalBoundaryV1Error",
      cause: expect.any(Error),
    });
    expect(operations.map((operation) => [
      operation.kind,
      operation.syscallSequence,
    ])).toEqual([["delete", 1n]]);
  });

  it("rejects database work queued after handler settlement", async () => {
    const request = await exactRequest(testArtifact());
    const handler = vi.fn((ctx: ExactTestContext) => {
      queueMicrotask(() => {
        queueMicrotask(() => {
          try {
            void ctx.db.insert("orders", { status: "late" });
          } catch {
            // The runtime still owns and reports this boundary failure.
          }
        });
      });
      return { ok: true };
    });
    const Runtime = generatedRuntimeClass(
      testExactRuntimeWorkerSource(),
      Object.freeze({
        isMutation: true,
        isPublic: true,
        _handler: handler,
      }),
    );
    const runPointOperation = vi.fn(() =>
      Promise.reject(new Error("late operation must not reach the journal"))
    );

    await expect(new Runtime().run(request, {
      resolvePointTable: async () => ({ runPointOperation }),
    })).rejects.toMatchObject({
      name: "PointMutationExactRuntimeJournalBoundaryV1Error",
    });
    expect(runPointOperation).not.toHaveBeenCalled();
  });

  it("classifies malformed journal outcomes as host-boundary failures", async () => {
    const request = await exactRequest(testArtifact());
    for (const document of [
      "not-an-app-document",
      { _id: orderId },
      { _id: orderId, _creationTime: 0 },
      {
        _id: "1:33333333-3333-3333-3333-333333333333",
        _creationTime: 100,
      },
      {
        _id: "2:11111111-1111-1111-1111-111111111111",
        _creationTime: 100,
      },
    ]) {
      const Runtime = generatedRuntimeClass(
        testExactRuntimeWorkerSource(),
        Object.freeze({
          isMutation: true,
          isPublic: true,
          _handler: (ctx: ExactTestContext) => ctx.db.get(orderId),
        }),
      );

      await expect(new Runtime().run(request, {
        resolvePointTable: async () => ({
          runPointOperation: async () => ({
            kind: "present",
            document,
          }),
        }),
      })).rejects.toMatchObject({
        name: "PointMutationExactRuntimeJournalBoundaryV1Error",
        cause: expect.any(Error),
      });
    }
  });

  it("classifies user-module evaluation rejection as user code", async () => {
    const request = await exactRequest(testArtifact());
    const source = testExactRuntimeWorkerSource().replace(
      /const executionModulePromise = import\([^;]+;/,
      'const executionModulePromise = Promise.reject(new Error("module failed"));',
    );
    const Runtime = generatedRuntimeClass(source, Object.freeze({}));

    await expect(new Runtime().run(request, {
      resolvePointTable: () => {
        throw new Error("journal must not be invoked");
      },
    })).rejects.toMatchObject({
      name: "PointMutationExactRuntimeUserCodeV1Error",
      cause: expect.objectContaining({ message: "module failed" }),
    });
  });

  it("rejects unsafe writes before invoking the journal capability", async () => {
    const request = await exactRequest(testArtifact());
    const resolvePointTable = vi.fn(() =>
      Promise.reject(new Error("journal must not be invoked"))
    );
    let getterCalls = 0;
    const accessorFields = Object.defineProperty({}, "status", {
      enumerable: true,
      get(): string {
        getterCalls += 1;
        return "unsafe";
      },
    });
    const accessorRuntime = generatedRuntimeClass(
      testExactRuntimeWorkerSource(),
      Object.freeze({
        isMutation: true,
        isPublic: true,
        _handler: (ctx: ExactTestContext) =>
          ctx.db.insert("orders", accessorFields),
      }),
    );

    await expect(
      new accessorRuntime().run(request, { resolvePointTable }),
    ).rejects.toMatchObject({
      name: "PointMutationExactRuntimeUserCodeV1Error",
    });
    expect(getterCalls).toBe(0);
    expect(resolvePointTable).not.toHaveBeenCalled();

    const oversizedRuntime = generatedRuntimeClass(
      testExactRuntimeWorkerSource(),
      Object.freeze({
        isMutation: true,
        isPublic: true,
        _handler: (ctx: ExactTestContext) =>
          ctx.db.insert("orders", { body: "x".repeat(1 << 20) }),
      }),
    );
    await expect(
      new oversizedRuntime().run(request, { resolvePointTable }),
    ).rejects.toMatchObject({
      name: "PointMutationExactRuntimeUserCodeV1Error",
    });
    expect(resolvePointTable).not.toHaveBeenCalled();
  });

  it("matches protocol object-field rules in the generated runtime", async () => {
    const request = await exactRequest(testArtifact());
    const journal = {
      resolvePointTable: () =>
        Promise.reject(new Error("journal must not be invoked")),
    };
    for (const invalidResult of [
      { $reserved: true },
      { "non-ascii-é": true },
      { "control-\u001f": true },
    ]) {
      const Runtime = generatedRuntimeClass(
        testExactRuntimeWorkerSource(),
        Object.freeze({
          isMutation: true,
          isPublic: true,
          _handler: () => invalidResult,
        }),
      );
      await expect(new Runtime().run(request, journal)).rejects.toMatchObject({
        name: "PointMutationExactRuntimeUserCodeV1Error",
      });
    }
  });

  it("rejects request pins that do not match the loaded source package", async () => {
    const loadedArtifact = testArtifact();
    const request = await exactRequest({
      ...loadedArtifact,
      artifactId: `artifact_${"b".repeat(32)}`,
      sourcePackageHash: "b".repeat(64),
    });
    const handler = vi.fn(() => ({ ok: true }));
    const Runtime = generatedRuntimeClass(
      testExactRuntimeWorkerSource(),
      Object.freeze({
        isMutation: true,
        isPublic: true,
        _handler: handler,
      }),
    );
    const resolvePointTable = vi.fn(() =>
      Promise.reject(new Error("journal must not be invoked"))
    );

    await expect(
      new Runtime().run(request, { resolvePointTable }),
    ).rejects.toThrow("Invalid exact-runtime artifact pin.");
    expect(handler).not.toHaveBeenCalled();
    expect(resolvePointTable).not.toHaveBeenCalled();
  });

  it("enforces the generated worker auth semantic-byte ceiling", async () => {
    const request = await exactRequest(testArtifact());
    const Runtime = generatedRuntimeClass(
      testExactRuntimeWorkerSource(),
      Object.freeze({
        isMutation: true,
        isPublic: true,
        _handler: () => ({ ok: true }),
      }),
    );
    const oversizedRequest = structuredClone(request) as {
      auth: {
        kind: "user";
        user: Record<string, unknown>;
      };
    };
    oversizedRequest.auth.user.oversized = "x".repeat(1 << 16);

    await expect(
      new Runtime().run(oversizedRequest, {
        resolvePointTable: () =>
          Promise.reject(new Error("journal must not be invoked")),
      }),
    ).rejects.toThrow("Invalid exact-runtime user auth.");
  });

  it("builds immutable no-network code and identities", async () => {
    const sourcePackage = testSourcePackage();
    const ref = await executionArtifactRefForSourcePackage(sourcePackage);
    const artifact = await exactArtifact(ref);
    const loaded = await Effect.runPromise(
      loadPointMutationExactRuntimeWorkerDefinitionV1Effect({
        store: {
          get: () => Promise.resolve(sourcePackage),
        },
        artifact,
        compatibilityDate: "2026-07-24",
      }),
    );
    const definition = loaded.definition;

    expect(definition).toMatchObject({
      mainModule: POINT_MUTATION_EXACT_RUNTIME_MAIN_MODULE_V1,
      env: {},
      globalOutbound: null,
      entrypoint: POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1,
    });
    expect(Object.keys(definition.modules).sort()).toEqual([
      "_flarex/execution.js",
      POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1,
      POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
      POINT_MUTATION_EXACT_RUNTIME_MAIN_MODULE_V1,
      "orders.js",
    ].sort());
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.modules)).toBe(true);
    expect(
      definition.modules[POINT_MUTATION_EXACT_RUNTIME_MAIN_MODULE_V1],
    ).toBe(POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1);
    expect(
      definition.modules[POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1],
    ).toContain(`pinnedSourcePackageHash: ${JSON.stringify(ref.sourcePackageHash)}`);
    expect(
      definition.modules[
        POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1
      ],
    ).toContain('export { default } from "../_flarex/execution.js";');
    expectTypeOf(definition.modules).toEqualTypeOf<
      Readonly<Record<string, string>>
    >();
    expect(() => {
      (definition.modules as Record<string, string>).unexpected = "tampered";
    }).toThrow();

    const identity = pointMutationExactRuntimeWorkerCodeIdentityV1({
      artifact,
      compatibilityDate: "2026-07-24",
    });
    expect(identity).toContain("point-mutation-exact-runtime-v1");
    expect(identity).toContain(
      POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SHA256_V1,
    );
    expect(identity).toContain(ref.artifactId);
    expect(identity).toContain(ref.sourcePackageHash);
    expect(identity).toContain("2026-07-24");
    expect(pointMutationExactRuntimeWorkerCodeIdentityV1({
      artifact,
      compatibilityDate: "2026-07-25",
    })).not.toBe(identity);
    const identityParts: unknown = JSON.parse(identity);
    expect(identityParts).toContainEqual([
      POINT_MUTATION_EXACT_RUNTIME_MAIN_MODULE_V1,
      POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SHA256_V1,
    ]);
    expect(identityParts).toContain(POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1);
    expect(identityParts).toContainEqual([
      POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1,
      definition.modules[POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1],
    ]);
    expect(identityParts).toContainEqual([
      POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
      definition.modules[
        POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1
      ],
    ]);
    await expect(Effect.runPromise(
      loadPointMutationExactRuntimeWorkerDefinitionV1Effect({
        store: {
          get: () => Promise.resolve(sourcePackage),
        },
        artifact,
        compatibilityDate: "2026-02-30",
      }),
    )).rejects.toMatchObject({
      _tag: "PointMutationExactRuntimeHostV1Error",
      issue: {
        reason: "workerDefinitionFailed",
        cause: {
          message:
            "Exact point-mutation runtime compatibility date is invalid.",
        },
      },
    } satisfies Partial<PointMutationExactRuntimeHostV1Error>);
  });

  it("loads and revalidates the pinned source package before definition creation", async () => {
    const sourcePackage = testSourcePackage();
    const ref = await executionArtifactRefForSourcePackage(sourcePackage);
    const artifact = await exactArtifact(ref);
    const get = vi.fn(async () => sourcePackage);
    const store = { get } satisfies Pick<BackendExecutionArtifactStore, "get">;

    const loaded = await Effect.runPromise(
      loadPointMutationExactRuntimeWorkerDefinitionV1Effect({
        store,
        artifact,
        compatibilityDate: "2026-07-24",
      }),
    );

    expect(get).toHaveBeenCalledWith(artifact);
    expect(loaded.definition.globalOutbound).toBeNull();
    expect(loaded.definition.env).toEqual({});
    expect(loaded.codeIdentity).toBe(
      pointMutationExactRuntimeWorkerCodeIdentityV1({
        artifact,
        compatibilityDate: "2026-07-24",
      }),
    );
    expect(loaded.loadMode).toBe("fresh");
  });

  it("keeps source loading and pin mismatch failures typed and separate", async () => {
    const sourcePackage = testSourcePackage();
    const ref = await executionArtifactRefForSourcePackage(sourcePackage);
    const artifact = await exactArtifact(ref);

    await expect(Effect.runPromise(
      loadPointMutationExactRuntimeWorkerDefinitionV1Effect({
        store: {
          get: () => Promise.reject(new Error("R2 unavailable")),
        },
        artifact,
        compatibilityDate: "2026-07-24",
      }),
    )).rejects.toMatchObject({
      _tag: "PointMutationExactRuntimeHostV1Error",
      issue: {
        reason: "sourcePackageLoadFailed",
        cause: expect.any(Error),
      },
    } satisfies Partial<PointMutationExactRuntimeHostV1Error>);

    const bucket = new ExactRuntimeTestR2Bucket();
    const concreteStore = new R2BackendExecutionArtifactStore(bucket);
    const concreteRef = await concreteStore.put(sourcePackage);
    const concreteArtifact = await exactArtifact(concreteRef);
    await bucket.put(
      executionArtifactSourcePackageKey(concreteRef),
      JSON.stringify({
        ...sourcePackage,
        modules: sourcePackage.modules.map(module =>
          module.path === "orders.js"
            ? { ...module, source: `${module.source}\n// tampered` }
            : module
        ),
      }),
    );
    await expect(Effect.runPromise(
      loadPointMutationExactRuntimeWorkerDefinitionV1Effect({
        store: concreteStore,
        artifact: concreteArtifact,
        compatibilityDate: "2026-07-24",
      }),
    )).rejects.toMatchObject({
      _tag: "PointMutationExactRuntimeHostV1Error",
      issue: {
        reason: "sourcePackagePinMismatch",
        cause: {
          _tag: "BackendExecutionArtifactIntegrityError",
          artifactId: concreteRef.artifactId,
        },
      },
    } satisfies Partial<PointMutationExactRuntimeHostV1Error>);

    await expect(Effect.runPromise(
      loadPointMutationExactRuntimeWorkerDefinitionV1Effect({
        store: {
          get: () => Promise.resolve({
            ...sourcePackage,
            functions: ["orders:other"],
          }),
        },
        artifact,
        compatibilityDate: "2026-07-24",
      }),
    )).rejects.toMatchObject({
      _tag: "PointMutationExactRuntimeHostV1Error",
      issue: {
        reason: "sourcePackagePinMismatch",
        cause: expect.any(Error),
      },
    } satisfies Partial<PointMutationExactRuntimeHostV1Error>);

    for (const modules of [
      sourcePackage.modules.map(module =>
        module.path === "orders.js"
          ? { ...module, source: `${module.source}\n// tampered` }
          : module
      ),
      sourcePackage.modules.map(module =>
        module.path === "orders.js"
          ? { ...module, sourceMap: "{}" }
          : module
      ),
    ]) {
      await expect(Effect.runPromise(
        loadPointMutationExactRuntimeWorkerDefinitionV1Effect({
          store: {
            get: () => Promise.resolve({ ...sourcePackage, modules }),
          },
          artifact,
          compatibilityDate: "2026-07-24",
        }),
      )).rejects.toMatchObject({
        _tag: "PointMutationExactRuntimeHostV1Error",
        issue: {
          reason: "sourcePackagePinMismatch",
          cause: expect.any(Error),
        },
      } satisfies Partial<PointMutationExactRuntimeHostV1Error>);
    }
  });
});

interface ExactTestContext {
  readonly auth: {
    readonly getUserIdentity: () => Promise<
      Readonly<Record<string, unknown>> | null
    >;
  };
  readonly db: {
    readonly get: (id: string) => Promise<unknown>;
    readonly insert: (table: string, fields: unknown) => Promise<string>;
    readonly patch: (id: string, patch: unknown) => Promise<void>;
    readonly replace: (id: string, fields: unknown) => Promise<void>;
    readonly delete: (id: string) => Promise<void>;
  };
}

type GeneratedExactRuntime = new () => {
  readonly run: (
    input: unknown,
    journal: unknown,
  ) => Promise<unknown>;
};

function generatedRuntimeClass(
  source: string,
  functionValue: Readonly<Record<string, unknown>>,
): GeneratedExactRuntime {
  const body = executableGeneratedSource(source, true);
  const factory = new Function(
    "functionValue",
    body,
  ) as (functionValue: Readonly<Record<string, unknown>>) =>
    GeneratedExactRuntime;
  return factory(functionValue);
}

function executableGeneratedSource(
  source: string,
  returnRuntime: boolean,
): string {
  const withoutGlobalHardening = source.replace(
    "installExactRuntimeIntrinsics();",
    "// Exact-runtime intrinsic installation is isolated in a subprocess test.",
  );
  const withoutWorkerImport = withoutGlobalHardening.replace(
    'import { WorkerEntrypoint } from "cloudflare:workers";',
    "class WorkerEntrypoint {}",
  );
  const withTestModule = withoutWorkerImport.replace(
    /const executionModulePromise = import\([^;]+;/,
    'const executionModulePromise = Promise.resolve({ default: { orders: { complete: functionValue } } });',
  );
  const withoutExport = withTestModule.replace(
    `export class ${POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1}`,
    `class ${POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1}`,
  );
  return returnRuntime
    ? `${withoutExport}\nreturn ${POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1};`
    : withoutExport;
}

function testExactRuntimeWorkerSource(): string {
  return pointMutationExactRuntimeWorkerSource({
    executionModule: "_flarex/execution.js",
    moduleTime: Date.UTC(2026, 6, 24),
    moduleRandomSeedHex: "a".repeat(64),
  });
}

function runGeneratedRuntimeInFreshProcess(seedByte: number): Readonly<{
  readonly first: Readonly<{
    readonly value: Readonly<{
      readonly randomValues: readonly number[];
    }>;
  }>;
  readonly secondFailure: string;
  readonly sequences: readonly string[];
  readonly capturedInsertStatus: string;
}> {
  const source = testExactRuntimeWorkerSource()
    .replace(
      'import { WorkerEntrypoint } from "cloudflare:workers";',
      `const nativeGlobalPrototype = Object.getPrototypeOf(globalThis);
const testWorkerGlobalPrototype = Object.create(nativeGlobalPrototype);
Object.defineProperties(testWorkerGlobalPrototype, {
  setTimeout: {
    value: () => "prototype timer escaped",
    configurable: true,
    writable: true,
  },
  MessageChannel: {
    value: class TestMessageChannel {},
    configurable: true,
    writable: true,
  },
});
Object.setPrototypeOf(globalThis, testWorkerGlobalPrototype);
class WorkerEntrypoint {}`,
    )
    .replace(
      /const executionModulePromise = import\([^;]+;/,
      `const executionModulePromise = (() => {
  try { Object.freeze = (value) => value; } catch {}
  try { Promise.prototype.then = () => Promise.resolve("tampered"); } catch {}
  const tamperBlocked =
    Object.isFrozen(Object) &&
    Object.isFrozen(Promise.prototype);
  return Promise.resolve({
    default: {
      orders: {
        complete: {
          isMutation: true,
          isPublic: true,
          _handler: async (ctx) => {
            const firstNow = Date.now();
            const firstRandom = Math.random();
            await Promise.resolve();
            const get = ctx.db.get(${JSON.stringify(testOrderId)});
            const fields = { status: "new" };
            const insert = ctx.db.insert("orders", fields);
            fields.status = "mutated-after-call";
            let cryptoRandomBlocked = false;
            try {
              crypto.randomUUID();
            } catch {
              cryptoRandomBlocked = true;
            }
            let cryptoSubtleBlocked = false;
            try {
              await crypto.subtle.digest(
                "SHA-256",
                new Uint8Array([1]),
              );
            } catch {
              cryptoSubtleBlocked = true;
            }
            let cachesBlocked = false;
            try {
              await caches.default.match("https://example.com");
            } catch {
              cachesBlocked = true;
            }
            let timersBlocked = false;
            try {
              setTimeout(() => undefined, 0);
            } catch {
              timersBlocked = true;
            }
            let abortTimeoutBlocked = false;
            try {
              AbortSignal.timeout(1);
            } catch {
              abortTimeoutBlocked = true;
            }
            let inheritedTimerBlocked = false;
            try {
              Reflect.apply(
                Object.getPrototypeOf(globalThis).setTimeout,
                globalThis,
                [() => undefined, 0],
              );
            } catch {
              inheritedTimerBlocked = true;
            }
            let messageChannelBlocked = false;
            try {
              new MessageChannel();
            } catch {
              messageChannelBlocked = true;
            }
            let webAssemblyAsyncBlocked = false;
            try {
              WebAssembly.compile(new Uint8Array());
            } catch {
              webAssemblyAsyncBlocked = true;
            }
            let fetchBlocked = false;
            try {
              fetch("https://example.com");
            } catch {
              fetchBlocked = true;
            }
            const dateTimeFormat = new Intl.DateTimeFormat(
              "en-US",
              { timeZone: "UTC" },
            );
            let implicitIntlTimeBlocked = false;
            try {
              dateTimeFormat.format();
            } catch {
              implicitIntlTimeBlocked = true;
            }
            const explicitIntlTime =
              dateTimeFormat.format(100).length > 0;
            return {
              firstNow,
              secondNow: Date.now(),
              dateNow: new Date().getTime(),
              performanceNow: performance.now(),
              randomValues: [firstRandom, Math.random()],
              cryptoRandomBlocked,
              cryptoSubtleBlocked,
              cachesBlocked,
              datePrototypeConstructorNow: Date.prototype.constructor.now(),
              cryptoPrototypeNull: Object.getPrototypeOf(crypto) === null,
              subtlePrototypeNull:
                Object.getPrototypeOf(crypto.subtle) === null,
              cachesPrototypeNull: Object.getPrototypeOf(caches) === null,
              defaultCachePrototypeNull:
                Object.getPrototypeOf(caches.default) === null,
              performancePrototypeNull:
                Object.getPrototypeOf(performance) === null,
              timersBlocked,
              abortTimeoutBlocked,
              inheritedTimerBlocked,
              messageChannelBlocked,
              webAssemblyAsyncBlocked,
              fetchBlocked,
              implicitIntlTimeBlocked,
              explicitIntlTime,
              tamperBlocked,
              got: await get,
              inserted: await insert,
            };
          },
        },
      },
    },
  });
})();`,
    )
    .replace(
      `export class ${POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1}`,
      `class ${POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1}`,
    );
  const script = `${source}
(async () => {
  const calls = [];
  const request = {
    format: ${JSON.stringify(POINT_MUTATION_EXACT_RUNTIME_FORMAT_V1)},
    version: 1,
    artifact: {
      runtime: "dynamic-worker",
      artifactId: "artifact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourcePackageHash: "${"a".repeat(64)}",
      executionModule: "_flarex/execution.js",
    },
    function: {
      path: "orders:complete",
      executionModule: "_flarex/execution.js",
      kind: "mutation",
      visibility: "public",
    },
    auth: { kind: "anonymous" },
    arguments: {},
    argumentArraySemanticBytes: 4,
    tables: [{ tableId: 1, logicalName: "orders" }],
    context: {
      executionId: "execution-1",
      logScopeId: "log-scope-1",
      randomSeed: new Uint8Array(32).fill(${seedByte}),
      executionTime: 100,
      initialCreationTimeCursor: 100,
    },
  };
  const runtime = new ${POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1}();
  const journal = {
    resolvePointTable: async () => ({
      runPointOperation: async (operation) => {
        calls.push(operation);
        if (operation.kind === "get") {
          return {
            kind: "present",
            document: {
              _id: ${JSON.stringify(testOrderId)},
              _creationTime: 100,
              status: "open",
            },
          };
        }
        return {
          kind: "inserted",
          documentId: ${JSON.stringify(testInsertedOrderId)},
          document: {
            _id: ${JSON.stringify(testInsertedOrderId)},
            _creationTime: 100,
            status: operation.fields.status,
          },
        };
      },
    }),
  };
  const first = await runtime.run(request, journal);
  let secondFailure = "none";
  try {
    await runtime.run(request, journal);
  } catch (error) {
    secondFailure = error?.name ?? "unknown";
  }
  console.log(JSON.stringify({
    first,
    secondFailure,
    sequences: calls.map((call) => String(call.syscallSequence)),
    capturedInsertStatus: calls[1].fields.status,
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});`;
  return JSON.parse(execFileSync(process.execPath, ["-"], {
    input: script,
    encoding: "utf8",
  })) as ReturnType<typeof runGeneratedRuntimeInFreshProcess>;
}

async function exactRequest(
  artifact: Readonly<{
    readonly runtime: "dynamic-worker";
    readonly artifactId: string;
    readonly sourcePackageHash: string;
    readonly executionModule: string;
  }>,
): Promise<PointMutationExactRuntimeRequestV1> {
  const argumentsValue = {
    orderId: "1:11111111-1111-1111-1111-111111111111",
  };
  const normalized = normalizeFlarexValueV1(argumentsValue);
  return Effect.runPromise(
    decodePointMutationExactRuntimeRequestV1Effect({
      format: POINT_MUTATION_EXACT_RUNTIME_FORMAT_V1,
      version: 1,
      artifact,
      function: {
        path: "orders:complete",
        executionModule: artifact.executionModule,
        kind: "mutation",
        visibility: "public",
      },
      auth: {
        kind: "user",
        user: {
          tokenIdentifier: "token-1",
          issuer: "https://auth.example.com",
          subject: "user-1",
          email: "user@example.com",
          emailVerified: true,
          role: "admin",
        },
      },
      arguments: argumentsValue,
      argumentArraySemanticBytes:
        requirePointMutationArgumentSemanticSizeV1(
          normalized.semanticSizeBytes,
        ),
      tables: [{ tableId: 1, logicalName: "orders" }],
      context: {
        executionId: "execution-1",
        logScopeId: "log-scope-1",
        randomSeed: new Uint8Array(32).fill(5),
        executionTime: 100,
        initialCreationTimeCursor: 100,
      },
    }),
  );
}

async function exactArtifact(
  ref: ExecutionArtifactRef,
): Promise<PointMutationExactRuntimeArtifactRefV1> {
  return (await exactRequest({
    runtime: ref.runtime,
    artifactId: ref.artifactId,
    sourcePackageHash: ref.sourcePackageHash,
    executionModule: ref.executionModule,
  })).artifact;
}

function testArtifact() {
  return {
    runtime: "dynamic-worker",
    artifactId: "artifact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sourcePackageHash: "a".repeat(64),
    executionModule: "_flarex/execution.js",
  } as const;
}

function testSourcePackage(): PushSourcePackage {
  return {
    sourceModuleDigestFormat: "sha256-framed-v1",
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: sourceModuleSha256ForTest("export default {};"),
        source: "export default {};",
      },
      {
        path: "orders.js",
        environment: "isolate",
        sha256: sourceModuleSha256ForTest("export const complete = {};"),
        source: "export const complete = {};",
      },
    ],
    functions: ["orders:complete"],
    execution: "_flarex/execution.js",
  };
}

class ExactRuntimeTestR2Bucket implements R2BucketLike {
  private readonly objects = new Map<string, string>();

  put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
    return Promise.resolve();
  }

  get(key: string): Promise<{ text(): Promise<string> } | null> {
    const value = this.objects.get(key);
    if (value === undefined) return Promise.resolve(null);
    return Promise.resolve({
      text: () => Promise.resolve(value),
    });
  }

  delete(key: string | string[]): Promise<void> {
    for (const item of Array.isArray(key) ? key : [key]) {
      this.objects.delete(item);
    }
    return Promise.resolve();
  }
}
