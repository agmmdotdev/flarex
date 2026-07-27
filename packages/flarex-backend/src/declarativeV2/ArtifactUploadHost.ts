import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import {
  isLowercaseUuidText,
  isNonEmptyString,
} from "@flarex/utils/strings";
import { Data, Result } from "effect";
import {
  encodeCanonicalJson,
  isJsonObjectFromUnknown,
} from "flarex-protocol/json";
import {
  makeDeploymentProjectScopeAuthorizerV1,
} from "../deploymentProjectScopeAuthorization";
import type {
  DeploymentProjectScopeLookupConfigurationV1Error,
} from "../deploymentProjectScopeLookup";
import type { DeploymentTransactionStorage } from "../deployment/Store";
import { deploymentObjectName } from "../routing";
import {
  makeSemanticArtifactV1AttemptStore,
} from "../semanticArtifactV1/AttemptStore";
import {
  makeSemanticArtifactV1FinalizedSourceProofFactory,
  type SemanticArtifactV1FinalizedSourceProofFactory,
} from "../semanticArtifactV1/FinalizedSourceProof";
import {
  makeSemanticArtifactV1R2Store,
} from "../semanticArtifactV1/R2Store";
import {
  captureSemanticArtifactV1RootConfiguration,
  type SemanticArtifactV1RootConfiguration,
} from "../semanticArtifactV1/RootConfiguration";
import {
  makeLiveSemanticArtifactV1Sha256,
} from "../semanticArtifactV1/Sha256";
import {
  makeSemanticArtifactV1SourceCorrelationReader,
} from "../semanticArtifactV1/SourceCorrelationReader";
import {
  makeSemanticArtifactV1UploadCore,
  SemanticArtifactV1InputError,
  type SemanticArtifactV1UploadCore,
} from "../semanticArtifactV1/UploadCore";
import {
  makeSourceArtifactV2AttemptStore,
} from "../sourceArtifactV2/AttemptStore";
import {
  makeSourceArtifactV2CheckpointReader,
  type SourceArtifactV2CheckpointReader,
} from "../sourceArtifactV2/CheckpointReader";
import {
  makeSourceArtifactV2SameIsolateFinalizedAttemptReadComposerV1,
  type SourceArtifactV2SameIsolateFinalizedAttemptReadConfigurationV1Error,
} from "../sourceArtifactV2/FinalizedAttemptReadComposer";
import {
  makeSourceArtifactV2R2Store,
} from "../sourceArtifactV2/R2Store";
import {
  makeLiveSourceArtifactV2Sha256,
} from "../sourceArtifactV2/Sha256";
import {
  makeSourceArtifactV2UploadCore,
  type SourceArtifactV2UploadCore,
} from "../sourceArtifactV2/UploadCore";
import type { Env } from "../types";

export class DeclarativeV2ArtifactUploadHostConfigurationV1Error
  extends Data.TaggedError(
    "DeclarativeV2ArtifactUploadHostConfigurationV1Error",
  )<{
    readonly reason:
      | "invalidDeploymentId"
      | "deploymentObjectNameMismatch"
      | "missingArtifactsBinding"
      | "invalidArtifactsBinding"
      | "missingSemanticRootConfiguration"
      | "invalidSemanticRootConfiguration"
      | "missingFinalizedSourceStoredBytes"
      | "invalidFinalizedSourceStoredBytes";
  }> {}

export class DeclarativeV2ArtifactUploadHostSemanticSelectorV1Error
  extends Data.TaggedError(
    "DeclarativeV2ArtifactUploadHostSemanticSelectorV1Error",
  )<{ readonly reason: "invalidSemanticUploadId" }> {}

export type DeclarativeV2ArtifactUploadHostConstructionV1Error =
  | DeclarativeV2ArtifactUploadHostConfigurationV1Error
  | DeploymentProjectScopeLookupConfigurationV1Error
  | SourceArtifactV2SameIsolateFinalizedAttemptReadConfigurationV1Error;

export type DeclarativeV2ArtifactUploadHostSemanticCoreV1Error =
  | DeclarativeV2ArtifactUploadHostSemanticSelectorV1Error
  | SemanticArtifactV1InputError;

export interface DeclarativeV2ArtifactUploadHostV1 {
  readonly source: SourceArtifactV2UploadCore;
  readonly sourceCheckpointReader: SourceArtifactV2CheckpointReader;
  readonly finalizedSourceProofs: SemanticArtifactV1FinalizedSourceProofFactory;
  readonly makeSemanticUploadCore: (
    semanticUploadId: unknown,
  ) => Result.Result<
    SemanticArtifactV1UploadCore,
    DeclarativeV2ArtifactUploadHostSemanticCoreV1Error
  >;
}

export interface DeclarativeV2ArtifactUploadHostV1Options {
  readonly deploymentId: unknown;
  readonly durableObjectName: unknown;
  readonly storage: DeploymentTransactionStorage;
  readonly env: Env;
}

export function makeDeclarativeV2ArtifactUploadHostV1(
  options: DeclarativeV2ArtifactUploadHostV1Options,
): Result.Result<
  DeclarativeV2ArtifactUploadHostV1,
  DeclarativeV2ArtifactUploadHostConstructionV1Error
> {
  return Result.gen(function* () {
    const deploymentId = yield* captureDeploymentId(options.deploymentId);
    yield* verifyDeploymentObjectOwnership(
      deploymentId,
      options.durableObjectName,
    );
    const artifacts = yield* requireArtifacts(options.env);
    const rootConfiguration = yield* captureRootConfiguration(options.env);
    const maximumStoredBytes = yield* captureMaximumStoredBytes(options.env);
    const scopeAuthorizer = yield* makeDeploymentProjectScopeAuthorizerV1(
      options.env,
    );

    const sourceSha256 = makeLiveSourceArtifactV2Sha256();
    const semanticSha256 = makeLiveSemanticArtifactV1Sha256();
    const sql = options.storage.sql;
    const sourceAttempts = makeSourceArtifactV2AttemptStore(
      options.storage,
      sql,
    );
    const sourceCheckpointReader = makeSourceArtifactV2CheckpointReader(
      sql,
    );
    const source = makeSourceArtifactV2UploadCore({
      deploymentId,
      attempts: sourceAttempts,
      objects: makeSourceArtifactV2R2Store(artifacts, sourceSha256),
      sha256: sourceSha256,
    });
    const finalizedSourceReader =
      yield* makeSourceArtifactV2SameIsolateFinalizedAttemptReadComposerV1({
        authorizer: scopeAuthorizer,
        checkpointReader: sourceCheckpointReader,
        sha256: sourceSha256,
        maximumStoredBytes,
      });
    const finalizedSourceProofs =
      makeSemanticArtifactV1FinalizedSourceProofFactory({
        authorizer: scopeAuthorizer,
        finalizedSourceReader,
      });
    const semanticAttempts = makeSemanticArtifactV1AttemptStore(
      options.storage,
      sql,
    );
    const semanticObjects = makeSemanticArtifactV1R2Store(
      artifacts,
      semanticSha256,
    );
    const sourceCorrelation = makeSemanticArtifactV1SourceCorrelationReader(
      sql,
    );
    const makeSemanticUploadCore = (
      semanticUploadId: unknown,
    ): Result.Result<
      SemanticArtifactV1UploadCore,
      DeclarativeV2ArtifactUploadHostSemanticCoreV1Error
    > => {
      if (
        typeof semanticUploadId !== "string" ||
        !isLowercaseUuidText(semanticUploadId)
      ) {
        return Result.fail(
          new DeclarativeV2ArtifactUploadHostSemanticSelectorV1Error({
            reason: "invalidSemanticUploadId",
          }),
        );
      }
      return makeSemanticArtifactV1UploadCore({
        proofFactory: finalizedSourceProofs,
        sourceAttemptReader: sourceCorrelation,
        attemptStore: semanticAttempts,
        r2: semanticObjects,
        sha256: semanticSha256,
        rootConfiguration,
        makeUploadId: () => semanticUploadId,
      });
    };
    return Object.freeze({
      source,
      sourceCheckpointReader,
      finalizedSourceProofs,
      makeSemanticUploadCore,
    });
  });
}

function captureDeploymentId(
  value: unknown,
): Result.Result<
  string,
  DeclarativeV2ArtifactUploadHostConfigurationV1Error
> {
  return isNonEmptyString(value)
    ? Result.succeed(value)
    : configurationFailure("invalidDeploymentId");
}

function verifyDeploymentObjectOwnership(
  deploymentId: string,
  durableObjectName: unknown,
): Result.Result<
  void,
  DeclarativeV2ArtifactUploadHostConfigurationV1Error
> {
  return durableObjectName === deploymentObjectName(deploymentId)
    ? Result.succeed(undefined)
    : configurationFailure("deploymentObjectNameMismatch");
}

function requireArtifacts(
  env: Env,
): Result.Result<
  R2Bucket,
  DeclarativeV2ArtifactUploadHostConfigurationV1Error
> {
  const artifacts = env.ARTIFACTS;
  if (artifacts === undefined) {
    return configurationFailure("missingArtifactsBinding");
  }
  if (
    artifacts === null ||
    (typeof artifacts !== "object" && typeof artifacts !== "function")
  ) {
    return configurationFailure("invalidArtifactsBinding");
  }
  let get: unknown;
  let put: unknown;
  try {
    get = Reflect.get(artifacts, "get");
    put = Reflect.get(artifacts, "put");
  } catch {
    return configurationFailure("invalidArtifactsBinding");
  }
  return typeof get === "function" && typeof put === "function"
    ? Result.succeed(artifacts)
    : configurationFailure("invalidArtifactsBinding");
}

function captureRootConfiguration(
  env: Env,
): Result.Result<
  SemanticArtifactV1RootConfiguration,
  DeclarativeV2ArtifactUploadHostConfigurationV1Error
> {
  const text = env.FLAREX_SEMANTIC_ARTIFACT_V1_ROOT_CONFIGURATION;
  if (text === undefined) {
    return configurationFailure("missingSemanticRootConfiguration");
  }
  if (typeof text !== "string") {
    return configurationFailure("invalidSemanticRootConfiguration");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return configurationFailure("invalidSemanticRootConfiguration");
  }
  if (!isJsonObjectFromUnknown(parsed)) {
    return configurationFailure("invalidSemanticRootConfiguration");
  }
  const captured = captureSemanticArtifactV1RootConfiguration(parsed);
  if (Result.isFailure(captured)) {
    return configurationFailure("invalidSemanticRootConfiguration");
  }
  if (encodeCanonicalJson(parsed, rootConfigurationInvariantDefect) !== text) {
    return configurationFailure("invalidSemanticRootConfiguration");
  }
  return Result.succeed(captured.success);
}

function captureMaximumStoredBytes(
  env: Env,
): Result.Result<
  number,
  DeclarativeV2ArtifactUploadHostConfigurationV1Error
> {
  const text =
    env.FLAREX_SOURCE_ARTIFACT_V2_FINALIZED_READ_MAXIMUM_STORED_BYTES;
  if (text === undefined) {
    return configurationFailure("missingFinalizedSourceStoredBytes");
  }
  if (typeof text !== "string" || !/^[1-9][0-9]*$/.test(text)) {
    return configurationFailure("invalidFinalizedSourceStoredBytes");
  }
  const value = Number(text);
  return isPositiveSafeInteger(value)
    ? Result.succeed(value)
    : configurationFailure("invalidFinalizedSourceStoredBytes");
}

function configurationFailure(
  reason: DeclarativeV2ArtifactUploadHostConfigurationV1Error["reason"],
): Result.Result<
  never,
  DeclarativeV2ArtifactUploadHostConfigurationV1Error
> {
  return Result.fail(
    new DeclarativeV2ArtifactUploadHostConfigurationV1Error({ reason }),
  );
}

function rootConfigurationInvariantDefect(): never {
  throw new Error(
    "Captured Semantic Artifact V1 root configuration lost JSON membership.",
  );
}
