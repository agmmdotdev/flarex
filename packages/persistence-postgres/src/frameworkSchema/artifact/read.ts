import { Effect, Result } from "effect";

import {
  FrameworkSchemaArtifactControlSessionDeadlineIssue,
  FrameworkSchemaArtifactControlSessionResourceIssue,
} from "./controlSession";
import {
  FrameworkSchemaArtifactError,
  FrameworkSchemaArtifactInvariantDefect,
} from "./errors";
import type {
  FrameworkSchemaArtifact,
  FrameworkSchemaArtifactIdentity,
} from "./model";
import {
  decodeFrameworkSchemaArtifactIdentityResult,
  type DecodedFrameworkSchemaArtifactIdentity,
} from "./policy";
import {
  runFrameworkSchemaArtifactRepositoryReadEffect,
  type FrameworkSchemaArtifactRepository,
} from "./repository";
import {
  loadStoredFrameworkSchemaArtifactEffect,
  type DetachedStoredFrameworkSchemaArtifact,
  type FrameworkSchemaArtifactStoredQueryIssue,
  type FrameworkSchemaArtifactStoredQueryStage,
} from "./storedLoader";
import {
  reconstructStoredFrameworkSchemaArtifactEffect,
  type FrameworkSchemaArtifactStoredIssue,
} from "./storedCodec";

type FrameworkSchemaArtifactReadWorkFailure =
  | FrameworkSchemaArtifactError
  | FrameworkSchemaArtifactStoredIssue
  | FrameworkSchemaArtifactStoredQueryIssue;

type FrameworkSchemaArtifactReadFailure =
  | FrameworkSchemaArtifactReadWorkFailure
  | FrameworkSchemaArtifactControlSessionDeadlineIssue
  | FrameworkSchemaArtifactControlSessionResourceIssue;

/** Private exact-identity artifact point read. */
export const getFrameworkSchemaArtifactEffect = Effect.fn(
  "FrameworkSchemaArtifactRepository.get",
)((
  repository: FrameworkSchemaArtifactRepository,
  identityInput: FrameworkSchemaArtifactIdentity,
): Effect.Effect<
  FrameworkSchemaArtifact | null,
  FrameworkSchemaArtifactError,
  never
> => Effect.suspend(() => {
  let activeQueryStage: FrameworkSchemaArtifactStoredQueryStage =
    "readArtifact";
  let artifactPresent = false;
  let decodedIdentity: DecodedFrameworkSchemaArtifactIdentity | undefined;

  return runFrameworkSchemaArtifactRepositoryReadEffect<
    DecodedFrameworkSchemaArtifactIdentity,
    DetachedStoredFrameworkSchemaArtifact | null,
    FrameworkSchemaArtifact | null,
    FrameworkSchemaArtifactReadWorkFailure
  >(repository, {
    prepareEffect: () => decodeIdentityEffect(identityInput).pipe(
      Effect.tap(decoded => Effect.sync(() => {
        decodedIdentity = decoded;
      })),
    ),
    queryAndDetachEffect: (database, preparation) =>
      loadStoredFrameworkSchemaArtifactEffect(database, {
        decodedIdentity: preparation,
        observePersistenceStage: stage => {
          activeQueryStage = stage;
        },
      }).pipe(Effect.tap(detached => Effect.sync(() => {
        artifactPresent = detached !== null;
      }))),
    reconstructEffect: (detached, preparation) =>
      detached === null
        ? Effect.succeed(null)
        : reconstructDetachedArtifactEffect(detached, preparation),
  }).pipe(Effect.mapError((failure: FrameworkSchemaArtifactReadFailure) =>
    mapReadFailure(
      failure,
      decodedIdentity?.identity,
      activeQueryStage,
      artifactPresent,
    )
  ));
}));

function decodeIdentityEffect(
  identityInput: FrameworkSchemaArtifactIdentity,
): Effect.Effect<
  DecodedFrameworkSchemaArtifactIdentity,
  FrameworkSchemaArtifactError,
  never
> {
  return Effect.fromResult(
    decodeFrameworkSchemaArtifactIdentityResult(identityInput).pipe(
      Result.mapError(() => FrameworkSchemaArtifactError.readInputInvalid()),
    ),
  );
}

function reconstructDetachedArtifactEffect(
  detached: DetachedStoredFrameworkSchemaArtifact,
  decodedIdentity: DecodedFrameworkSchemaArtifactIdentity,
): Effect.Effect<
  FrameworkSchemaArtifact,
  FrameworkSchemaArtifactStoredIssue,
  never
> {
  return reconstructStoredFrameworkSchemaArtifactEffect(
    decodedIdentity.identity,
    detached.artifactRow,
    detached.dependencyRows,
  );
}

function mapReadFailure(
  failure: FrameworkSchemaArtifactReadFailure,
  identity: FrameworkSchemaArtifactIdentity | undefined,
  activeQueryStage: FrameworkSchemaArtifactStoredQueryStage,
  artifactPresent: boolean,
): FrameworkSchemaArtifactError {
  if (failure instanceof FrameworkSchemaArtifactError) return failure;
  if (identity === undefined) {
    throw new FrameworkSchemaArtifactInvariantDefect({
      reason: "unexpectedReadFailure",
    });
  }
  if (failure instanceof FrameworkSchemaArtifactControlSessionDeadlineIssue) {
    return FrameworkSchemaArtifactError.readResourceFailure(
      identity,
      artifactPresent ? "reconstructArtifact" : activeQueryStage,
      failure,
    );
  }
  if (failure instanceof FrameworkSchemaArtifactControlSessionResourceIssue) {
    return FrameworkSchemaArtifactError.readResourceFailure(
      identity,
      activeQueryStage,
      failure,
    );
  }
  switch (failure._tag) {
    case "FrameworkSchemaArtifactStoredQueryIssue":
      return FrameworkSchemaArtifactError.readResourceFailure(
        identity,
        failure.persistenceStage,
        failure.cause,
      );
    case "FrameworkSchemaArtifactStoredCorruptionIssue":
      return FrameworkSchemaArtifactError.readStoredStateCorrupt(
        identity,
        failure.storedStage,
      );
    case "FrameworkSchemaArtifactStoredResourceIssue":
      return FrameworkSchemaArtifactError.readResourceFailure(
        identity,
        failure.persistenceStage,
        failure.cause,
      );
  }
}
