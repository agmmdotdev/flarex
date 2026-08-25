import { Cause, Effect, Exit, Fiber, Result } from "effect";

import {
  AppCreationTimeV1Schema,
} from "flarex-protocol/app-document";
import {
  decodeActivePointMutationTargetMetadataV1,
  preparePointMutationStartEvidenceV1,
  requirePointMutationArgumentSemanticSizeV1,
} from "flarex-protocol/point-mutation-start";
import {
  POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
  POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
  type PointMutationExactRuntimeHostFailureReasonV2,
} from "flarex-protocol/point-mutation-exact-runtime-host";
import {
  CatalogSchemaVersionIdSchema,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ReplacementScopeEpochV1Schema,
  ReplacementScopeIdV1Schema,
  SnapshotTokenSchema,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
  canonicalizeTransactionGrantPayloadV1,
  canonicalizeTransactionGrantProtectedHeaderV1,
  deriveInertTransactionGrantEvidenceV1,
  encodeTransactionGrantEd25519SignatureV1,
  type TransactionGrantInertAuthV1,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import {
  normalizeFlarexValueV1,
} from "flarex-protocol/value";

import {
  PointMutationExactRuntimeRunnerHostV1Error,
  makePointMutationExactRuntimeRunnerV1,
  type PointMutationExactRuntimeArtifactHostBindingV1,
} from "@flarex/executor/point-mutation-exact-runtime-runner";
import {
  makePointMutationExactRuntimeBindingRunnerV1,
} from "@flarex/executor/point-mutation-exact-runtime-binding";
import {
  InvalidPointMutationJournalCapabilityV1Error,
  type PointMutationJournalTableV1,
} from "../src/pointMutationJournal";
import type {
  PointMutationOccBoundJournalV1,
  PointMutationOccRuntimeNeutralRunnerInputV1,
} from "../src/storedAttemptAuthentication";
import {
  PointMutationOccApplicationErrorV1,
} from "../src/storedAttemptAuthentication";

const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_p02c2",
);
const SCOPE_ID = ReplacementScopeIdV1Schema.make(
  "scope_00000000-0000-4000-8000-000000000001",
);
const SCOPE_EPOCH = ReplacementScopeEpochV1Schema.make(
  "epoch_00000000-0000-4000-8000-000000000002",
);
const SCHEMA_VERSION_ID = CatalogSchemaVersionIdSchema.make("schema_p02c2");
const REVOCATION_EPOCH =
  TransactionAuthorizationRevocationEpochSchema.make(0n);
const FUNCTION_PATH = TransactionFunctionPathV1Schema.make("users:create");
const REQUEST_KEY = TransactionRequestKeyV1Schema.make("request:p02c2");
const CREATION_TIME = AppCreationTimeV1Schema.make(1_750_000_000_000);
const SOURCE_PACKAGE_HASH = "a".repeat(64);
const ARGUMENTS = Object.freeze({ name: "Ada" });
const TARGET = decodeActivePointMutationTargetMetadataV1({
  format: "flarex.point-mutation-target-metadata",
  version: 1,
  deploymentId: DEPLOYMENT_ID,
  scopeId: SCOPE_ID,
  packageId: "package_p02c2",
  artifactRuntime: "dynamic-worker",
  artifactId: `artifact_${SOURCE_PACKAGE_HASH.slice(0, 32)}`,
  sourcePackageHash: SOURCE_PACKAGE_HASH,
  schemaVersionId: SCHEMA_VERSION_ID,
  functions: [{
    path: FUNCTION_PATH,
    executionModule: "flarex/users.ts",
    kind: "mutation",
    visibility: "public",
    argsValidator: { type: "any" },
    returnsValidator: { type: "any" },
  }],
  schemaManifest: {
    kind: "appSchema",
    manifestVersion: 1,
    tableDefinitions: {
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables: [{
        tableId: 1,
        namespace: "app",
        logicalName: "users",
        definition: {
          kind: "appDocument",
          definitionVersion: 1,
          documentType: { type: "object", value: {} },
        },
      }],
    },
    indexBindings: {
      kind: "indexBindings",
      sectionVersion: 1,
      indexes: [],
    },
  },
});

export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    switch (path) {
      case "/projection":
        return Response.json(
          await projectionScenario({ kind: "anonymous" }),
        );
      case "/verified-bearer":
        return Response.json(await projectionScenario({
          kind: "verifiedBearer",
          issuer: "https://issuer.example",
          subject: "subject-1",
          claims: {},
        }));
      case "/trusted-dev":
        return Response.json(await trustedDevScenario());
      case "/user-failure":
        return Response.json(await failureScenario("userCodeFailed"));
      case "/application-error":
        return Response.json(await applicationErrorScenario());
      case "/host-failure":
        return Response.json(await failureScenario("workerLoadFailed"));
      case "/invalid-response":
        return Response.json(await invalidResponseScenario());
      case "/transport":
        return Response.json(await rejectionScenario(true));
      case "/defect":
        return Response.json(await rejectionScenario(false));
      case "/journal-precedence":
        return Response.json(await journalPrecedenceScenario());
      case "/interruption":
        return Response.json(await interruptionScenario());
      default:
        return new Response("not found", { status: 404 });
    }
  },
};

async function projectionScenario(auth: TransactionGrantInertAuthV1) {
  let disposed = 0;
  const input = await makeInput(auth);
  const binding = bindingFrom(async (request) =>
    disposableResponse(successResponse({
      artifact: request.artifact,
      function: request.function,
      auth: request.auth,
      arguments: request.arguments,
      argumentArraySemanticBytes: request.argumentArraySemanticBytes,
      tables: request.tables,
      context: {
        executionId: request.context.executionId,
        logScopeId: request.context.logScopeId,
        randomSeed: Array.from(request.context.randomSeed),
        executionTime: request.context.executionTime,
        initialCreationTimeCursor:
          request.context.initialCreationTimeCursor,
      },
    }), () => {
      disposed += 1;
    })
  );
  const value = await Effect.runPromise(makeRunner(binding).run(input));
  return { disposed, value };
}

async function trustedDevScenario() {
  let calls = 0;
  const input = await makeInput({
    kind: "trustedDev",
    principal: "developer",
  });
  const binding = bindingFrom(async () => {
    calls += 1;
    return successResponse(null);
  });
  const exit = await Effect.runPromiseExit(makeRunner(binding).run(input));
  return { calls, outcome: summarizeExit(exit) };
}

async function failureScenario(
  reason: PointMutationExactRuntimeHostFailureReasonV2,
) {
  const input = await makeInput({ kind: "anonymous" });
  const exit = await Effect.runPromiseExit(
    makeRunner(bindingFrom(async () => failureResponse(reason))).run(input),
  );
  return summarizeExit(exit);
}

async function invalidResponseScenario() {
  let disposed = 0;
  const input = await makeInput({ kind: "anonymous" });
  const invalid = disposableResponse({
    format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
    version: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
    kind: "success",
    result: {
      format: "flarex.point-mutation-exact-runtime-result",
      version: 1,
      value: null,
    },
    unexpected: true,
  }, () => {
    disposed += 1;
  });
  const exit = await Effect.runPromiseExit(
    makeRunner(bindingFrom(async () => invalid)).run(input),
  );
  return { disposed, outcome: summarizeExit(exit) };
}

async function applicationErrorScenario() {
  const input = await makeInput({ kind: "anonymous" });
  const exit = await Effect.runPromiseExit(
    makeRunner(bindingFrom(async () => ({
      format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
      version: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
      kind: "applicationError",
      error: {
        code: "recipe-not-publishable",
        message: "Recipe is not publishable.",
        data: { recipeId: "recipe-1", missing: ["photo"] },
      },
    }))).run(input),
  );
  return summarizeExit(exit);
}

async function rejectionScenario(expectedTransport: boolean) {
  const input = await makeInput({ kind: "anonymous" });
  const rejection = new Error(
    expectedTransport ? "expected transport" : "remote defect",
  );
  const binding = bindingFrom(() => Promise.reject(rejection));
  const runner = expectedTransport
    ? makePointMutationExactRuntimeRunnerV1({
      binding,
      isExpectedTransportFailure: (cause) => cause === rejection,
    })
    : makePointMutationExactRuntimeBindingRunnerV1(binding);
  const exit = await Effect.runPromiseExit(runner.run(input));
  let identityPreserved = false;
  if (Exit.isFailure(exit)) {
    const defect = Cause.findDefect(exit.cause);
    identityPreserved =
      Result.isSuccess(defect) && defect.success === rejection;
  }
  return {
    identityPreserved,
    outcome: summarizeExit(exit),
  };
}

async function journalPrecedenceScenario() {
  const journalFailure =
    new InvalidPointMutationJournalCapabilityV1Error({
      capability: "attempt",
    });
  const input = await makeInput(
    { kind: "anonymous" },
    Object.freeze({
      resolvePointTable: () => Effect.fail(journalFailure),
      runPointOperation: () =>
        Effect.die(new Error("table operation must not run")),
      resolveDeveloperIndex: () =>
        Effect.die(new Error("index resolution must not run")),
      runIndexedQuery: () =>
        Effect.die(new Error("indexed query must not run")),
      resolveApplicationRelationRead: () =>
        Effect.die(new Error("relation resolution must not run")),
      runApplicationRelationIncomingRead: () =>
        Effect.die(new Error("relation read must not run")),
    }),
  );
  const binding = bindingFrom(async (_request, journal) => {
    try {
      await journal.resolvePointTable("users");
    } catch {
      // Model user code swallowing the redacted remote stop.
    }
    return failureResponse("userCodeFailed");
  });
  const exit = await Effect.runPromiseExit(makeRunner(binding).run(input));
  return {
    identityPreserved: Exit.isFailure(exit) &&
      exit.cause.reasons.some(
        (reason) => Cause.isFailReason(reason) && reason.error === journalFailure,
      ),
    outcome: summarizeExit(exit),
  };
}

async function interruptionScenario() {
  let capturedJournal:
    | Parameters<PointMutationExactRuntimeArtifactHostBindingV1["run"]>[1]
    | undefined;
  let settleHost: (() => void) | undefined;
  let resolveCalls = 0;
  // This fixture represents an already-resolved process-local table
  // capability. Its nominal brand is intentionally private to the journal
  // owner, so the workerd boundary test supplies only inert identity.
  const table = Object.freeze({}) as PointMutationJournalTableV1;
  const input = await makeInput(
    { kind: "anonymous" },
    Object.freeze({
      resolvePointTable: () => {
        resolveCalls += 1;
        return Effect.succeed(table);
      },
      runPointOperation: () =>
        Effect.die(new Error("table operation must not run")),
      resolveDeveloperIndex: () =>
        Effect.die(new Error("index resolution must not run")),
      runIndexedQuery: () =>
        Effect.die(new Error("indexed query must not run")),
      resolveApplicationRelationRead: () =>
        Effect.die(new Error("relation resolution must not run")),
      runApplicationRelationIncomingRead: () =>
        Effect.die(new Error("relation read must not run")),
    }),
  );
  const binding = bindingFrom((_request, journal) => {
    capturedJournal = journal;
    return new Promise((resolve) => {
      settleHost = () => resolve(successResponse(null));
    });
  });
  const fiber = Effect.runFork(makeRunner(binding).run(input));
  for (
    let index = 0;
    index < 20 && capturedJournal === undefined;
    index += 1
  ) {
    await Promise.resolve();
  }
  const completion = Effect.runPromise(Fiber.await(fiber));
  let interruptionFinished = false;
  const interruption = Effect.runPromise(Fiber.interrupt(fiber)).then(() => {
    interruptionFinished = true;
  });
  await Promise.resolve();
  const tableDuringPendingInterruption =
    await capturedJournal?.resolvePointTable("users");
  const interruptionWaitedForHost = !interruptionFinished;
  settleHost?.();
  await interruption;
  const exit = await completion;
  let lateCallRejected = false;
  try {
    await capturedJournal?.resolvePointTable("users");
  } catch {
    lateCallRejected = true;
  }
  return {
    interrupted: Exit.isFailure(exit) &&
      Cause.hasInterruptsOnly(exit.cause),
    admissionStayedOpen: resolveCalls === 1 &&
      tableDuringPendingInterruption !== undefined,
    interruptionWaitedForHost,
    lateCallRejected,
  };
}

function makeRunner(binding: PointMutationExactRuntimeArtifactHostBindingV1) {
  return makePointMutationExactRuntimeBindingRunnerV1(binding);
}

function bindingFrom(
  run: PointMutationExactRuntimeArtifactHostBindingV1["run"],
): PointMutationExactRuntimeArtifactHostBindingV1 {
  return Object.freeze({ run });
}

async function makeInput(
  auth: TransactionGrantInertAuthV1,
  journal: PointMutationOccBoundJournalV1 = inertJournal(),
): Promise<PointMutationOccRuntimeNeutralRunnerInputV1> {
  const prepared = await preparePointMutationStartEvidenceV1(
    TARGET,
    {
      deploymentId: DEPLOYMENT_ID,
      functionPath: FUNCTION_PATH,
      args: ARGUMENTS,
      requestKey: REQUEST_KEY,
    },
    REVOCATION_EPOCH,
  );
  const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    auth,
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  });
  const payload = await canonicalizeTransactionGrantPayloadV1({
    format: "flarex.transaction-grant",
    version: 1,
    grantId: "grant_p02c2",
    ...prepared.logicalPins,
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    identityAccessPolicySha256: policy.sha256Hex,
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    auth,
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:01:00.000Z",
    authorizationRevocationEpoch: REVOCATION_EPOCH.toString(),
  });
  const kid = TransactionGrantKeyIdV1Schema.make("key_p02c2");
  const header = canonicalizeTransactionGrantProtectedHeaderV1({
    alg: "Ed25519",
    kid,
    typ: "flarex-transaction-grant+jws",
  });
  const evidence = await deriveInertTransactionGrantEvidenceV1({
    protected: header.base64url,
    payload: payload.base64url,
    signature: encodeTransactionGrantEd25519SignatureV1(
      new Uint8Array(64),
    ),
  });
  const normalizedArguments = normalizeFlarexValueV1(ARGUMENTS);
  return Object.freeze({
    executionAuthorityGeneration: "legacy_dynamic_worker_v1",
    argumentsJson: prepared.validatedArguments.valueJson,
    argumentArraySemanticBytes:
      requirePointMutationArgumentSemanticSizeV1(
        normalizedArguments.semanticSizeBytes,
      ),
    verifiedGrant: Object.freeze({
      evidence,
      verificationKeyId: kid,
      verifiedAt: evidence.payload.issuedAt,
    }),
    schemaManifest: TARGET.schemaManifest,
    stableBindings: Object.freeze(
      TARGET.schemaManifest.tableDefinitions.tables.map((table) =>
        Object.freeze({
          logicalName: table.logicalName,
          tableId: table.tableId,
        })
      ),
    ),
    functionMetadata: TARGET.functions[0],
    context: Object.freeze({
      executionId: "execution_p02c2",
      logScopeId: "log_p02c2",
      randomSeed: new Uint8Array(32).fill(7),
      executionTime: CREATION_TIME,
      initialCreationTimeCursor: CREATION_TIME,
      attemptFence: TransactionAttemptFenceSchema.make(1n),
      snapshotToken: SnapshotTokenSchema.make({
        scopeId: SCOPE_ID,
        epoch: SCOPE_EPOCH,
        commitSeq: CommitSeqSchema.make(0n),
      }),
    }),
    journal,
  });
}

function inertJournal(): PointMutationOccBoundJournalV1 {
  return Object.freeze({
    resolvePointTable: () =>
      Effect.die(new Error("journal must not be called")),
    runPointOperation: () =>
      Effect.die(new Error("journal must not be called")),
    resolveDeveloperIndex: () =>
      Effect.die(new Error("journal must not be called")),
    runIndexedQuery: () =>
      Effect.die(new Error("journal must not be called")),
    resolveApplicationRelationRead: () =>
      Effect.die(new Error("journal must not be called")),
    runApplicationRelationIncomingRead: () =>
      Effect.die(new Error("journal must not be called")),
  });
}

function successResponse(value: unknown) {
  return {
    format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
    version: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
    kind: "success",
    result: {
      format: "flarex.point-mutation-exact-runtime-result",
      version: 1,
      value,
    },
  };
}

function failureResponse(
  reason: PointMutationExactRuntimeHostFailureReasonV2,
) {
  return {
    format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
    version: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
    kind: "failure",
    reason,
  };
}

function disposableResponse<T extends object>(
  value: T,
  dispose: () => void,
): T & Disposable {
  return { ...value, [Symbol.dispose]: dispose };
}

function summarizeExit(exit: Exit.Exit<unknown, unknown>) {
  if (Exit.isSuccess(exit)) {
    return { kind: "success", value: exit.value };
  }
  const failure = exit.cause.reasons.find(Cause.isFailReason);
  if (failure !== undefined && Cause.isFailReason(failure)) {
    const error = failure.error;
    return {
      kind: "failure",
      tag: errorTag(error),
      reason: error instanceof PointMutationExactRuntimeRunnerHostV1Error
        ? error.reason
        : undefined,
      code: error instanceof PointMutationOccApplicationErrorV1
        ? error.code
        : undefined,
      message: error instanceof PointMutationOccApplicationErrorV1
        ? error.message
        : undefined,
      data: error instanceof PointMutationOccApplicationErrorV1
        ? error.data
        : undefined,
    };
  }
  const defect = Cause.findDefect(exit.cause);
  if (Result.isSuccess(defect)) {
    return {
      kind: "defect",
      message: defect.success instanceof Error
        ? defect.success.message
        : String(defect.success),
    };
  }
  return {
    kind: exit.cause.reasons.some(Cause.isInterruptReason)
      ? "interrupted"
      : "unknown",
  };
}

function errorTag(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const tag = Reflect.get(error, "_tag");
  return typeof tag === "string" ? tag : undefined;
}
