import {
  makeApplicationPointMutationJournalCapabilitySessionV1,
  type ApplicationPointMutationJournalCapabilitySessionV1,
} from "@flarex/executor/internal/application-point-mutation-journal-capability";
import {
  ApplicationPointMutationRunnerHostV1Error,
  PointMutationOccApplicationErrorV1,
  PointMutationOccUserCodeV1Error,
  type PointMutationOccRuntimeNeutralRunnerInputV1,
  type PointMutationOccRuntimeNeutralRunnerV1,
  type PointMutationOccRuntimeNeutralRunnerV1Error,
} from "@flarex/executor/internal/application-point-mutation-runner";
import {
  bytesEqualFullScan,
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Effect, Exit, Result } from "effect";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";
import {
  APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
  decodeApplicationTransactionWorkerRequestV1Effect,
  type ApplicationTransactionWorkerRequestV1,
  type ApplicationWorkerAuthV1,
} from "flarex-protocol/internal/application-worker-v1";
import type {
  TransactionGrantInertAuthV1,
} from "flarex-protocol/transaction-grant";
import { POINT_MUTATION_ARGUMENT_ARRAY_OVERHEAD_SEMANTIC_BYTES_V1 } from
  "flarex-protocol/point-mutation-start";
import type { EdgeActionHostPolicyFrameV1 } from
  "flarex-protocol/internal/edge-action-host-policy-v1";
import { encodeEdgeActionHostPolicyV1 } from
  "flarex-protocol/internal/edge-action-host-policy-v1";

import type {
  ApplicationAnalysisSourceReader,
} from "../sourceArtifactV2/ApplicationAnalysisReader";
import {
  ApplicationExecutionHostError,
  type ApplicationExecutionHost,
} from "./ApplicationExecutionHost";
import { APPLICATION_RUNTIME_HOST_IDENTITY } from
  "./ApplicationRuntimeMaterializer";
import {
  makeApplicationWorkerDefinition,
} from "./ApplicationWorkerDefinition";

export interface ApplicationPointMutationRunnerConfig {
  readonly source: ApplicationAnalysisSourceReader;
  readonly host: ApplicationExecutionHost;
  readonly hostPolicy: EdgeActionHostPolicyFrameV1;
  readonly hostPolicySha256: Uint8Array;
  readonly sha256: (
    bytes: Uint8Array,
  ) => Effect.Effect<Uint8Array, unknown>;
}

export function makeApplicationPointMutationRunner(
  config: ApplicationPointMutationRunnerConfig,
): PointMutationOccRuntimeNeutralRunnerV1 {
  const trustedHostPolicy = Result.getOrThrow(encodeEdgeActionHostPolicyV1(
    config.hostPolicy,
    {
      maximumOrigins: 1_024,
      maximumOriginBytes: 8_192,
      maximumCanonicalBytes: 1_048_576,
    },
  )).frame;
  const trustedHostPolicySha256 = copyBytes(config.hostPolicySha256);
  if (!isUint8ArrayWithByteLength(trustedHostPolicySha256, 32)) {
    throw new Error("Application point-mutation host-policy digest is invalid.");
  }
  const run = Effect.fn("ApplicationPointMutationRunner.run")(
    function* (input: PointMutationOccRuntimeNeutralRunnerInputV1) {
      if (input.executionAuthorityGeneration !== "application_v1") {
        return yield* new ApplicationPointMutationRunnerHostV1Error({
          reason: "requestProjectionInvalid",
        });
      }
      if (input.application.runtimeHostIdentity !==
        APPLICATION_RUNTIME_HOST_IDENTITY) {
        return yield* new ApplicationPointMutationRunnerHostV1Error({
          reason: "runtimeHostMismatch",
        });
      }
      const policyEncoding = yield* Effect.fromResult(
        encodeEdgeActionHostPolicyV1(trustedHostPolicy, {
          maximumOrigins: 1_024,
          maximumOriginBytes: 8_192,
          maximumCanonicalBytes: 1_048_576,
        }),
      ).pipe(Effect.mapError(cause =>
        new ApplicationPointMutationRunnerHostV1Error({
          reason: "workerDefinitionFailed",
          cause,
        })
      ));
      const actualPolicySha256 = yield* config.sha256(
        policyEncoding.canonicalBytes,
      ).pipe(
        Effect.mapError(cause =>
          new ApplicationPointMutationRunnerHostV1Error({
            reason: "workerDefinitionFailed",
            cause,
          })
        ),
      );
      if (!bytesEqualFullScan(actualPolicySha256, trustedHostPolicySha256)) {
        return yield* new ApplicationPointMutationRunnerHostV1Error({
          reason: "workerDefinitionFailed",
        });
      }
      const source = yield* config.source.read(
        input.application.runtimeTarget.sourceArtifactRootSha256,
      ).pipe(Effect.mapError(cause =>
        new ApplicationPointMutationRunnerHostV1Error({
          reason: "sourceReadFailed",
          cause,
        })
      ));
      const definition = yield* Effect.try({
        try: () => makeApplicationWorkerDefinition({
          source,
          target: input.application.runtimeTarget,
          manifest: input.application.manifest,
          hostPolicy: trustedHostPolicy,
          hostPolicySha256: copyBytes(trustedHostPolicySha256),
          compatibilityDate: input.application.compatibilityDate,
        }),
        catch: cause => new ApplicationPointMutationRunnerHostV1Error({
          reason: "workerDefinitionFailed",
          cause,
        }),
      });
      const request = yield* projectApplicationMutationRequest(input);
      const session = yield* Effect.sync(() =>
        makeApplicationPointMutationJournalCapabilitySessionV1(
          input.journal,
          input.stableBindings,
        )
      );
      return yield* runWithJournalSettlement(
        config.host,
        definition,
        request,
        session,
      );
    },
  );
  return Object.freeze({ run });
}

const projectApplicationMutationRequest = Effect.fn(
  "ApplicationPointMutationRunner.projectRequest",
)(function* (
  input: Extract<PointMutationOccRuntimeNeutralRunnerInputV1, {
    readonly executionAuthorityGeneration: "application_v1";
  }>,
): Effect.fn.Return<
  ApplicationTransactionWorkerRequestV1,
  ApplicationPointMutationRunnerHostV1Error
> {
  const candidate = {
    format: APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
    target: input.application.runtimeTarget,
    auth: projectApplicationAuth(input.verifiedGrant.evidence.payload.auth),
    arguments: input.argumentsJson,
    argumentSemanticBytes: input.argumentArraySemanticBytes -
      POINT_MUTATION_ARGUMENT_ARRAY_OVERHEAD_SEMANTIC_BYTES_V1,
    tables: input.stableBindings.map(binding => ({
      tableId: binding.tableId,
      logicalName: binding.logicalName,
    })),
    context: {
      mode: "write" as const,
      executionId: input.context.executionId,
      logScopeId: input.context.logScopeId,
      randomSeed: copyBytes(input.context.randomSeed),
      executionTime: input.context.executionTime,
      initialCreationTimeCursor: input.context.initialCreationTimeCursor,
    },
  };
  return yield* decodeApplicationTransactionWorkerRequestV1Effect(
    candidate,
  ).pipe(Effect.mapError(cause =>
    new ApplicationPointMutationRunnerHostV1Error({
      reason: "requestProjectionInvalid",
      cause,
    })
  ));
});

function projectApplicationAuth(
  auth: TransactionGrantInertAuthV1,
): ApplicationWorkerAuthV1 | TransactionGrantInertAuthV1 {
  switch (auth.kind) {
    case "anonymous":
      return Object.freeze({ kind: "anonymous" });
    case "verifiedBearer":
      return Object.freeze({
        kind: "user",
        user: Object.freeze({
          ...structuredClone(auth.claims),
          tokenIdentifier: auth.tokenIdentifier ??
            `${auth.issuer}|${auth.subject}`,
          subject: auth.subject,
          issuer: auth.issuer,
        }),
      });
    case "trustedDev":
      return Object.freeze({ ...auth });
  }
}

const runWithJournalSettlement = Effect.fn(
  "ApplicationPointMutationRunner.runWithJournalSettlement",
)(function* (
  host: ApplicationExecutionHost,
  definition: ReturnType<typeof makeApplicationWorkerDefinition>,
  request: ApplicationTransactionWorkerRequestV1,
  session: ApplicationPointMutationJournalCapabilitySessionV1,
): Effect.fn.Return<unknown, PointMutationOccRuntimeNeutralRunnerV1Error> {
  return yield* Effect.uninterruptibleMask(restore =>
    restore(host.runTransaction({
      definition,
      request,
      capability: session.target,
    }).pipe(Effect.mapError(mapHostFailure))).pipe(
      Effect.exit,
      Effect.flatMap(hostExit =>
        session.closeAndDrain.pipe(
          Effect.exit,
          Effect.flatMap(journalExit => resolveRunnerExits(
            hostExit,
            journalExit,
          )),
        )
      ),
    )
  );
});

function resolveRunnerExits(
  hostExit: Exit.Exit<
    CanonicalFlarexRuntimeValueV1,
    | ApplicationPointMutationRunnerHostV1Error
    | PointMutationOccApplicationErrorV1
    | PointMutationOccUserCodeV1Error
  >,
  journalExit: Exit.Exit<
    void,
    ApplicationPointMutationJournalCapabilitySessionV1["closeAndDrain"] extends
      Effect.Effect<void, infer ErrorValue> ? ErrorValue : never
  >,
): Effect.Effect<
  CanonicalFlarexRuntimeValueV1,
  PointMutationOccRuntimeNeutralRunnerV1Error
> {
  if (Exit.isFailure(journalExit)) {
    return Effect.failCause(journalExit.cause);
  }
  return Exit.isSuccess(hostExit)
    ? Effect.succeed(hostExit.value)
    : Effect.failCause(hostExit.cause);
}

function mapHostFailure(
  error: ApplicationExecutionHostError,
):
  | ApplicationPointMutationRunnerHostV1Error
  | PointMutationOccApplicationErrorV1
  | PointMutationOccUserCodeV1Error {
  if (error.reason === "applicationError") {
    const applicationError = error.applicationError;
    if (applicationError === undefined) {
      return new ApplicationPointMutationRunnerHostV1Error({
        reason: "invalidResult",
        cause: error,
      });
    }
    return new PointMutationOccApplicationErrorV1(
      applicationError.data === undefined
        ? { code: applicationError.code, message: applicationError.message }
        : {
            code: applicationError.code,
            message: applicationError.message,
            data: applicationError.data,
          },
    );
  }
  if (error.reason === "userCodeFailed") {
    return new PointMutationOccUserCodeV1Error({ cause: error.cause ?? error });
  }
  const reason = error.reason === "invalidRequest"
    ? "requestProjectionInvalid"
    : error.reason === "callbackFailed"
    ? "terminalFailed"
    : error.reason;
  return new ApplicationPointMutationRunnerHostV1Error({
    reason,
    cause: error.cause ?? error,
  });
}
