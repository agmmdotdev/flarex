import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  bytesEqualFullScan,
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Data, Effect, Exit, Result } from "effect";
import {
  canonicalizeApplicationActionExecutionAuthorityV1,
  type CanonicalApplicationActionExecutionAuthorityV1,
} from "flarex-protocol/internal/application-action-authority-v1";
import {
  encodeEdgeActionHostPolicyV1,
  type EdgeActionHostPolicyFrameV1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  decodeApplicationActionWorkerRequestV1Effect,
  type ApplicationActionWorkerRequestV1,
} from "flarex-protocol/internal/application-worker-v1";
import { canonicalizeApplicationRuntimeTargetV1 } from
  "flarex-protocol/internal/application-runtime-target-v1";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";

import type {
  ApplicationAnalysisSourceReader,
} from "../sourceArtifactV2/ApplicationAnalysisReader";
import {
  type ApplicationExecutionHost,
  type ApplicationExecutionHostError,
} from "./ApplicationExecutionHost";
import { APPLICATION_RUNTIME_HOST_IDENTITY } from
  "./ApplicationRuntimeMaterializer";
import { makeApplicationWorkerDefinition } from
  "./ApplicationWorkerDefinition";

const HOST_POLICY_ENCODING_BUDGET = Object.freeze({
  maximumOrigins: 1_024,
  maximumOriginBytes: 8_192,
  maximumCanonicalBytes: 1_048_576,
});

export class ApplicationActionCapabilitySessionError extends Data.TaggedError(
  "ApplicationActionCapabilitySessionError",
)<{
  readonly reason: "callbackFailed" | "cleanupUncertain";
  readonly cause?: unknown;
}> {}

export interface ApplicationActionCapabilitySession {
  readonly callback: object;
  readonly outbound: Fetcher;
  readonly closeAndDrain: Effect.Effect<
    void,
    ApplicationActionCapabilitySessionError
  >;
}

export class ApplicationActionRunnerCompositionError extends Data.TaggedError(
  "ApplicationActionRunnerCompositionError",
)<{
  readonly reason:
    | "invalidAuthority"
    | "invalidManifest"
    | "invalidRequest"
    | "runtimeHostMismatch"
    | "compatibilityDateMismatch"
    | "hostPolicyMismatch"
    | "sourceReadFailed"
    | "workerDefinitionFailed";
  readonly cause?: unknown;
}> {}

export type ApplicationActionRunnerError =
  | ApplicationActionRunnerCompositionError
  | ApplicationActionCapabilitySessionError
  | ApplicationExecutionHostError;

export interface ApplicationActionRunnerInput {
  readonly executionAuthority: CanonicalApplicationActionExecutionAuthorityV1;
  readonly manifest: ApplicationManifestV1;
  readonly runtimeHostIdentity: string;
  readonly admittedCompatibilityDate: string;
  readonly invocationCompatibilityDate: string;
  readonly request: ApplicationActionWorkerRequestV1;
  readonly capabilities: ApplicationActionCapabilitySession;
}

export interface ApplicationActionRunner {
  readonly run: (
    input: ApplicationActionRunnerInput,
  ) => Effect.Effect<CanonicalFlarexRuntimeValueV1, ApplicationActionRunnerError>;
}

export interface ApplicationActionRunnerConfig {
  readonly source: ApplicationAnalysisSourceReader;
  readonly host: ApplicationExecutionHost;
  readonly hostPolicy: EdgeActionHostPolicyFrameV1;
  readonly hostPolicySha256: Uint8Array;
  readonly sha256: (
    bytes: Uint8Array,
  ) => Effect.Effect<Uint8Array, unknown>;
}

export function makeApplicationActionRunner(
  config: ApplicationActionRunnerConfig,
): ApplicationActionRunner {
  const hostPolicy = Result.getOrThrow(encodeEdgeActionHostPolicyV1(
    config.hostPolicy,
    HOST_POLICY_ENCODING_BUDGET,
  )).frame;
  const hostPolicySha256 = copyBytes(config.hostPolicySha256);
  if (!isUint8ArrayWithByteLength(hostPolicySha256, 32)) {
    throw new Error("Application action host-policy digest is invalid.");
  }
  const source = Object.freeze({ read: config.source.read });
  const host = Object.freeze({
    runTransaction: config.host.runTransaction,
    runAction: config.host.runAction,
  });
  const sha256 = config.sha256;

  const run: ApplicationActionRunner["run"] = Effect.fn(
    "ApplicationActionRunner.run",
  )(function* (input) {
    return yield* Effect.uninterruptibleMask(restore =>
      restore(prepareInput(input).pipe(Effect.flatMap(prepared => runPrepared(
        prepared,
        source,
        host,
        hostPolicy,
        hostPolicySha256,
        sha256,
      )))).pipe(
        Effect.exit,
        Effect.flatMap(hostExit => input.capabilities.closeAndDrain.pipe(
          Effect.exit,
          Effect.flatMap(capabilityExit => resolveExits(
            hostExit,
            capabilityExit,
          )),
        )),
      )
    );
  });

  return Object.freeze({ run });
}

interface PreparedApplicationActionRunnerInput {
  readonly executionAuthority: CanonicalApplicationActionExecutionAuthorityV1;
  readonly manifest: ApplicationManifestV1;
  readonly manifestCanonicalBytes: Uint8Array;
  readonly runtimeHostIdentity: string;
  readonly admittedCompatibilityDate: string;
  readonly invocationCompatibilityDate: string;
  readonly request: ApplicationActionWorkerRequestV1;
  readonly capabilities: ApplicationActionCapabilitySession;
}

const prepareInput = Effect.fn("ApplicationActionRunner.prepareInput")(
  function* (
    input: ApplicationActionRunnerInput,
  ): Effect.fn.Return<
    PreparedApplicationActionRunnerInput,
    ApplicationActionRunnerCompositionError
  > {
    const executionAuthority = yield*
      canonicalizeApplicationActionExecutionAuthorityV1(
        input.executionAuthority.authorityJson,
      ).pipe(Effect.mapError(cause => compositionError(
        "invalidAuthority",
        cause,
      )));
    if (
      !bytesEqualFullScan(
        executionAuthority.canonicalBytes,
        input.executionAuthority.canonicalBytes,
      ) || !bytesEqualFullScan(
        executionAuthority.sha256,
        input.executionAuthority.sha256,
      )
    ) return yield* compositionError("invalidAuthority");
    const canonicalManifest = yield* Effect.fromResult(
      canonicalizeApplicationManifestV1(input.manifest).pipe(
        Result.mapError(cause => compositionError("invalidManifest", cause)),
      ),
    );
    const request = yield* decodeApplicationActionWorkerRequestV1Effect(
      input.request,
    ).pipe(Effect.mapError(cause => compositionError(
      "invalidRequest",
      cause,
    )));
    const authorityTarget = yield* Effect.fromResult(
      canonicalizeApplicationRuntimeTargetV1(
        executionAuthority.authority.runtimeTarget,
      ).pipe(Result.mapError(cause => compositionError(
        "invalidAuthority",
        cause,
      ))),
    );
    const requestTarget = yield* Effect.fromResult(
      canonicalizeApplicationRuntimeTargetV1(request.target).pipe(
        Result.mapError(cause => compositionError("invalidRequest", cause)),
      ),
    );
    if (authorityTarget.canonicalText !== requestTarget.canonicalText) {
      return yield* compositionError("invalidRequest");
    }
    return Object.freeze({
      executionAuthority,
      manifest: canonicalManifest.manifest,
      manifestCanonicalBytes: canonicalManifest.canonicalBytes,
      runtimeHostIdentity: input.runtimeHostIdentity,
      admittedCompatibilityDate: input.admittedCompatibilityDate,
      invocationCompatibilityDate: input.invocationCompatibilityDate,
      request,
      capabilities: input.capabilities,
    });
  },
);

const runPrepared = Effect.fn("ApplicationActionRunner.runPrepared")(
  function* (
    input: PreparedApplicationActionRunnerInput,
    source: ApplicationAnalysisSourceReader,
    host: ApplicationExecutionHost,
    hostPolicy: EdgeActionHostPolicyFrameV1,
    hostPolicySha256: Uint8Array,
    sha256: ApplicationActionRunnerConfig["sha256"],
  ): Effect.fn.Return<
    CanonicalFlarexRuntimeValueV1,
    ApplicationActionRunnerError
  > {
    if (input.runtimeHostIdentity !== APPLICATION_RUNTIME_HOST_IDENTITY) {
      return yield* compositionError("runtimeHostMismatch");
    }
    if (
      input.admittedCompatibilityDate !== input.invocationCompatibilityDate
    ) return yield* compositionError("compatibilityDateMismatch");
    const encodedPolicy = yield* Effect.fromResult(
      encodeEdgeActionHostPolicyV1(hostPolicy, HOST_POLICY_ENCODING_BUDGET)
        .pipe(Result.mapError(cause => compositionError(
          "hostPolicyMismatch",
          cause,
        ))),
    );
    const [actualPolicySha256, actualManifestSha256] = yield* Effect.all([
      sha256(encodedPolicy.canonicalBytes).pipe(Effect.mapError(cause =>
        compositionError("hostPolicyMismatch", cause)
      )),
      sha256(input.manifestCanonicalBytes).pipe(Effect.mapError(cause =>
        compositionError("invalidManifest", cause)
      )),
    ]);
    if (
      !bytesEqualFullScan(actualPolicySha256, hostPolicySha256) ||
      !bytesEqualFullScan(
        input.request.context.hostPolicySha256,
        hostPolicySha256,
      )
    ) return yield* compositionError("hostPolicyMismatch");
    if (hex(actualManifestSha256) !==
      input.executionAuthority.authority.runtimeTarget.manifestSha256) {
      return yield* compositionError("invalidManifest");
    }
    const sourceBundle = yield* source.read(
      input.executionAuthority.authority.runtimeTarget.sourceArtifactRootSha256,
    ).pipe(Effect.mapError(cause => compositionError(
      "sourceReadFailed",
      cause,
    )));
    const definition = yield* Effect.try({
      try: () => makeApplicationWorkerDefinition({
        source: sourceBundle,
        target: input.executionAuthority.authority.runtimeTarget,
        manifest: input.manifest,
        hostPolicy,
        hostPolicySha256: copyBytes(hostPolicySha256),
        compatibilityDate: input.admittedCompatibilityDate,
      }),
      catch: cause => compositionError("workerDefinitionFailed", cause),
    });
    return yield* host.runAction({
      definition,
      request: input.request,
      callback: input.capabilities.callback,
      outbound: input.capabilities.outbound,
    });
  },
);

function resolveExits(
  hostExit: Exit.Exit<
    CanonicalFlarexRuntimeValueV1,
    ApplicationActionRunnerError
  >,
  capabilityExit: Exit.Exit<void, ApplicationActionCapabilitySessionError>,
): Effect.Effect<CanonicalFlarexRuntimeValueV1, ApplicationActionRunnerError> {
  if (Exit.isFailure(capabilityExit)) {
    return Effect.failCause(capabilityExit.cause);
  }
  return Exit.isSuccess(hostExit)
    ? Effect.succeed(hostExit.value)
    : Effect.failCause(hostExit.cause);
}

function compositionError(
  reason: ApplicationActionRunnerCompositionError["reason"],
  cause?: unknown,
): ApplicationActionRunnerCompositionError {
  return new ApplicationActionRunnerCompositionError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function hex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}
