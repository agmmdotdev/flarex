import { Miniflare } from "miniflare";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
  type EdgeActionHostPolicyFrameV1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  APPLICATION_ACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_ACTION_WORKER_REQUEST_VERSION_V1,
  MAX_APPLICATION_WORKER_RESULT_SEMANTIC_BYTES_V1,
  APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
} from "flarex-protocol/internal/application-worker-v1";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import { Result } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalizeApplicationManifestV1,
  canonicalizeApplicationManifestV2,
  type ApplicationManifestV1,
  type ApplicationManifestV2,
} from "@flarex/analysis/application-analysis";
import {
  canonicalizeApplicationRuntimeTargetV1,
  type ApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";

import {
  makeApplicationWorkerDefinition,
  type ApplicationWorkerDefinition,
} from "../src/artifactRuntime/ApplicationWorkerDefinition";
import type { ApplicationAnalysisSourceBundle } from
  "../src/sourceArtifactV2/ApplicationAnalysisReader";

const instances: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map(instance => instance.dispose()));
});

describe("Application Worker definition", () => {
  it.each(["asc", "desc"] as const)("runs all SDK terminals through finite chunks in %s order", async order => {
    const fixture = applicationFixture("query", "sdk");
    const definition = makeApplicationWorkerDefinition({
      ...fixture, hostPolicy: hostPolicy(), hostPolicySha256: digestBytes(), documentIdFormat: "convex",
    });
    const execute = (args: Record<string, unknown>) => executeDefinition(
      definition, definition.transactionEntrypoint,
      transactionRequest(fixture.target, { ...args, order }, "query", 7), "query",
      { capabilityMembers: sdkCapabilityMembers() },
    );
    const collect = await execute({ method: "collect" });
    expect(collect).toMatchObject({ value: expect.arrayContaining([{ ordinal: order === "asc" ? 0 : 279, requested: 128, captured: "original" }]) });
    expect((collect as { value: unknown[] }).value).toHaveLength(280);
    const take = await execute({ method: "take", count: 260 });
    expect((take as { value: unknown[] }).value).toHaveLength(260);
    expect((take as { value: { requested: number }[] }).value.at(-1)?.requested).toBe(4);
    await expect(execute({ method: "take", count: 0 })).resolves.toMatchObject({ value: [] });
    await expect(execute({ method: "first" })).resolves.toMatchObject({ value: { ordinal: order === "asc" ? 0 : 279, requested: 1 } });
    const paginated = await execute({ method: "paginate", count: 260 });
    expect(paginated).toMatchObject({ value: { isDone: false, continueCursor: "cursor:260" } });
    expect((paginated as { value: { page: unknown[] } }).value.page).toHaveLength(260);
    await expect(execute({ method: "uniqueCaught" })).resolves.toMatchObject({ value: "caught" });
    await expect(execute({ method: "capture" })).resolves.toMatchObject({ value: "original" });
  }, 120_000);



  it("consumes derived SDK queries and range builders while keeping initializers reusable", async () => {
    const fixture = applicationFixture("query", "sdk");
    const definition = makeApplicationWorkerDefinition({
      ...fixture, hostPolicy: hostPolicy(), hostPolicySha256: digestBytes(), documentIdFormat: "convex",
    });
    await expect(executeDefinition(definition, definition.transactionEntrypoint,
      transactionRequest(fixture.target, { method: "consumption" }, "query", 7), "query",
      { capabilityMembers: sdkCapabilityMembers() },
    )).resolves.toMatchObject({ value: {
      sameTerminal: true, zeroConsumed: true, repeatedOrder: true,
      consumedAfterOrderError: true, discarded: true, reusable: true,
    } });
  });

  it("hides query capabilities from reflection and drains despite forged public slots", async () => {
    const fixture = applicationFixture("query", "sdk");
    const definition = makeApplicationWorkerDefinition({
      ...fixture, hostPolicy: hostPolicy(), hostPolicySha256: digestBytes(), documentIdFormat: "convex",
    });
    await expect(executeDefinition(definition, definition.transactionEntrypoint,
      transactionRequest(fixture.target, { method: "reflection" }, "query", 7), "query",
      { capabilityMembers: sdkCapabilityMembers() },
    )).resolves.toMatchObject({ value: { visible: [], forgedRefused: true, bypassed: false } });
  });

  it("drains a dropped multi-chunk collection after closure", async () => {
    const fixture = applicationFixture("query", "sdk");
    const definition = makeApplicationWorkerDefinition({
      ...fixture, hostPolicy: hostPolicy(), hostPolicySha256: digestBytes(), documentIdFormat: "convex",
    });
    await expect(executeDefinition(definition, definition.transactionEntrypoint,
      transactionRequest(fixture.target, { method: "dropped" }, "query", 7), "query",
      { capabilityMembers: sdkCapabilityMembers() },
    )).resolves.toMatchObject({ value: null });
  });

  it.each(["uniqueDropped", "late"])("rejects the complete %s terminal after boundary closure", async method => {
    const fixture = applicationFixture("query", "sdk");
    const definition = makeApplicationWorkerDefinition({
      ...fixture, hostPolicy: hostPolicy(), hostPolicySha256: digestBytes(), documentIdFormat: "convex",
    });
    await expect(executeDefinition(definition, definition.transactionEntrypoint,
      transactionRequest(fixture.target, { method }, "query", 7), "query",
      { capabilityMembers: sdkCapabilityMembers() },
    )).rejects.toThrow("ApplicationWorkerReadBoundaryV1Error");
  });


  it("keeps owned query refusals catchable while host failures stay sticky", async () => {
    const fixture = applicationFixture("query", "sdk");
    const definition = makeApplicationWorkerDefinition({
      ...fixture, hostPolicy: hostPolicy(), hostPolicySha256: digestBytes(), documentIdFormat: "convex",
    });
    await expect(executeDefinition(definition, definition.transactionEntrypoint,
      transactionRequest(fixture.target, { method: "inputCaught" }, "query", 7), "query",
      { capabilityMembers: sdkCapabilityMembers() + '\nqueryStart() { return { kind: "queryError", message: "Invalid cursor." }; }' },
    )).resolves.toMatchObject({ value: "caught" });
    await expect(executeDefinition(definition, definition.transactionEntrypoint,
      transactionRequest(fixture.target, { method: "inputCaught" }, "query", 7), "query",
      { capabilityMembers: sdkCapabilityMembers() + '\nqueryStart() { throw new Error("host failed"); }' },
    )).rejects.toThrow("ApplicationWorkerReadBoundaryV1Error");
  });

  it("requires the logical capability on a trusted core definition", async () => {
    const fixture = applicationFixture("query", "sdk");
    const definition = makeApplicationWorkerDefinition({
      ...fixture, hostPolicy: hostPolicy(), hostPolicySha256: digestBytes(), documentIdFormat: "convex",
    });
    await expect(executeDefinition(definition, definition.transactionEntrypoint,
      transactionRequest(fixture.target, { method: "take", count: 1 }, "query", 7), "query",
    )).rejects.toThrow("ApplicationWorkerReadBoundaryV1Error");
  });

  it("executes a relation-bearing Manifest V2 through the real Worker loader", async () => {
    const fixture = relationApplicationFixture();
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });

    const response = await executeDefinition(
      definition,
      definition.transactionEntrypoint,
      transactionRequest(fixture.target, { name: "Ada" }, "write", 9, [{
        tableId: 2,
        logicalName: "users",
      }]),
      "mutation",
    );

    expect(response).toEqual({
      format: "flarex.application-worker-result",
      version: 1,
      value: "1:00000000-0000-0000-0000-000000000002",
    });
  });

  it("builds a pure definition with no embedded outbound authority", () => {
    const fixture = applicationFixture("query");
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });

    expect("globalOutbound" in definition).toBe(false);
    expect(definition.transactionEntrypoint)
      .toBe("FlarexApplicationTransactionWorker");
    expect(definition.actionEntrypoint).toBe("FlarexApplicationActionWorker");
    expect(Object.keys(definition.modules)).toContain(definition.mainModule);
  });

  it("rejects source authority that does not match the target and manifest", () => {
    const fixture = applicationFixture("query");
    expect(() => makeApplicationWorkerDefinition({
      ...fixture,
      source: Object.freeze({
        ...fixture.source,
        sourceArtifact: Object.freeze({
          ...fixture.source.sourceArtifact,
          rootSha256: "9".repeat(64),
        }),
      }),
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    })).toThrow("Application worker source authority mismatches.");
    expect(() => makeApplicationWorkerDefinition({
      ...fixture,
      source: Object.freeze({
        ...fixture.source,
        sourceArtifact: Object.freeze({
          ...fixture.source.sourceArtifact,
          modules: Object.freeze(fixture.source.sourceArtifact.modules.map(
            (module, index) => index === 0
              ? Object.freeze({ ...module, sourceSha256: "8".repeat(64) })
              : module,
          )),
        }),
      }),
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    })).toThrow("Application worker source authority mismatches.");
    expect(() => makeApplicationWorkerDefinition({
      ...fixture,
      source: Object.freeze({
        ...fixture.source,
        sourceArtifact: Object.freeze({
          ...fixture.source.sourceArtifact,
          schemaModulePath: "schema.js",
        }),
      }),
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    })).toThrow("Application worker source authority mismatches.");
  });

  it("compares nested function authority independently of object member order", () => {
    const fixture = applicationFixture("mutation");
    const manifestArgs = {
      type: "object" as const,
      value: {
        description: {
          fieldType: { type: "string" as const },
          optional: true,
        },
        name: {
          fieldType: { type: "string" as const },
          optional: false,
        },
      },
    };
    const targetArgs = {
      type: "object" as const,
      value: {
        name: {
          fieldType: { type: "string" as const },
          optional: false,
        },
        description: {
          fieldType: { type: "string" as const },
          optional: true,
        },
      },
    };
    const manifest = Object.freeze({
      ...fixture.manifest,
      functions: Object.freeze(fixture.manifest.functions.map(fn =>
        Object.freeze({ ...fn, args: manifestArgs })
      )),
    });
    const target = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
      ...fixture.target,
      function: {
        ...fixture.target.function,
        args: targetArgs,
      },
    })).target;

    expect(() => makeApplicationWorkerDefinition({
      source: fixture.source,
      manifest,
      target,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    })).not.toThrow();
    expect(() => makeApplicationWorkerDefinition({
      source: fixture.source,
      manifest,
      target: Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
        ...target,
        function: {
          ...target.function,
          args: {
            ...targetArgs,
            value: {
              ...targetArgs.value,
              description: {
                ...targetArgs.value.description,
                optional: false,
              },
            },
          },
        },
      })).target,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    })).toThrow("Application worker root function authority mismatches.");
  });

  it("executes a query and its internal query through a fake read capability", async () => {
    const fixture = applicationFixture("query");
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });
    const argumentsValue = { id: "1:00000000-0000-0000-0000-000000000001" };
    const response = await executeDefinition(
      definition,
      definition.transactionEntrypoint,
      {
        format: APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
        version: APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
        target: fixture.target,
        auth: { kind: "anonymous" },
        arguments: argumentsValue,
        argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue)
          .semanticSizeBytes,
        tables: [{ tableId: 1, logicalName: "users" }],
        context: {
          mode: "query",
          executionId: "query-execution",
          randomSeed: new Uint8Array(32).fill(7),
          executionTime: 1_800_000_000_000,
          snapshotCommitSeq: 9n,
        },
      },
      "query",
    );

    expect(response).toEqual({
      format: "flarex.application-worker-result",
      version: 1,
      value: "Ada",
    });
  });

  it("executes and validates the logical incoming relation query boundary", async () => {
    const fixture = applicationFixture("query", "relationRead");
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });
    const id = "2:00000000-0000-0000-0000-000000000001";
    const tables = Object.freeze([
      Object.freeze({ tableId: 1, logicalName: "posts" }),
      Object.freeze({ tableId: 2, logicalName: "users" }),
    ]);
    const response = await executeDefinition(
      definition,
      definition.transactionEntrypoint,
      transactionRequest(fixture.target, { id }, "query", 7, tables),
      "query",
      {
        capabilityMembers: `
          takeIncomingRelationSources(input) {
            const source = input.relation.source;
            if (
              source.table !== "posts" || source.path.length !== 1 ||
              source.path[0].kind !== "field" ||
              source.path[0].name !== "authors" || input.target !== ${JSON.stringify(id)} ||
              input.limit !== 16
            ) throw new Error("unexpected relation input");
            return {
              sources: [{
                sourceDocumentId: "1:00000000-0000-0000-0000-000000000002",
                duplicateOrdinal: 0,
                position: 3,
              }],
              exhausted: true,
            };
          }
        `,
      },
    );

    expect(response).toEqual({
      format: "flarex.application-worker-result",
      version: 1,
      value: {
        sources: [{
          sourceDocumentId: "1:00000000-0000-0000-0000-000000000002",
          position: 3,
        }],
        exhausted: true,
      },
    });

    const malformedPages = [
      `{
        sources: [{ sourceDocumentId: "bad", position: null }],
        exhausted: true,
      }`,
      `{
        sources: [{
          sourceDocumentId: "2:00000000-0000-0000-0000-000000000003",
          position: null,
        }],
        exhausted: true,
      }`,
      `{
        sources: Array.from({ length: 17 }, (_, index) => ({
          sourceDocumentId: "1:00000000-0000-0000-0000-000000000002",
          position: index,
        })),
        exhausted: true,
      }`,
      `{
        sources: Array.from({ length: 129 }, (_, index) => ({
          sourceDocumentId: "1:00000000-0000-0000-0000-000000000002",
          position: index,
        })),
        exhausted: true,
      }`,
    ];
    for (const malformedPage of malformedPages) {
      await expect(executeDefinition(
        definition,
        definition.transactionEntrypoint,
        transactionRequest(fixture.target, { id }, "query", 7, tables),
        "query",
        {
          capabilityMembers: `
            takeIncomingRelationSources() { return ${malformedPage}; }
          `,
        },
      )).rejects.toThrow("ApplicationWorkerReadBoundaryV1Error");
    }
  });

  it("fails closed when an application module tampers with runtime intrinsics", async () => {
    const fixture = applicationFixture("query", "tamper");
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });
    const argumentsValue = { id: "1:00000000-0000-0000-0000-000000000001" };
    await expect(executeDefinition(
      definition,
      definition.transactionEntrypoint,
      {
        format: APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
        version: APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
        target: fixture.target,
        auth: { kind: "anonymous" },
        arguments: argumentsValue,
        argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue)
          .semanticSizeBytes,
        tables: [{ tableId: 1, logicalName: "users" }],
        context: {
          mode: "query",
          executionId: "tampered-query-execution",
          randomSeed: new Uint8Array(32).fill(7),
          executionTime: 1_800_000_000_000,
          snapshotCommitSeq: 9n,
        },
      },
      "query",
    )).rejects.toThrow("ApplicationWorkerDefinitionV1Error");
  });

  it("keeps runtime-critical prototypes intact after caught tamper attempts", async () => {
    const fixture = applicationFixture("query", "caughtTamper");
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });
    const response = await executeDefinition(
      definition,
      definition.transactionEntrypoint,
      transactionRequest(fixture.target, {
        id: "1:00000000-0000-0000-0000-000000000001",
      }, "query", 7),
      "query",
    );
    expect(response).toMatchObject({ value: "Ada" });
  });

  it("installs request determinism before application module evaluation", async () => {
    const fixture = applicationFixture("query", "determinism");
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });
    const request = transactionRequest(fixture.target, {}, "query", 7);
    const first = await executeDefinition(
      definition,
      definition.transactionEntrypoint,
      request,
      "query",
    );
    const second = await executeDefinition(
      definition,
      definition.transactionEntrypoint,
      request,
      "query",
    );

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      value: {
        capturedNow: 1_800_000_000_000,
        handlerNow: 1_800_000_000_000,
        performanceNow: 0,
        dateParse: 0,
        dateUtc: 0,
        constructorCompatible: true,
        subclassCompatible: true,
        callableCompatible: true,
      },
    });
  }, 20_000);

  it.each([0, 1] as const)(
    "enforces the Application worker root-result ceiling at offset %s",
    async offset => {
      const fixture = applicationFixture("query", "largeResult");
      const definition = makeApplicationWorkerDefinition({
        ...fixture,
        hostPolicy: hostPolicy(),
        hostPolicySha256: digestBytes(),
      });
      const size = MAX_APPLICATION_WORKER_RESULT_SEMANTIC_BYTES_V1 - 2 + offset;
      const execution = executeDefinition(
        definition,
        definition.transactionEntrypoint,
        transactionRequest(fixture.target, { size }, "query", 7),
        "query",
      );
      if (offset === 0) {
        const response = await execution as { readonly value: string };
        expect(response.value.length).toBe(size);
      } else {
        await expect(execution).rejects.toThrow(
          "ApplicationWorkerUserCodeV1Error",
        );
      }
    },
  );

  it("keeps a retained post-close database call sticky during drain", async () => {
    const fixture = applicationFixture("query", "closedRead");
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });
    await expect(executeDefinition(
      definition,
      definition.transactionEntrypoint,
      transactionRequest(fixture.target, {
        id: "1:00000000-0000-0000-0000-000000000001",
      }, "query", 7),
      "query",
    )).rejects.toThrow("ApplicationWorkerReadBoundaryV1Error");
  });

  it("maps malformed capability values and spoofed names to their owner", async () => {
    const query = applicationFixture("query");
    const queryDefinition = makeApplicationWorkerDefinition({
      ...query,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });
    const request = transactionRequest(query.target, {
      id: "1:00000000-0000-0000-0000-000000000001",
    }, "query", 7);
    await expect(executeDefinition(
      queryDefinition,
      queryDefinition.transactionEntrypoint,
      request,
      "query",
      {
        capabilityMembers: `
          readPointDocument() {
            const document = { name: "Ada" };
            document.self = document;
            return { kind: "present", document };
          }
        `,
      },
    )).rejects.toThrow("ApplicationWorkerReadBoundaryV1Error");
    await expect(executeDefinition(
      queryDefinition,
      queryDefinition.transactionEntrypoint,
      request,
      "query",
      {
        capabilityMembers: `
          readPointDocument() {
            const error = new Error("spoof");
            error.name = "ApplicationWorkerInvalidRequestV1Error";
            throw error;
          }
        `,
      },
    )).rejects.toThrow("ApplicationWorkerReadBoundaryV1Error");
  });

  it("does not inspect journal members on a query capability", async () => {
    const fixture = applicationFixture("query");
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });
    const response = await executeDefinition(
      definition,
      definition.transactionEntrypoint,
      transactionRequest(fixture.target, {
        id: "1:00000000-0000-0000-0000-000000000001",
      }, "query", 7),
      "query",
      {
        capabilityMembers: `
          get insertPointDocument() { throw new Error("forbidden read"); }
          get patchPointDocument() { throw new Error("forbidden read"); }
          get replacePointDocument() { throw new Error("forbidden read"); }
          get deletePointDocument() { throw new Error("forbidden read"); }
        `,
      },
    );
    expect(response).toMatchObject({ value: "Ada" });
  });

  it("executes a mutation through a fake journal capability", async () => {
    const fixture = applicationFixture("mutation");
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });
    const argumentsValue = { name: "Ada" };
    const response = await executeDefinition(
      definition,
      definition.transactionEntrypoint,
      {
        format: APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
        version: APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
        target: fixture.target,
        auth: { kind: "anonymous" },
        arguments: argumentsValue,
        argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue)
          .semanticSizeBytes,
        tables: [{ tableId: 1, logicalName: "users" }],
        context: {
          mode: "write",
          executionId: "mutation-execution",
          logScopeId: "mutation-log-scope",
          randomSeed: new Uint8Array(32).fill(8),
          executionTime: 1_800_000_000_000,
          initialCreationTimeCursor: 1_800_000_000_000,
        },
      },
      "mutation",
    );

    expect(response).toEqual({
      format: "flarex.application-worker-result",
      version: 1,
      value: "1:00000000-0000-0000-0000-000000000002",
    });
  });

  it("lets application code catch schema validation and continue writing", async () => {
    const fixture = applicationFixture("mutation", "catchValidation");
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });
    const response = await executeDefinition(
      definition,
      definition.transactionEntrypoint,
      transactionRequest(fixture.target, {}, "write", 8),
      "mutation",
      {
        capabilityMembers: `
          insertPointDocument(_tableName, value) {
            if (value.invalid === true) {
              const error = new Error("The resulting document failed the active schema validator.");
              Object.defineProperty(error, "name", { value: "ApplicationRevisionSyscallDocumentValidationV1Error" });
              throw error;
            }
            return "1:00000000-0000-0000-0000-000000000002";
          }
        `,
      },
    );

    expect(response).toMatchObject({
      value: "1:00000000-0000-0000-0000-000000000002",
    });
  });

  it("returns a public FlarexError as structured Application evidence", async () => {
    const fixture = applicationFixture("mutation", "applicationError");
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });
    const response = await executeDefinition(
      definition,
      definition.transactionEntrypoint,
      transactionRequest(fixture.target, {}, "write", 8),
      "mutation",
    );

    expect(response).toEqual({
      format: "flarex.application-worker-result",
      version: 1,
      kind: "applicationError",
      error: { code: "CLOSED", message: "closed", data: { orderId: "1" } },
    });
  });

  it("rejects a journal document id outside the protocol identity contract", async () => {
    const fixture = applicationFixture("mutation");
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });
    await expect(executeDefinition(
      definition,
      definition.transactionEntrypoint,
      transactionRequest(fixture.target, { name: "Ada" }, "write", 8),
      "mutation",
      { capabilityMembers: 'insertPointDocument() { return "invalid"; }' },
    )).rejects.toThrow("ApplicationWorkerJournalBoundaryV1Error");
  });

  it("cannot hide a dropped journal failure by tampering with iterators", async () => {
    const fixture = applicationFixture("mutation", "iteratorTamper");
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });
    await expect(executeDefinition(
      definition,
      definition.transactionEntrypoint,
      transactionRequest(fixture.target, {
        id: "1:00000000-0000-0000-0000-000000000001",
      }, "write", 8),
      "mutation",
      {
        capabilityMembers: `
          patchPointDocument() { throw new Error("journal failed"); }
        `,
      },
    )).rejects.toThrow("ApplicationWorkerJournalBoundaryV1Error");
  });

  it.each(["query", "action"] as const)(
    "disposes both local capabilities across duplicate %s admission",
    async kind => {
      const fixture = applicationFixture(kind);
      const definition = makeApplicationWorkerDefinition({
        ...fixture,
        hostPolicy: hostPolicy(),
        hostPolicySha256: digestBytes(),
      });
      await expect(executeLocalDisposalHarness(
        definition,
        kind,
      )).resolves.toEqual({
        disposals: 2,
        errors: [
          "ApplicationWorkerInvalidRequestV1Error",
          "ApplicationWorkerInvalidRequestV1Error",
        ],
      });
    },
  );

  it("executes an action through a fake callback with outbound denied", async () => {
    const fixture = applicationFixture("action");
    const definition = makeApplicationWorkerDefinition({
      ...fixture,
      hostPolicy: hostPolicy(),
      hostPolicySha256: digestBytes(),
    });
    const argumentsValue = { value: "Ada" };
    const response = await executeDefinition(
      definition,
      definition.actionEntrypoint,
      {
        format: APPLICATION_ACTION_WORKER_REQUEST_FORMAT_V1,
        version: APPLICATION_ACTION_WORKER_REQUEST_VERSION_V1,
        target: fixture.target,
        auth: { kind: "anonymous" },
        arguments: argumentsValue,
        argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue)
          .semanticSizeBytes,
        context: {
          executionId: "action-execution",
          invocationId: "action-invocation",
          executionGeneration: 1n,
          executionTime: 1_800_000_000_000,
          executionDeadline: 1_800_000_030_000,
          randomSeed: new Uint8Array(32).fill(9),
          hostPolicySha256: digestBytes(),
        },
      },
      "action",
    );

    expect(response).toEqual({
      format: "flarex.application-worker-result",
      version: 1,
      value: "denied:users:lookup:Ada",
    });
  });
});

type FunctionKind = "query" | "mutation" | "action";
type ApplicationSourceScenario =
  | "sdk"
  | "normal"
  | "tamper"
  | "caughtTamper"
  | "determinism"
  | "largeResult"
  | "relationRead"
  | "closedRead"
  | "applicationError"
  | "catchValidation"
  | "iteratorTamper";

function applicationFixture(
  kind: FunctionKind,
  scenario: ApplicationSourceScenario = "normal",
): Readonly<{
  readonly source: ApplicationAnalysisSourceBundle;
  readonly manifest: ApplicationManifestV1;
  readonly target: ApplicationRuntimeTargetV1;
}> {
  const sources = applicationSources(kind, scenario);
  const modules = Object.freeze([
    Object.freeze({
      path: "_flarex/application.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      sourceSha256: "b".repeat(64),
      sourceByteLength: new TextEncoder().encode(sources.execution).byteLength,
      source: sources.execution,
    }),
    Object.freeze({
      path: "functions/users.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      sourceSha256: "c".repeat(64),
      sourceByteLength: new TextEncoder().encode(sources.handlers).byteLength,
      source: sources.handlers,
    }),
  ]);
  const sourceArtifact = Object.freeze({
    rootSha256: "a".repeat(64),
    executionModulePath: "_flarex/application.js",
    schemaModulePath: null,
    modules: Object.freeze(modules.map(module => Object.freeze({
      path: module.path,
      roles: module.roles,
      sourceSha256: module.sourceSha256,
      sourceByteLength: module.sourceByteLength,
    }))),
  });
  const functions = kind === "query"
    ? [{
        path: "users:get",
        moduleName: "users",
        exportName: "get",
        kind: "query" as const,
        visibility: "public" as const,
        args: { type: "any" as const },
        returns: { type: "any" as const },
        partition: null,
      }, {
        path: "users:lookup",
        moduleName: "users",
        exportName: "lookup",
        kind: "query" as const,
        visibility: "internal" as const,
        args: { type: "any" as const },
        returns: { type: "any" as const },
        partition: null,
      }]
    : [{
        path: `users:${kind === "mutation" ? "create" : "notify"}`,
        moduleName: "users",
        exportName: kind === "mutation" ? "create" : "notify",
        kind,
        visibility: "public" as const,
        args: { type: "any" as const },
        returns: { type: "any" as const },
        partition: null,
      }];
  const manifest = Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: "flarex.application-manifest",
    version: 1,
    sourceArtifact,
    schema: { version: 1, tables: [], indexes: [] },
    functions,
  })).manifest;
  const target = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: "scope",
    revisionId: "revision",
    candidateId: "candidate",
    analysisId: "analysis",
    sourceArtifactRootSha256: sourceArtifact.rootSha256,
    manifestSha256: "d".repeat(64),
    schemaSha256: "e".repeat(64),
    functionCatalogSha256: "f".repeat(64),
    publicationSha256: "1".repeat(64),
    executionModulePath: sourceArtifact.executionModulePath,
    function: { ...manifest.functions[0]!, entrySha256: "2".repeat(64) },
  })).target;
  return Object.freeze({
    source: Object.freeze({ sourceArtifact, modules }),
    manifest,
    target,
  });
}

function relationApplicationFixture(): Readonly<{
  readonly source: ApplicationAnalysisSourceBundle;
  readonly manifest: ApplicationManifestV2;
  readonly target: ApplicationRuntimeTargetV1;
}> {
  const base = applicationFixture("mutation");
  const schemaSource = "export default {};\n";
  const schemaModule = Object.freeze({
    path: "_flarex/schema.js",
    roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
    sourceSha256: "9".repeat(64),
    sourceByteLength: new TextEncoder().encode(schemaSource).byteLength,
    source: schemaSource,
  });
  const sourceArtifact = Object.freeze({
    ...base.manifest.sourceArtifact,
    schemaModulePath: schemaModule.path,
    modules: Object.freeze([
      ...base.manifest.sourceArtifact.modules,
      Object.freeze({
        path: schemaModule.path,
        roles: schemaModule.roles,
        sourceSha256: schemaModule.sourceSha256,
        sourceByteLength: schemaModule.sourceByteLength,
      }),
    ].toSorted((left, right) => left.path.localeCompare(right.path))),
  });
  const manifest = Result.getOrThrow(canonicalizeApplicationManifestV2({
    format: "flarex.application-manifest",
    version: 2,
    sourceArtifact,
    schema: {
      version: 2,
      tables: [{
        tableId: 1,
        name: "posts",
        validator: {
          type: "object",
          value: {
            authors: {
              fieldType: {
                type: "array",
                value: { type: "id", tableName: "users" },
              },
              optional: false,
            },
          },
        },
        placement: { kind: "global" },
      }, {
        tableId: 2,
        name: "users",
        validator: {
          type: "object",
          value: {
            name: {
              fieldType: { type: "string" },
              optional: false,
            },
          },
        },
        placement: { kind: "global" },
      }],
      indexes: [],
      relations: [{
        relationOrdinal: 1,
        sourceTableOrdinal: 1,
        targetTableOrdinal: 2,
        declaration: {
          format: "flarex.relation-declaration",
          version: 1,
          source: {
            table: "posts",
            path: [{ kind: "field", name: "authors" }],
            forwardName: "authors",
          },
          target: { table: "users" },
          value: {
            cardinality: "many",
            minItems: 0,
            maxItems: 16,
            ordered: true,
            duplicates: "forbid",
          },
          inverse: { cardinality: "many", name: "posts" },
          localized: false,
          onTargetDelete: "restrict",
        },
      }],
    },
    functions: base.manifest.functions,
  })).manifest;
  return Object.freeze({
    source: Object.freeze({
      sourceArtifact,
      modules: Object.freeze(
        [...base.source.modules, schemaModule].toSorted((left, right) =>
          left.path.localeCompare(right.path)
        ),
      ),
    }),
    manifest,
    target: base.target,
  });
}

function applicationSources(
  kind: FunctionKind,
  scenario: ApplicationSourceScenario,
): Readonly<{
  readonly execution: string;
  readonly handlers: string;
}> {
  if (kind === "query") return Object.freeze({
    execution: [
      'import { internalQuery, query } from "flarex/server";',
      'import * as users from "../functions/users.js";',
      "export default { users: {",
      "  get: query({ handler: users.get }),",
      "  lookup: internalQuery({ handler: users.lookup }),",
      "} };",
      "",
    ].join("\n"),
    handlers: scenario === "sdk"
      ? [
          "export async function get(context, args) {",
          '  if ("queryIndexRange" in context.db) throw new Error("raw range leaked");',
          '  const operand = { token: "original" };',
          '  const query = context.db.query("users").withIndex("by_name", q => q.eq("name", operand)).order(args.order ?? "asc");',
          '  if (args.method === "capture") { operand.token = "changed before terminal"; const p = query.take(1); operand.token = "changed after terminal"; return (await p)[0].captured; }',
          '  if (args.method === "consumption") {',
          '    const initializer = context.db.query("users");',
          '    const build = () => initializer.withIndex("by_name", q => q.eq("name", { token: "original" }));',
          '    const consumed = build(); await consumed.take(1);',
          '    let sameTerminal = false; try { await consumed.take(1); } catch { sameTerminal = true; }',
          '    const zero = build(); await zero.take(0);',
          '    let zeroConsumed = false; try { await zero.take(0); } catch { zeroConsumed = true; }',
          '    const ordered = build().order("asc");',
          '    let repeatedOrder = false; try { ordered.order("desc"); } catch { repeatedOrder = true; }',
          '    let consumedAfterOrderError = false; try { await ordered.take(1); } catch { consumedAfterOrderError = true; }',
          '    let discarded = false; try { initializer.withIndex("by_name", q => { q.eq("name", "Ada"); return q; }); } catch { discarded = true; }',
          '    await build().take(1); await build().take(1);',
          '    return { sameTerminal, zeroConsumed, repeatedOrder, consumedAfterOrderError, discarded, reusable: true };',
          '  }',
          '  if (args.method === "reflection") {',
          '    const visible = Reflect.ownKeys(query);',
          '    if (["executor", "request", "terminalExecution", "execute"].some(key => Reflect.get(query, key) !== undefined)) throw new Error("query capability exposed");',
          '    let forgedRefused = false;',
          '    try { Reflect.apply(query.collect, Object.create(Object.getPrototypeOf(query)), []); } catch { forgedRefused = true; }',
          '    let bypassed = false;',
          '    query.executor = () => { bypassed = true; throw new Error("executor bypass"); };',
          '    query.terminalExecution = operation => { bypassed = true; return operation(); };',
          '    query.execute = () => { bypassed = true; throw new Error("helper bypass"); };',
          '    query.request = { table: "other" };',
          '    void query.collect();',
          '    return { visible, forgedRefused, bypassed };',
          '  }',
          '  if (args.method === "dropped") { void query.collect(); return null; }',
          '  if (args.method === "uniqueDropped") { void query.unique(); return null; }',
          '  if (args.method === "uniqueCaught") { try { await query.unique(); } catch { return "caught"; } }',
          '  if (args.method === "inputCaught") { try { await query.collect(); } catch { return "caught"; } }',
          '  if (args.method === "late") { void query.collect().then(() => query.take(1)).catch(() => undefined); return null; }',
          '  if (args.method === "take") return query.take(args.count);',
          '  if (args.method === "first") return query.first();',
          '  if (args.method === "paginate") return query.paginate({ numItems: args.count, cursor: args.cursor ?? null });',
          "  return query.collect();",
          "}",
          "export function lookup() { return null; }",
          "",
        ].join("\n")
      : scenario === "relationRead"
      ? [
          "export function get(context, args) {",
          "  return context.db.takeIncomingRelationSources({",
          '    source: { table: "posts", field: "authors" },',
          "    target: args.id,",
          "    limit: 16,",
          "  });",
          "}",
          "export function lookup() { return null; }",
          "",
        ].join("\n")
      : scenario === "determinism"
      ? [
          "const capturedNow = Date.now();",
          "const capturedRandom = Math.random();",
          "const capturedPerformance = performance.now();",
          "export function get() {",
          "  class SubDate extends Date {}",
          "  return {",
          "    capturedNow, capturedRandom, capturedPerformance,",
          "    handlerNow: Date.now(), handlerRandom: Math.random(),",
          "    performanceNow: performance.now(),",
          '    dateParse: Date.parse("1970-01-01T00:00:00.000Z"),',
          "    dateUtc: Date.UTC(1970, 0, 1),",
          "    constructorCompatible: new Date().constructor === Date,",
          "    subclassCompatible: new SubDate().constructor === SubDate,",
          "    callableCompatible: Date() === new Date().toString(),",
          "  };",
          "}",
          "export function lookup() { return null; }",
          "",
        ].join("\n")
      : scenario === "largeResult"
      ? [
          "export function get(_context, args) {",
          '  return "x".repeat(args.size);',
          "}",
          "export function lookup() { return null; }",
          "",
        ].join("\n")
      : scenario === "closedRead"
      ? [
          "export function get(context, args) {",
          "  const first = context.db.get(args.id);",
          "  void first.then(async () => {",
          "    try { await context.db.get(args.id); } catch {}",
          "  });",
          '  return "must-not-succeed";',
          "}",
          "export function lookup() { return null; }",
          "",
        ].join("\n")
      : [
      ...(scenario === "tamper"
        ? [
            "Set.prototype.add = function () { return this; };",
          ]
        : scenario === "caughtTamper"
        ? [
            "try { Set.prototype.add = function () { return this; }; } catch {}",
            "try { Promise.prototype.then = function () { return this; }; } catch {}",
            "try { Array.prototype.find = function () { return undefined; }; } catch {}",
            "try { Object.getPrototypeOf(Uint8Array.prototype)[Symbol.iterator] = () => []; } catch {}",
            'try { Error.prototype.name = "tampered"; } catch {}',
          ]
        : []),
      "export function get(context, args) {",
      '  return context.runQuery("users:lookup", args);',
      "}",
      "export async function lookup(context, args) {",
      "  const document = await context.db.get(args.id);",
      '  return document === null ? "missing" : document.name;',
      "}",
      "",
    ].join("\n"),
  });
  if (kind === "mutation") return Object.freeze({
    execution: [
      'import { mutation } from "flarex/server";',
      'import * as users from "../functions/users.js";',
      "export default { users: {",
      "  create: mutation({ handler: users.create }),",
      "} };",
      "",
    ].join("\n"),
    handlers: scenario === "catchValidation"
      ? [
          "export async function create(context) {",
          "  try { await context.db.insert(\"users\", { invalid: true }); } catch {}",
          "  return context.db.insert(\"users\", { valid: true });",
          "}",
          "",
        ].join("\n")
      : scenario === "applicationError"
      ? [
          'import { FlarexError } from "flarex/values";',
          "export function create() {",
          '  throw new FlarexError("CLOSED", "closed", { orderId: "1" });',
          "}",
          "",
        ].join("\n")
      : scenario === "iteratorTamper"
      ? [
          "try {",
          "  Object.getPrototypeOf([][Symbol.iterator]()).next = () => ({ done: true });",
          "} catch {}",
          "try {",
          "  Object.getPrototypeOf(new Set()[Symbol.iterator]()).next = () => ({ done: true });",
          "} catch {}",
          "try { WeakMap.prototype.get = () => undefined; } catch {}",
          "try { WeakMap.prototype.set = function () { return this; }; } catch {}",
          "export function create(context, args) {",
          "  void context.db.patch(args.id, { status: \"written\" });",
          '  return "must-not-succeed";',
          "}",
          "",
        ].join("\n")
      : [
      "export function create(context, args) {",
      '  return context.db.insert("users", args);',
      "}",
      "",
    ].join("\n"),
  });
  return Object.freeze({
    execution: [
      'import { action } from "flarex/server";',
      'import * as users from "../functions/users.js";',
      "export default { users: {",
      "  notify: action({ handler: users.notify }),",
      "} };",
      "",
    ].join("\n"),
    handlers: [
      "export async function notify(context, args) {",
      "  let denied = false;",
      '  try { await fetch("https://denied.example.com/"); } catch { denied = true; }',
      '  if (!denied) throw new Error("outbound unexpectedly succeeded");',
      '  return "denied:" + await context.runQuery("users:lookup", args);',
      "}",
      "",
    ].join("\n"),
  });
}


function sdkCapabilityMembers(): string {
  return `
    position = 0;
    expected = 0;
    descending = false;
    captured = "";
    queryStart(request, terminal) {
      if ("limit" in request) throw new Error("legacy limit leaked");
      if (request.table !== "users" || request.index !== "by_name") throw new Error("query request replaced");
      this.position = 0;
      this.descending = request.order === "desc";
      this.captured = request.range.expressions[0].value.token;
      this.expected = terminal.kind === "take" ? Math.min(280, terminal.count)
        : terminal.kind === "paginate" ? Math.min(280, terminal.numItems) : 280;
      this.total = terminal.kind === "take" ? this.expected : 280;
      return { kind: "ok", value: { queryId: "query-1" } };
    }
    async queryNext(id, maxResults) {
      await Promise.resolve();
      if (id !== "query-1" || maxResults < 1 || maxResults > 128) throw new Error("invalid query next");
      const count = Math.min(maxResults, this.total - this.position);
      const page = Array.from({ length: count }, () => {
        const ordinal = this.descending ? 279 - this.position : this.position;
        this.position++;
        return { ordinal, requested: maxResults, captured: this.captured };
      });
      return { kind: "ok", value: { page, isDone: count < maxResults,
        continueCursor: "cursor:" + this.position } };
    }
    queryCleanup(id) {
      if (id !== "query-1" || this.position !== this.expected) throw new Error("query did not drain");
      return { kind: "ok", value: null };
    }
  `;
}

async function executeDefinition(
  definition: ApplicationWorkerDefinition,
  entrypoint: string,
  request: unknown,
  capabilityKind: FunctionKind,
  options: Readonly<{
    readonly capabilityMembers?: string;
  }> = {},
): Promise<unknown> {
  const encodedRequest = JSON.stringify(request, (_key, value: unknown) => {
    if (typeof value === "bigint") return { __bigint: String(value) };
    if (value instanceof Uint8Array) return { __bytes: Array.from(value) };
    return value;
  });
  const workerCode = {
    compatibilityDate: definition.compatibilityDate,
    limits: capabilityKind === "action"
      ? definition.actionLimits
      : definition.transactionLimits,
    mainModule: definition.mainModule,
    modules: definition.modules,
    env: definition.env,
    globalOutbound: null,
  };
  const outerSource = `
import { RpcTarget } from "cloudflare:workers";
const workerCode = ${JSON.stringify(workerCode)};
const request = JSON.parse(${JSON.stringify(encodedRequest)}, (_key, value) =>
  value && typeof value === "object" && Array.isArray(value.__bytes)
    ? new Uint8Array(value.__bytes)
    : value && typeof value === "object" && typeof value.__bigint === "string"
    ? BigInt(value.__bigint)
    : value
);
class Capability extends RpcTarget {
  revalidate() {}
  readPointDocument(_tableName, _documentId) {
    return { kind: "present", document: { name: "Ada" } };
  }
  queryIndexRange() { return { documents: [], isDone: true }; }
  takeIncomingRelationSources(input) {
    return { sources: [], exhausted: true };
  }
  insertPointDocument() {
    return "1:00000000-0000-0000-0000-000000000002";
  }
  patchPointDocument() {}
  replacePointDocument() {}
  deletePointDocument() {}
  invoke(operation) {
    return operation.functionPath + ":" + operation.arguments.value;
  }
  ${options.capabilityMembers ?? ""}
}
export default {
  async fetch(_request, env) {
    try {
      const worker = env.LOADER.load(workerCode);
      const stub = worker.getEntrypoint(${JSON.stringify(entrypoint)});
      const result = await stub.run(request, new Capability());
      try { return Response.json(structuredClone(result)); }
      finally { result[Symbol.dispose]?.(); }
    } catch (error) {
      return Response.json({
        name: error?.name,
        message: error?.message,
        cause: error?.cause?.name,
        causeMessage: error?.cause?.message,
        nestedCause: error?.cause?.cause?.name,
      }, { status: 500 });
    }
  },
};
void ${JSON.stringify(capabilityKind)};
`;
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: true,
    script: outerSource,
    workerLoaders: { LOADER: {} },
  });
  instances.push(runtime);
  const response = await runtime.dispatchFetch("https://application.test/");
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function transactionRequest(
  target: ApplicationRuntimeTargetV1,
  argumentsValue: unknown,
  mode: "query" | "write",
  seedByte: number,
  tables: ReadonlyArray<Readonly<{
    readonly tableId: number;
    readonly logicalName: string;
  }>> = Object.freeze([
    Object.freeze({ tableId: 1, logicalName: "users" }),
  ]),
): unknown {
  return {
    format: APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
    target,
    auth: { kind: "anonymous" },
    arguments: argumentsValue,
    argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue)
      .semanticSizeBytes,
    tables,
    context: mode === "query"
      ? {
          mode,
          executionId: "query-execution",
          randomSeed: new Uint8Array(32).fill(seedByte),
          executionTime: 1_800_000_000_000,
          snapshotCommitSeq: 9n,
        }
      : {
          mode,
          executionId: "mutation-execution",
          logScopeId: "mutation-log-scope",
          randomSeed: new Uint8Array(32).fill(seedByte),
          executionTime: 1_800_000_000_000,
          initialCreationTimeCursor: 1_800_000_000_000,
        },
  };
}

async function executeLocalDisposalHarness(
  definition: ApplicationWorkerDefinition,
  kind: "query" | "action",
): Promise<unknown> {
  const coreModule = Object.keys(definition.modules).find(name =>
    name.endsWith("_core.js")
  );
  if (coreModule === undefined) throw new Error("Application core is missing.");
  const harnessModule = "application-disposal-harness.js";
  const operation = kind === "query"
    ? "executeApplicationTransactionWorkerV1"
    : "executeApplicationActionWorkerV1";
  const modules: Record<string, WorkerLoaderModule | string> = {
    ...definition.modules,
    [harnessModule]: {
      js: `
import { WorkerEntrypoint } from "cloudflare:workers";
import { ${operation} as execute } from ${JSON.stringify(`./${coreModule}`)};
export class ApplicationDisposalHarness extends WorkerEntrypoint {
  async run() {
    let disposals = 0;
    const errors = [];
    for (let index = 0; index < 2; index += 1) {
      const capability = {
        [Symbol.dispose]() { disposals += 1; },
      };
      try {
        await execute({
          request: null,
          capability,
          definition: null,
          loadExecution: () => Promise.reject(new Error("not reached")),
        });
      } catch (error) {
        errors.push(error?.name);
      }
    }
    return { disposals, errors };
  }
}
`,
    },
  };
  const workerCode = {
    compatibilityDate: definition.compatibilityDate,
    limits: kind === "action"
      ? definition.actionLimits
      : definition.transactionLimits,
    mainModule: harnessModule,
    modules,
    env: definition.env,
    globalOutbound: null,
  };
  const outerSource = `
export default {
  async fetch(_request, env) {
    const worker = env.LOADER.load(${JSON.stringify(workerCode)});
    const stub = worker.getEntrypoint("ApplicationDisposalHarness");
    const result = await stub.run();
    try { return Response.json(structuredClone(result)); }
    finally { result[Symbol.dispose]?.(); }
  },
};
`;
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: true,
    script: outerSource,
    workerLoaders: { LOADER: {} },
  });
  instances.push(runtime);
  const response = await runtime.dispatchFetch("https://application.test/");
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function digestBytes(): Uint8Array {
  return new Uint8Array(32).fill(12);
}

function hostPolicy(): EdgeActionHostPolicyFrameV1 {
  return {
    identity: EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    outboundGatewayIdentity: EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
    callbackBridgeIdentity: EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
    allowedOrigins: ["https://api.example.com"],
    cpuMilliseconds: 1_000,
    wallMilliseconds: 30_000,
    maximumSyscalls: 64,
    maximumOutboundRequests: 16,
    maximumConcurrentOutboundRequests: 4,
    maximumWorkerSubrequests: 64,
    maximumArgumentBytes: 1_048_576,
    maximumResultBytes: 1_048_576,
    maximumCallbackArgumentBytes: 1_048_576,
    maximumCallbackResultBytes: 1_048_576,
    maximumUrlBytes: 8_192,
    maximumMethodBytes: 32,
    maximumHeaderCount: 128,
    maximumHeaderBytes: 64 * 1_024,
    maximumStatusTextBytes: 1_024,
    maximumOutboundRequestBodyBytes: 1_048_576,
    maximumOutboundResponseBodyBytes: 8 * 1_048_576,
    maximumCumulativeOutboundBodyBytes: 16 * 1_048_576,
    cleanupDrainMilliseconds: 5_000,
    allowRunQuery: true,
    allowRunMutation: true,
    allowRunAction: false,
    allowRedirects: false,
    allowStreaming: false,
    allowAmbientCredentials: false,
    fixedInvocationTime: true,
    deterministicRandom: true,
    allowNondeterministicCrypto: false,
  };
}
