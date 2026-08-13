import {
  makeApplicationPointMutationJournalRpcSessionV1,
  runPointMutationRuntimeWithJournalSettlementV1,
} from "@flarex/executor/point-mutation-journal-rpc";
import {
  PointMutationExactRuntimeRunnerHostV1Error,
} from "@flarex/executor/point-mutation-exact-runtime-runner";
import type {
  PointMutationOccRuntimeNeutralRunnerInputV1,
  PointMutationOccRuntimeNeutralRunnerV1,
} from "@flarex/executor/internal/stored-attempt-authentication-v1";
import {
  PointMutationOccApplicationErrorV1,
  PointMutationOccUserCodeV1Error,
} from "@flarex/executor/internal/stored-attempt-authentication-v1";
import {
  inspectApplicationMutationCommitAuthorityGraph,
} from "@flarex/persistence-postgres/internal/application-mutation-commit-authority-graph";
import { Effect } from "effect";
import {
  APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
  decodeApplicationTransactionWorkerRequestV1Effect,
  type ApplicationTransactionWorkerRequestV1,
} from "flarex-protocol/internal/application-worker-v1";
import {
  POINT_MUTATION_ARGUMENT_ARRAY_OVERHEAD_SEMANTIC_BYTES_V1,
} from "flarex-protocol/point-mutation-start";
import type {
  TransactionGrantInertAuthV1,
} from "flarex-protocol/transaction-grant";
import {
  FlarexValueCodecV1Error,
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueJsonV1,
} from "flarex-protocol/value";
import {
  ApplicationExecutionHostApplicationError,
  ApplicationExecutionHostError,
  type ApplicationExecutionHost,
} from "flarex-backend/internal/application-execution-host";
import type {
  ApplicationAnalysisSourceReader,
} from "flarex-backend/internal/application-analysis-source-reader";
import {
  makeApplicationWorkerDefinition,
} from "flarex-backend/internal/application-worker-definition";

import {
  applicationTransactionWorkerDefinitionPolicy,
  type ApplicationTransactionWorkerDefinitionPolicy,
} from "./ApplicationTransactionWorkerDefinitionPolicy";

export interface ApplicationMutationRunnerLive {
  readonly legacy: PointMutationOccRuntimeNeutralRunnerV1;
  readonly source: ApplicationAnalysisSourceReader;
  readonly host: Pick<ApplicationExecutionHost, "runTransaction">;
}

interface CapturedApplicationMutationRunnerLive {
  readonly legacy: PointMutationOccRuntimeNeutralRunnerV1;
  readonly source: ApplicationAnalysisSourceReader;
  readonly host: Pick<ApplicationExecutionHost, "runTransaction">;
}

type ApplicationRunnerInput = Extract<
  PointMutationOccRuntimeNeutralRunnerInputV1,
  { readonly executionAuthorityGeneration: "application_v1" }
>;

/**
 * Creates the private generation-aware mutation runner used by AA-R6
 * checkpoint 2. Legacy and Application authority dispatch exactly once; the
 * Application branch owns only source/definition/Worker composition and binds
 * the existing attempt journal. It remains unwired from the Standard API.
 */
export function makeApplicationMutationRuntimeNeutralRunner(
  live: ApplicationMutationRunnerLive,
): Effect.Effect<PointMutationOccRuntimeNeutralRunnerV1> {
  return Effect.sync(() => captureLive(live)).pipe(
    Effect.flatMap(captured =>
      applicationTransactionWorkerDefinitionPolicy.pipe(
        Effect.map(policy => makeRunner(captured, policy)),
      )
    ),
  );
}

function makeRunner(
  live: CapturedApplicationMutationRunnerLive,
  policy: ApplicationTransactionWorkerDefinitionPolicy,
): PointMutationOccRuntimeNeutralRunnerV1 {
  const run: PointMutationOccRuntimeNeutralRunnerV1["run"] = Effect.fn(
    "ApplicationMutationRunner.run",
  )(function* (input) {
    if (input.executionAuthorityGeneration === "legacy_dynamic_worker_v1") {
      return yield* live.legacy.run(input);
    }
    return yield* runApplicationMutation(live, policy, input);
  });
  return Object.freeze({ run });
}

const runApplicationMutation = Effect.fn(
  "ApplicationMutationRunner.runApplication",
)(function* (
  live: CapturedApplicationMutationRunnerLive,
  policy: ApplicationTransactionWorkerDefinitionPolicy,
  input: ApplicationRunnerInput,
) {
  const graph = yield* Effect.try({
    try: () => inspectApplicationMutationCommitAuthorityGraph(
      input.applicationGraph,
    ),
    catch: cause => projectionFailure(cause),
  });
  const request = yield* projectRequest(input, graph.runtimeTarget);
  const source = yield* live.source.read(
    graph.runtimeTarget.sourceArtifactRootSha256,
  ).pipe(Effect.mapError(cause =>
    new PointMutationExactRuntimeRunnerHostV1Error({
      reason: "sourceArtifactLoadFailed",
      cause,
    })
  ));
  const definition = yield* Effect.try({
    try: () => makeApplicationWorkerDefinition({
      source,
      target: graph.runtimeTarget,
      manifest: graph.manifest,
      hostPolicy: policy.frame,
      hostPolicySha256: policy.sha256,
      compatibilityDate: graph.compatibilityDate,
    }),
    catch: cause =>
      new PointMutationExactRuntimeRunnerHostV1Error({
        reason: "workerDefinitionFailed",
        cause,
      }),
  });
  const session = yield* Effect.sync(() =>
    makeApplicationPointMutationJournalRpcSessionV1(
      input.journal,
      request.tables,
    )
  );
  const host = live.host.runTransaction({
    definition,
    request,
    capability: session.target,
  }).pipe(Effect.catchTags({
    ApplicationExecutionHostApplicationError: projectApplicationError,
    ApplicationExecutionHostError: projectHostError,
  }));
  return yield* runPointMutationRuntimeWithJournalSettlementV1(
    host,
    session.closeAndDrain,
  );
});

const projectRequest = Effect.fn(
  "ApplicationMutationRunner.projectRequest",
)(function* (
  input: ApplicationRunnerInput,
  target: ReturnType<
    typeof inspectApplicationMutationCommitAuthorityGraph
  >["runtimeTarget"],
): Effect.fn.Return<
  ApplicationTransactionWorkerRequestV1,
  PointMutationExactRuntimeRunnerHostV1Error
> {
  const normalizedArguments = yield* Effect.try({
    try: () => normalizeFlarexValueJsonV1(input.argumentsJson),
    catch: (cause): unknown => cause,
  }).pipe(Effect.catch((cause: unknown) =>
    cause instanceof FlarexValueCodecV1Error
      ? Effect.fail(projectionFailure(cause))
      : Effect.die(cause)
  ));
  if (
    !isCanonicalFlarexRuntimeObjectV1(normalizedArguments.value) ||
    normalizedArguments.semanticSizeBytes +
        POINT_MUTATION_ARGUMENT_ARRAY_OVERHEAD_SEMANTIC_BYTES_V1 !==
      input.argumentArraySemanticBytes
  ) {
    return yield* Effect.fail(projectionFailure(
      new Error("Authenticated mutation argument evidence mismatches."),
    ));
  }
  const candidate = {
    format: APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
    target,
    auth: projectAuth(input.verifiedGrant.payload.auth),
    arguments: normalizedArguments.value,
    argumentSemanticBytes: normalizedArguments.semanticSizeBytes,
    tables: input.stableBindings.map(binding => ({
      tableId: binding.tableId,
      logicalName: binding.logicalName,
    })),
    context: {
      mode: "write",
      executionId: input.context.executionId,
      logScopeId: input.context.logScopeId,
      randomSeed: input.context.randomSeed,
      executionTime: input.context.executionTime,
      initialCreationTimeCursor: input.context.initialCreationTimeCursor,
    },
  };
  return yield* decodeApplicationTransactionWorkerRequestV1Effect(candidate).pipe(
    Effect.mapError(projectionFailure),
  );
});

function projectAuth(auth: TransactionGrantInertAuthV1): unknown {
  switch (auth.kind) {
    case "anonymous":
      return { kind: "anonymous" };
    case "verifiedBearer":
      return {
        kind: "user",
        user: {
          ...structuredClone(auth.claims),
          tokenIdentifier: `${auth.issuer}|${auth.subject}`,
          subject: auth.subject,
          issuer: auth.issuer,
        },
      };
    case "trustedDev":
      return { ...auth };
  }
}

function projectApplicationError(
  error: ApplicationExecutionHostApplicationError,
): Effect.Effect<never, PointMutationOccApplicationErrorV1> {
  return Effect.fail(new PointMutationOccApplicationErrorV1(
    error.data === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, data: error.data },
  ));
}

function projectHostError(
  error: ApplicationExecutionHostError,
): Effect.Effect<
  never,
  PointMutationOccUserCodeV1Error |
    PointMutationExactRuntimeRunnerHostV1Error
> {
  return error.reason === "userCodeFailed"
    ? Effect.fail(new PointMutationOccUserCodeV1Error({
      cause: error.cause ?? error,
    }))
    : Effect.fail(new PointMutationExactRuntimeRunnerHostV1Error({
      reason: error.reason,
      cause: error.cause,
    }));
}

function projectionFailure(
  cause: unknown,
): PointMutationExactRuntimeRunnerHostV1Error {
  return new PointMutationExactRuntimeRunnerHostV1Error({
    reason: "requestProjectionInvalid",
    cause,
  });
}

function captureLive(
  live: ApplicationMutationRunnerLive,
): CapturedApplicationMutationRunnerLive {
  return Object.freeze({
    legacy: Object.freeze({ run: live.legacy.run }),
    source: Object.freeze({ read: live.source.read }),
    host: Object.freeze({ runTransaction: live.host.runTransaction }),
  });
}
