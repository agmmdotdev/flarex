import { Effect, Exit, Result } from "effect";
import {
  canonicalizeApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
  encodeEdgeActionHostPolicyV1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import { POINT_MUTATION_ARGUMENT_ARRAY_OVERHEAD_SEMANTIC_BYTES_V1 } from
  "flarex-protocol/point-mutation-start";
import type {
  PointMutationJournalTableV1,
} from "@flarex/executor/point-mutation-journal";
import type {
  PointMutationOccBoundJournalV1,
  PointMutationOccRuntimeNeutralRunnerInputV1,
} from "@flarex/executor/internal/application-point-mutation-runner";
import {
  makeApplicationPointMutationRunner,
} from "flarex-backend/internal/application-point-mutation-runner";
import { APPLICATION_RUNTIME_HOST_IDENTITY } from
  "../src/artifactRuntime/ApplicationRuntimeMaterializer";
import type {
  ApplicationTransactionExecutionHostInput,
} from "../src/artifactRuntime/ApplicationExecutionHost";
import { ApplicationExecutionHostError } from
  "../src/artifactRuntime/ApplicationExecutionHost";

export default {
  async fetch(): Promise<Response> {
    const fixture = applicationFixture();
    let sourceReads = 0;
    let hostCalls = 0;
    const observed: unknown[] = [];
    const policy = hostPolicy();
    const policyBytes = Result.getOrThrow(encodeEdgeActionHostPolicyV1(policy, {
      maximumOrigins: 1_024,
      maximumOriginBytes: 8_192,
      maximumCanonicalBytes: 1_048_576,
    })).canonicalBytes;
    const policySha256 = new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(policyBytes),
    ));
    const runner = makeApplicationPointMutationRunner({
      source: Object.freeze({
        read: (rootSha256: string) => {
          sourceReads += 1;
          return rootSha256 === fixture.source.sourceArtifact.rootSha256
            ? Effect.succeed(fixture.source)
            : Effect.die("wrong source root");
        },
      }),
      host: Object.freeze({
        runTransaction: (input: ApplicationTransactionExecutionHostInput) =>
          Effect.gen(function* () {
          hostCalls += 1;
          observed.push(structuredClone(input.request));
          if (hostCalls === 3) {
            return yield* Effect.fail(new ApplicationExecutionHostError({
              operation: "transaction",
              reason: "applicationError",
              applicationError: Object.freeze({
                code: "CLOSED",
                message: "closed",
                data: Object.freeze({ orderId: "1" }),
              }),
            }));
          }
          const capability = input.capability as {
            readonly revalidate: () => Promise<void>;
          };
          yield* Effect.promise(() => capability.revalidate());
          return Object.freeze({ hostCall: hostCalls });
          }),
        runAction: () => Effect.die("action must not run"),
      }),
      hostPolicy: policy,
      hostPolicySha256: policySha256,
      sha256: bytes => Effect.promise(async () =>
        new Uint8Array(await crypto.subtle.digest(
          "SHA-256",
          copyBytesToArrayBuffer(bytes),
        ))
      ),
    });
    const first = await Effect.runPromise(runner.run(runnerInput(fixture)));
    const second = await Effect.runPromise(runner.run(runnerInput(fixture)));
    const applicationError = await Effect.runPromiseExit(
      runner.run(runnerInput(fixture)),
    );
    const mismatchedInput = runnerInput(fixture);
    const runtimeHostMismatch = await Effect.runPromiseExit(runner.run({
      ...mismatchedInput,
      application: Object.freeze({
        ...mismatchedInput.application,
        runtimeHostIdentity: "wrong-runtime-host",
      }),
    }));
    const legacy = await Effect.runPromiseExit(runner.run({
      ...runnerInput(fixture),
      executionAuthorityGeneration: "legacy_dynamic_worker_v1",
    } as unknown as PointMutationOccRuntimeNeutralRunnerInputV1));
    return Response.json({
      first,
      second,
      sourceReads,
      hostCalls,
      observed,
      applicationError: failureReceipt(applicationError),
      runtimeHostMismatch: failureReceipt(runtimeHostMismatch),
      legacyTag: Exit.isFailure(legacy)
        ? legacy.cause.reasons.find(reason => reason._tag === "Fail")?.error?._tag
        : "success",
    });
  },
};

function runnerInput(
  fixture: ReturnType<typeof applicationFixture>,
): Extract<PointMutationOccRuntimeNeutralRunnerInputV1, {
  readonly executionAuthorityGeneration: "application_v1";
}> {
  const argumentsValue = Object.freeze({ name: "Ada" });
  return Object.freeze({
    executionAuthorityGeneration: "application_v1",
    argumentsJson: argumentsValue,
    argumentArraySemanticBytes:
      normalizeFlarexValueV1(argumentsValue).semanticSizeBytes +
      POINT_MUTATION_ARGUMENT_ARRAY_OVERHEAD_SEMANTIC_BYTES_V1,
    verifiedGrant: Object.freeze({
      verifiedAtEpochMilliseconds: 1_800_000_000_000,
      evidence: Object.freeze({
        payload: Object.freeze({
          auth: Object.freeze({
            kind: "verifiedBearer",
            issuer: "https://issuer.example",
            subject: "user-1",
            claims: Object.freeze({ name: "Ada" }),
          }),
        }),
      }),
    }),
    application: Object.freeze({
      manifest: fixture.manifest,
      runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
      compatibilityDate: "2026-06-14",
      executionAuthority: Object.freeze({
        format: "flarex.application-mutation-execution-authority",
        version: 1,
        runtimeTarget: fixture.target,
        runtimeTargetSha256: "3".repeat(64),
        activationSequence: "1",
        activeHeadSha256: "4".repeat(64),
        schemaVersionId: "schema-1",
      }),
      runtimeTarget: fixture.target,
      activationSequence: 1n,
      readinessSha256: new Uint8Array(32),
      activationSha256: new Uint8Array(32),
      activeHeadSha256: new Uint8Array(32),
      publicationSha256: new Uint8Array(32),
      functionEntrySha256: new Uint8Array(32),
      schemaBindingSha256: new Uint8Array(32),
    }),
    schemaManifest: Object.freeze({
      kind: "appSchema",
      manifestVersion: 1,
      tableDefinitions: Object.freeze({
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: Object.freeze([]),
      }),
      indexBindings: Object.freeze({
        kind: "indexBindings",
        sectionVersion: 1,
        indexes: Object.freeze([]),
      }),
    }),
    stableBindings: Object.freeze([{ tableId: 1, logicalName: "users" }]),
    context: Object.freeze({
      executionId: "execution-1",
      logScopeId: "log-1",
      randomSeed: new Uint8Array(32).fill(7),
      executionTime: 1_800_000_000_000,
      initialCreationTimeCursor: 1_800_000_000_000,
      attemptFence: 1n,
      snapshotToken: Object.freeze({ scopeId: "scope", epoch: 1n, commitSeq: 1n }),
    }),
    journal: inertJournal(),
  }) as unknown as Extract<PointMutationOccRuntimeNeutralRunnerInputV1, {
    readonly executionAuthorityGeneration: "application_v1";
  }>;
}

function failureReceipt(exit: Exit.Exit<unknown, unknown>): unknown {
  if (Exit.isSuccess(exit)) return "success";
  const failure = exit.cause.reasons.find(reason => reason._tag === "Fail")?.error;
  if (failure === undefined || typeof failure !== "object" || failure === null) {
    return "defect";
  }
  return {
    tag: Reflect.get(failure, "_tag"),
    reason: Reflect.get(failure, "reason"),
    code: Reflect.get(failure, "code"),
  };
}

function inertJournal(): PointMutationOccBoundJournalV1 {
  const table = Object.freeze({}) as PointMutationJournalTableV1;
  return Object.freeze({
    resolvePointTable: () => Effect.succeed(table),
    runPointOperation: () => Effect.die("journal must not run"),
    resolveDeveloperIndex: () => Effect.die("journal must not run"),
    runIndexedQuery: () => Effect.die("journal must not run"),
  });
}

function applicationFixture() {
  const execution = [
    'import { mutation } from "flarex/server";',
    'import * as users from "../functions/users.js";',
    "export default { users: { create: mutation({ handler: users.create }) } };",
    "",
  ].join("\n");
  const handler = "export function create(_ctx, args) { return args; }\n";
  const modules = Object.freeze([
    Object.freeze({
      path: "_flarex/application.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      sourceSha256: "b".repeat(64),
      sourceByteLength: new TextEncoder().encode(execution).byteLength,
      source: execution,
    }),
    Object.freeze({
      path: "functions/users.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      sourceSha256: "c".repeat(64),
      sourceByteLength: new TextEncoder().encode(handler).byteLength,
      source: handler,
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
  const manifest = Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: "flarex.application-manifest",
    version: 1,
    sourceArtifact,
    schema: { version: 1, tables: [], indexes: [] },
    functions: [{
      path: "users:create",
      moduleName: "users",
      exportName: "create",
      kind: "mutation",
      visibility: "public",
      args: { type: "any" },
      returns: { type: "any" },
      partition: null,
    }],
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

function hostPolicy() {
  return Object.freeze({
    identity: EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    outboundGatewayIdentity: EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
    callbackBridgeIdentity: EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
    allowedOrigins: Object.freeze([]),
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
    maximumHeaderBytes: 65_536,
    maximumStatusTextBytes: 1_024,
    maximumOutboundRequestBodyBytes: 1_048_576,
    maximumOutboundResponseBodyBytes: 8_388_608,
    maximumCumulativeOutboundBodyBytes: 16_777_216,
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
  });
}
