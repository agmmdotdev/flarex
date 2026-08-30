import { copyBytes } from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Result } from "effect";

import type { FlarexMetadataDatabase } from "../../deployments";
import { copyCapturedFrameworkSchemaArtifactEvidence } from "./canonical";
import type { FrameworkSchemaArtifactControlSessionStarter } from
  "./controlSession";
import {
  FrameworkSchemaArtifactError,
  FrameworkSchemaArtifactRepositoryConfigurationError,
} from "./errors";
import {
  FRAMEWORK_SCHEMA_ARTIFACT_FORMAT,
  FRAMEWORK_SCHEMA_ARTIFACT_VERSION,
  type FrameworkSchemaArtifact,
  type FrameworkSchemaArtifactIdentity,
} from "./model";

const preparedFrameworkSchemaArtifactAdmissionBrand: unique symbol = Symbol(
  "FlarexDB/PreparedFrameworkSchemaArtifactAdmission",
);
const frameworkSchemaArtifactRepositoryBrand: unique symbol = Symbol(
  "FlarexDB/FrameworkSchemaArtifactRepository",
);
const MAXIMUM_FRAMEWORK_SCHEMA_ARTIFACT_TIMEOUT_MILLISECONDS = 60_000;

export interface PreparedFrameworkSchemaArtifactAdmission {
  readonly [preparedFrameworkSchemaArtifactAdmissionBrand]: true;
}

export interface FrameworkSchemaArtifactAdmissionEvidence {
  readonly artifact: FrameworkSchemaArtifact;
  readonly identity: FrameworkSchemaArtifactIdentity;
  readonly dependencies: readonly FrameworkSchemaArtifactIdentity[];
  readonly artifactSha256Bytes: Uint8Array;
  readonly canonicalByteLength: number;
  readonly canonicalBytes: Uint8Array;
  readonly frameFormat: typeof FRAMEWORK_SCHEMA_ARTIFACT_FORMAT;
  readonly frameVersion: typeof FRAMEWORK_SCHEMA_ARTIFACT_VERSION;
}

export interface FrameworkSchemaArtifactRepositoryTimeoutPolicy {
  readonly readTimeoutMilliseconds: number;
  readonly attemptTimeoutMilliseconds: number;
  readonly recoveryTimeoutMilliseconds: number;
  readonly lockTimeoutMilliseconds: number;
}

export interface MakeFrameworkSchemaArtifactRepositoryInput
  extends FrameworkSchemaArtifactRepositoryTimeoutPolicy
{
  readonly controlDb: FlarexMetadataDatabase;
  readonly controlSessionStarter:
    FrameworkSchemaArtifactControlSessionStarter;
}

export interface FrameworkSchemaArtifactRepository {
  readonly [frameworkSchemaArtifactRepositoryBrand]: true;
}

interface PreparedFrameworkSchemaArtifactAdmissionState
  extends FrameworkSchemaArtifactAdmissionEvidence {}

interface FrameworkSchemaArtifactRepositoryState {
  readonly controlDb: FlarexMetadataDatabase;
  readonly controlSessionStarter:
    FrameworkSchemaArtifactControlSessionStarter;
  readonly timeoutPolicy: FrameworkSchemaArtifactRepositoryTimeoutPolicy;
}

const preparedFrameworkSchemaArtifactAdmissionStates = new WeakMap<
  PreparedFrameworkSchemaArtifactAdmission,
  PreparedFrameworkSchemaArtifactAdmissionState
>();
const frameworkSchemaArtifactRepositoryStates = new WeakMap<
  object,
  FrameworkSchemaArtifactRepositoryState
>();

/** Construct one opaque repository identity after validating its fixed policy. */
export function makeFrameworkSchemaArtifactRepository(
  input: MakeFrameworkSchemaArtifactRepositoryInput,
): Result.Result<
  FrameworkSchemaArtifactRepository,
  FrameworkSchemaArtifactRepositoryConfigurationError
> {
  const timeoutPolicy = {
    readTimeoutMilliseconds: input.readTimeoutMilliseconds,
    attemptTimeoutMilliseconds: input.attemptTimeoutMilliseconds,
    recoveryTimeoutMilliseconds: input.recoveryTimeoutMilliseconds,
    lockTimeoutMilliseconds: input.lockTimeoutMilliseconds,
  } satisfies FrameworkSchemaArtifactRepositoryTimeoutPolicy;
  if (!isFrameworkSchemaArtifactRepositoryTimeoutPolicy(timeoutPolicy)) {
    return Result.fail(
      FrameworkSchemaArtifactRepositoryConfigurationError
        .invalidTimeoutPolicy(),
    );
  }

  const frozenTimeoutPolicy = Object.freeze(timeoutPolicy);
  const state = Object.freeze({
    controlDb: input.controlDb,
    controlSessionStarter: input.controlSessionStarter,
    timeoutPolicy: frozenTimeoutPolicy,
  } satisfies FrameworkSchemaArtifactRepositoryState);
  const repository = Object.freeze({
    [frameworkSchemaArtifactRepositoryBrand]: true,
  } satisfies FrameworkSchemaArtifactRepository);
  frameworkSchemaArtifactRepositoryStates.set(repository, state);
  return Result.succeed(repository);
}

/** Exact same-factory control-database composition check. */
export function hasFrameworkSchemaArtifactRepositoryComposition(
  repository: unknown,
  controlDb: FlarexMetadataDatabase,
): repository is FrameworkSchemaArtifactRepository {
  if (typeof repository !== "object" || repository === null) return false;
  const state = frameworkSchemaArtifactRepositoryStates.get(repository);
  return state?.controlDb === controlDb;
}

/** Authenticate and snapshot one captured artifact before any SQL is built. */
export function prepareFrameworkSchemaArtifactAdmission(
  artifact: FrameworkSchemaArtifact,
): Result.Result<
  PreparedFrameworkSchemaArtifactAdmission,
  FrameworkSchemaArtifactError
> {
  const captured = copyCapturedFrameworkSchemaArtifactEvidence(artifact);
  if (captured === undefined) {
    return Result.fail(
      FrameworkSchemaArtifactError.admissionInputInvalid(),
    );
  }

  const state = Object.freeze({
    artifact,
    identity: snapshotFrameworkSchemaArtifactIdentity(artifact.identity),
    dependencies: snapshotFrameworkSchemaArtifactIdentities(
      artifact.dependencies,
    ),
    artifactSha256Bytes: copyBytes(captured.artifactSha256Bytes),
    canonicalByteLength: captured.canonicalBytes.byteLength,
    canonicalBytes: copyBytes(captured.canonicalBytes),
    frameFormat: FRAMEWORK_SCHEMA_ARTIFACT_FORMAT,
    frameVersion: FRAMEWORK_SCHEMA_ARTIFACT_VERSION,
  } satisfies PreparedFrameworkSchemaArtifactAdmissionState);
  const prepared = Object.freeze({
    [preparedFrameworkSchemaArtifactAdmissionBrand]: true,
  } satisfies PreparedFrameworkSchemaArtifactAdmission);
  preparedFrameworkSchemaArtifactAdmissionStates.set(prepared, state);
  return Result.succeed(prepared);
}

/** Package-private detached evidence for future repository query construction. */
export function getPreparedFrameworkSchemaArtifactAdmissionEvidence(
  prepared: PreparedFrameworkSchemaArtifactAdmission,
): Result.Result<
  FrameworkSchemaArtifactAdmissionEvidence,
  FrameworkSchemaArtifactError
> {
  const state = preparedFrameworkSchemaArtifactAdmissionStates.get(prepared);
  if (state === undefined) {
    return Result.fail(
      FrameworkSchemaArtifactError.admissionInputInvalid(),
    );
  }
  return Result.succeed(Object.freeze({
    artifact: state.artifact,
    identity: snapshotFrameworkSchemaArtifactIdentity(state.identity),
    dependencies: snapshotFrameworkSchemaArtifactIdentities(
      state.dependencies,
    ),
    artifactSha256Bytes: copyBytes(state.artifactSha256Bytes),
    canonicalByteLength: state.canonicalByteLength,
    canonicalBytes: copyBytes(state.canonicalBytes),
    frameFormat: state.frameFormat,
    frameVersion: state.frameVersion,
  }));
}

function snapshotFrameworkSchemaArtifactIdentity(
  identity: FrameworkSchemaArtifactIdentity,
): FrameworkSchemaArtifactIdentity {
  return Object.freeze({
    deploymentId: identity.deploymentId,
    owner: identity.owner,
    lineageId: identity.lineageId,
    artifactSha256: identity.artifactSha256,
  });
}

function snapshotFrameworkSchemaArtifactIdentities(
  identities: readonly FrameworkSchemaArtifactIdentity[],
): readonly FrameworkSchemaArtifactIdentity[] {
  return Object.freeze(identities.map(
    snapshotFrameworkSchemaArtifactIdentity,
  ));
}

function isFrameworkSchemaArtifactRepositoryTimeoutPolicy(
  policy: FrameworkSchemaArtifactRepositoryTimeoutPolicy,
): boolean {
  return isFrameworkSchemaArtifactTimeout(policy.readTimeoutMilliseconds) &&
    isFrameworkSchemaArtifactTimeout(policy.attemptTimeoutMilliseconds) &&
    isFrameworkSchemaArtifactTimeout(policy.recoveryTimeoutMilliseconds) &&
    isFrameworkSchemaArtifactTimeout(policy.lockTimeoutMilliseconds) &&
    policy.lockTimeoutMilliseconds <= policy.attemptTimeoutMilliseconds &&
    policy.lockTimeoutMilliseconds <= policy.recoveryTimeoutMilliseconds;
}

function isFrameworkSchemaArtifactTimeout(value: unknown): value is number {
  return isPositiveSafeInteger(value) &&
    value <= MAXIMUM_FRAMEWORK_SCHEMA_ARTIFACT_TIMEOUT_MILLISECONDS;
}
