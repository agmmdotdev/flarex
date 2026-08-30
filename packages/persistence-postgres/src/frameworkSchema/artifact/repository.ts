import { copyBytes } from "@flarex/utils/bytes";
import { Result } from "effect";

import { copyCapturedFrameworkSchemaArtifactEvidence } from "./canonical";
import { FrameworkSchemaArtifactError } from "./errors";
import {
  FRAMEWORK_SCHEMA_ARTIFACT_FORMAT,
  FRAMEWORK_SCHEMA_ARTIFACT_VERSION,
  type FrameworkSchemaArtifact,
  type FrameworkSchemaArtifactIdentity,
} from "./model";

const preparedFrameworkSchemaArtifactAdmissionBrand: unique symbol = Symbol(
  "FlarexDB/PreparedFrameworkSchemaArtifactAdmission",
);

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

interface PreparedFrameworkSchemaArtifactAdmissionState
  extends FrameworkSchemaArtifactAdmissionEvidence {}

const preparedFrameworkSchemaArtifactAdmissionStates = new WeakMap<
  PreparedFrameworkSchemaArtifactAdmission,
  PreparedFrameworkSchemaArtifactAdmissionState
>();

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
