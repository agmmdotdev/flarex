import { copyBytes, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { and, asc, eq, gt } from "drizzle-orm";
import { Effect, Encoding, Result } from "effect";

import type { FlarexMetadataDatabase } from "../../deployments";
import { detachDriverRows } from "../../detachDriverRows";
import { runDrizzleStatementEffect } from "../../drizzleStatementEffect";
import {
  FrameworkSchemaArtifactControlSessionDeadlineIssue,
  FrameworkSchemaArtifactControlSessionResourceIssue,
} from "./controlSession";
import {
  FrameworkSchemaArtifactError,
  FrameworkSchemaArtifactInvariantDefect,
} from "./errors";
import type {
  FrameworkSchemaArtifactCoordinate,
  FrameworkSchemaArtifactIdentity,
  FrameworkSchemaArtifactIdentityPage,
  FrameworkSchemaArtifactSha256,
  ListFrameworkSchemaArtifactIdentitiesInput,
} from "./model";
import {
  compareFrameworkSchemaArtifactIdentities,
  decodeFrameworkSchemaArtifactIdentityResult,
  decodeFrameworkSchemaArtifactListInputResult,
  type DecodedFrameworkSchemaArtifactListInput,
} from "./policy";
import {
  runFrameworkSchemaArtifactRepositoryReadEffect,
  type FrameworkSchemaArtifactRepository,
} from "./repository";
import { fxControlFrameworkSchemaArtifacts } from "./schema";

const SHA256_BYTE_LENGTH = 32;

interface StoredFrameworkSchemaArtifactIdentityRow {
  readonly deploymentId: unknown;
  readonly owner: unknown;
  readonly lineageId: unknown;
  readonly artifactSha256: unknown;
}

type FrameworkSchemaArtifactListFailure =
  | FrameworkSchemaArtifactError
  | FrameworkSchemaArtifactControlSessionDeadlineIssue
  | FrameworkSchemaArtifactControlSessionResourceIssue;

/** Private bounded identity-only artifact discovery. */
export const listFrameworkSchemaArtifactIdentitiesEffect = Effect.fn(
  "FrameworkSchemaArtifactRepository.listIdentities",
)((
  repository: FrameworkSchemaArtifactRepository,
  input: ListFrameworkSchemaArtifactIdentitiesInput,
): Effect.Effect<
  FrameworkSchemaArtifactIdentityPage,
  FrameworkSchemaArtifactError,
  never
> => Effect.suspend(() => {
  let coordinate: FrameworkSchemaArtifactCoordinate | undefined;

  return runFrameworkSchemaArtifactRepositoryReadEffect<
    DecodedFrameworkSchemaArtifactListInput,
    readonly StoredFrameworkSchemaArtifactIdentityRow[],
    FrameworkSchemaArtifactIdentityPage,
    FrameworkSchemaArtifactError
  >(repository, {
    prepareEffect: () => Effect.fromResult(
      decodeFrameworkSchemaArtifactListInputResult(input).pipe(
        Result.mapError(() => FrameworkSchemaArtifactError.listInputInvalid()),
      ),
    ).pipe(
      Effect.tap(decoded => Effect.sync(() => {
        coordinate = decoded.coordinate;
      })),
    ),
    queryAndDetachEffect: (database, decoded) =>
      loadFrameworkSchemaArtifactIdentityRowsEffect(database, decoded),
    reconstructEffect: (rows, decoded) => Effect.fromResult(
      decodeFrameworkSchemaArtifactIdentityPageResult(rows, decoded),
    ),
  }).pipe(Effect.mapError((failure: FrameworkSchemaArtifactListFailure) =>
    mapFrameworkSchemaArtifactListFailure(failure, coordinate)
  ));
}));

const loadFrameworkSchemaArtifactIdentityRowsEffect = Effect.fn(
  "FrameworkSchemaArtifactRepository.listIdentityRows",
)(function* (
  database: FlarexMetadataDatabase,
  input: DecodedFrameworkSchemaArtifactListInput,
): Effect.fn.Return<
  readonly StoredFrameworkSchemaArtifactIdentityRow[],
  FrameworkSchemaArtifactError
> {
  const coordinate = input.coordinate;
  const afterArtifactSha256Bytes = input.afterArtifactSha256Bytes;
  const coordinateFilter = and(
    eq(
      fxControlFrameworkSchemaArtifacts.deploymentId,
      coordinate.deploymentId,
    ),
    eq(fxControlFrameworkSchemaArtifacts.owner, coordinate.owner),
    eq(fxControlFrameworkSchemaArtifacts.lineageId, coordinate.lineageId),
  );
  const filter = afterArtifactSha256Bytes === null
    ? coordinateFilter
    : and(
      coordinateFilter,
      gt(
        fxControlFrameworkSchemaArtifacts.artifactSha256,
        afterArtifactSha256Bytes,
      ),
    );
  const query = database.select({
    deploymentId: fxControlFrameworkSchemaArtifacts.deploymentId,
    owner: fxControlFrameworkSchemaArtifacts.owner,
    lineageId: fxControlFrameworkSchemaArtifacts.lineageId,
    artifactSha256: fxControlFrameworkSchemaArtifacts.artifactSha256,
  }).from(fxControlFrameworkSchemaArtifacts).where(filter).orderBy(asc(
    fxControlFrameworkSchemaArtifacts.artifactSha256,
  )).limit(input.limit + 1);

  const rows = yield* runDrizzleStatementEffect(
    query,
    cause => FrameworkSchemaArtifactError.listResourceFailure(
      coordinate,
      "listArtifacts",
      cause,
    ),
  );
  return detachDriverRows(rows);
});

function decodeFrameworkSchemaArtifactIdentityPageResult(
  rows: readonly StoredFrameworkSchemaArtifactIdentityRow[],
  input: DecodedFrameworkSchemaArtifactListInput,
): Result.Result<
  FrameworkSchemaArtifactIdentityPage,
  FrameworkSchemaArtifactError
> {
  return Result.gen(function* () {
    if (rows.length > input.limit + 1) {
      throw new FrameworkSchemaArtifactInvariantDefect({
        reason: "unexpectedListFailure",
      });
    }
    const identities: FrameworkSchemaArtifactIdentity[] = [];
    let previousIdentity: FrameworkSchemaArtifactIdentity | undefined =
      input.afterArtifactSha256 === null
      ? undefined
      : Object.freeze({
        ...input.coordinate,
        artifactSha256: input.afterArtifactSha256,
      });

    for (const row of rows) {
      const identity = yield* decodeStoredFrameworkSchemaArtifactIdentityResult(
        row,
        input.coordinate,
      );
      if (previousIdentity !== undefined) {
        const order = compareFrameworkSchemaArtifactIdentities(
          previousIdentity,
          identity,
        );
        if (order > 0 || (order === 0 && identities.length === 0)) {
          throw new FrameworkSchemaArtifactInvariantDefect({
            reason: "unexpectedListFailure",
          });
        }
        if (order === 0) {
          return yield* Result.fail(
            FrameworkSchemaArtifactError.listStoredStateCorrupt(
              input.coordinate,
            ),
          );
        }
      }
      identities.push(identity);
      previousIdentity = identity;
    }

    const items = Object.freeze(identities.slice(0, input.limit));
    let nextAfterArtifactSha256: FrameworkSchemaArtifactSha256 | null = null;
    if (identities.length > input.limit) {
      const finalItem = items.at(-1);
      if (finalItem === undefined) {
        throw new FrameworkSchemaArtifactInvariantDefect({
          reason: "unexpectedListFailure",
        });
      }
      nextAfterArtifactSha256 = finalItem.artifactSha256;
    }
    return Object.freeze({ items, nextAfterArtifactSha256 });
  });
}

function decodeStoredFrameworkSchemaArtifactIdentityResult(
  row: StoredFrameworkSchemaArtifactIdentityRow,
  coordinate: FrameworkSchemaArtifactCoordinate,
): Result.Result<
  FrameworkSchemaArtifactIdentity,
  FrameworkSchemaArtifactError
> {
  if (!isUint8ArrayWithByteLength(row.artifactSha256, SHA256_BYTE_LENGTH)) {
    return Result.fail(
      FrameworkSchemaArtifactError.listStoredStateCorrupt(coordinate),
    );
  }
  const artifactSha256 = Encoding.encodeHex(copyBytes(row.artifactSha256));
  return Result.gen(function* () {
    const decoded = yield* decodeFrameworkSchemaArtifactIdentityResult({
      deploymentId: row.deploymentId,
      owner: row.owner,
      lineageId: row.lineageId,
      artifactSha256,
    }).pipe(Result.mapError(() =>
      FrameworkSchemaArtifactError.listStoredStateCorrupt(coordinate)
    ));
    const identity = decoded.identity;
    if (
      identity.deploymentId !== coordinate.deploymentId ||
      identity.owner !== coordinate.owner ||
      identity.lineageId !== coordinate.lineageId
    ) {
      return yield* Result.fail(
        FrameworkSchemaArtifactError.listStoredStateCorrupt(coordinate),
      );
    }
    return identity;
  });
}

function mapFrameworkSchemaArtifactListFailure(
  failure: FrameworkSchemaArtifactListFailure,
  coordinate: FrameworkSchemaArtifactCoordinate | undefined,
): FrameworkSchemaArtifactError {
  if (failure instanceof FrameworkSchemaArtifactError) return failure;
  if (coordinate === undefined) {
    throw new FrameworkSchemaArtifactInvariantDefect({
      reason: "unexpectedListFailure",
    });
  }
  return FrameworkSchemaArtifactError.listResourceFailure(
    coordinate,
    "listArtifacts",
    failure,
  );
}
