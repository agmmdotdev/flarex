import {
  bytesEqual,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Data, Effect, Result } from "effect";

import { detachUnknownDriverRows } from "../../detachDriverRows";
import { rowsFromDriverExecuteResult } from "../../driverExecuteResult";
import { runDrizzleStatementEffect } from "../../drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import { deployments } from "../../schema";
import type { FrameworkSchemaArtifactControlDecision } from "./controlSession";
import {
  FrameworkSchemaArtifactError,
  FrameworkSchemaArtifactInvariantDefect,
  type FrameworkSchemaArtifactPersistenceStage,
} from "./errors";
import type { FrameworkSchemaArtifact } from "./model";
import { MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES } from "./policy";
import {
  type FrameworkSchemaArtifactAdmissionEvidence,
  type FrameworkSchemaArtifactControlTransaction,
  type FrameworkSchemaArtifactRepository,
  withFrameworkSchemaArtifactRawControlTransactionEffect,
} from "./repository";
import {
  fxControlFrameworkSchemaArtifactDependencies,
  fxControlFrameworkSchemaArtifacts,
} from "./schema";
import { decodeStoredFrameworkSchemaArtifactStorageIdResult } from
  "./storedCodec";

export type FrameworkSchemaArtifactLockedAdmissionStage = Extract<
  FrameworkSchemaArtifactPersistenceStage,
  | "lockDeployment"
  | "readArtifact"
  | "readDependencies"
  | "insertArtifact"
  | "insertDependencies"
>;

export interface FrameworkSchemaArtifactLockedAdmissionInput {
  readonly evidence: FrameworkSchemaArtifactAdmissionEvidence;
  readonly observePersistenceStage: (
    stage: FrameworkSchemaArtifactLockedAdmissionStage,
  ) => void;
}

class FrameworkSchemaArtifactAdmissionDriverResultError extends
  Data.TaggedError("FrameworkSchemaArtifactAdmissionDriverResultError")<{
    readonly stage: FrameworkSchemaArtifactLockedAdmissionStage;
  }>
{}

const dependencyTargetArtifact = alias(
  fxControlFrameworkSchemaArtifacts,
  "fx_framework_artifact_admission_dependency_target",
);
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n;
const SHA256_BYTE_LENGTH = 32;

/**
 * Perform only compact evidence comparison and atomic writes while the
 * repository-owned deployment lock is held.
 */
export const runLockedFrameworkSchemaArtifactAdmissionEffect = Effect.fn(
  "FrameworkSchemaArtifactRepository.admitLocked",
)(function* (
  repository: FrameworkSchemaArtifactRepository,
  transaction: FrameworkSchemaArtifactControlTransaction,
  input: FrameworkSchemaArtifactLockedAdmissionInput,
): Effect.fn.Return<
  FrameworkSchemaArtifactControlDecision<FrameworkSchemaArtifact>,
  FrameworkSchemaArtifactError
> {
  return yield* withFrameworkSchemaArtifactRawControlTransactionEffect(
    repository,
    transaction,
    rawTransaction => Effect.gen(function* () {
      const evidence = input.evidence;
      const identity = evidence.identity;

      input.observePersistenceStage("lockDeployment");
      const deploymentQuery = rawTransaction.select({
        deploymentId: deployments.deploymentId,
      }).from(deployments).where(eq(
        deployments.deploymentId,
        identity.deploymentId,
      )).limit(1).for("update");
      const deploymentRows = yield* runAdmissionStatementEffect(
        deploymentQuery,
        evidence,
        "lockDeployment",
      );
      if (deploymentRows[0] === undefined) {
        return yield* Effect.fail(
          FrameworkSchemaArtifactError.admissionDeploymentMissing(
            identity.deploymentId,
          ),
        );
      }

      input.observePersistenceStage("readArtifact");
      const artifactQuery = rawTransaction.select({
        artifactStorageId:
          fxControlFrameworkSchemaArtifacts.artifactStorageId,
        exactFixedEvidence: sql<boolean>`(
          ${fxControlFrameworkSchemaArtifacts.frameFormat} =
            ${evidence.frameFormat}
          and ${fxControlFrameworkSchemaArtifacts.frameVersion} =
            ${evidence.frameVersion}
          and ${fxControlFrameworkSchemaArtifacts.canonicalByteLength} =
            ${evidence.canonicalByteLength}
          and octet_length(
            ${fxControlFrameworkSchemaArtifacts.canonicalBytes}
          ) = ${evidence.canonicalByteLength}
          and ${fxControlFrameworkSchemaArtifacts.canonicalBytes} =
            ${evidence.canonicalBytes}
          and isfinite(${fxControlFrameworkSchemaArtifacts.admittedAt})
        )`,
      }).from(fxControlFrameworkSchemaArtifacts).where(and(
        eq(
          fxControlFrameworkSchemaArtifacts.deploymentId,
          identity.deploymentId,
        ),
        eq(fxControlFrameworkSchemaArtifacts.owner, identity.owner),
        eq(
          fxControlFrameworkSchemaArtifacts.lineageId,
          identity.lineageId,
        ),
        eq(
          fxControlFrameworkSchemaArtifacts.artifactSha256,
          evidence.artifactSha256Bytes,
        ),
      )).limit(1);
      const artifactRows = yield* runAdmissionStatementEffect(
        artifactQuery,
        evidence,
        "readArtifact",
      );
      const artifactRow = artifactRows[0];
      if (artifactRow !== undefined) {
        const storageId = Result.getOrUndefined(
          decodeStoredFrameworkSchemaArtifactStorageIdResult(
            artifactRow.artifactStorageId,
          ),
        );
        if (
          artifactRow.exactFixedEvidence !== true ||
          storageId === undefined
        ) {
          return Object.freeze({ kind: "resolveExisting" });
        }
        const dependenciesExact = yield* compareLockedDependencyEvidenceEffect(
          rawTransaction,
          evidence,
          storageId,
          input.observePersistenceStage,
        );
        return dependenciesExact
          ? Object.freeze({
            kind: "existing",
            value: evidence.artifact,
          })
          : Object.freeze({ kind: "resolveExisting" });
      }

      const resolvedDependencies = yield* resolveDependenciesEffect(
        rawTransaction,
        evidence,
        input.observePersistenceStage,
      );

      input.observePersistenceStage("insertArtifact");
      const insertArtifactQuery = rawTransaction.insert(
        fxControlFrameworkSchemaArtifacts,
      ).values({
        deploymentId: identity.deploymentId,
        owner: identity.owner,
        lineageId: identity.lineageId,
        artifactSha256: evidence.artifactSha256Bytes,
        frameFormat: evidence.frameFormat,
        frameVersion: evidence.frameVersion,
        canonicalByteLength: evidence.canonicalByteLength,
        canonicalBytes: evidence.canonicalBytes,
      }).returning({
        artifactStorageId:
          fxControlFrameworkSchemaArtifacts.artifactStorageId,
      });
      const insertedRows = yield* runAdmissionStatementEffect(
        insertArtifactQuery,
        evidence,
        "insertArtifact",
      );
      const insertedStorageId = yield* Result.match(
        decodeStoredFrameworkSchemaArtifactStorageIdResult(
          insertedRows[0]?.artifactStorageId,
        ),
        {
          onFailure: () => Effect.die(
            new FrameworkSchemaArtifactInvariantDefect({
              reason: "unexpectedAdmissionFailure",
            }),
          ),
          onSuccess: Effect.succeed,
        },
      );

      if (resolvedDependencies.length > 0) {
        input.observePersistenceStage("insertDependencies");
        const insertDependenciesQuery = rawTransaction.insert(
          fxControlFrameworkSchemaArtifactDependencies,
        ).values(resolvedDependencies.map((dependency, ordinal) => ({
          artifactStorageId: insertedStorageId,
          dependencyStorageId: dependency.storageId,
          deploymentId: identity.deploymentId,
          owner: identity.owner,
          artifactLineageId: identity.lineageId,
          dependencyOrdinal: ordinal,
          dependencyLineageId: dependency.identity.lineageId,
        })));
        yield* runAdmissionStatementEffect(
          insertDependenciesQuery,
          evidence,
          "insertDependencies",
        );
      }

      return Object.freeze({
        kind: "created",
        value: evidence.artifact,
      });
    }),
  );
});

const compareLockedDependencyEvidenceEffect = Effect.fn(
  "FrameworkSchemaArtifactRepository.compareLockedDependencies",
)(function* (
  transaction: FlarexMetadataTransaction,
  evidence: FrameworkSchemaArtifactAdmissionEvidence,
  artifactStorageId: bigint,
  observePersistenceStage: (
    stage: FrameworkSchemaArtifactLockedAdmissionStage,
  ) => void,
): Effect.fn.Return<boolean, FrameworkSchemaArtifactError> {
  observePersistenceStage("readDependencies");
  const query = transaction.select({
    artifactStorageId:
      fxControlFrameworkSchemaArtifactDependencies.artifactStorageId,
    dependencyStorageId:
      fxControlFrameworkSchemaArtifactDependencies.dependencyStorageId,
    deploymentId:
      fxControlFrameworkSchemaArtifactDependencies.deploymentId,
    owner: fxControlFrameworkSchemaArtifactDependencies.owner,
    artifactLineageId:
      fxControlFrameworkSchemaArtifactDependencies.artifactLineageId,
    dependencyOrdinal:
      fxControlFrameworkSchemaArtifactDependencies.dependencyOrdinal,
    dependencyLineageId:
      fxControlFrameworkSchemaArtifactDependencies.dependencyLineageId,
    dependencyArtifactSha256: dependencyTargetArtifact.artifactSha256,
  }).from(fxControlFrameworkSchemaArtifactDependencies).leftJoin(
    dependencyTargetArtifact,
    and(
      eq(
        dependencyTargetArtifact.artifactStorageId,
        fxControlFrameworkSchemaArtifactDependencies.dependencyStorageId,
      ),
      eq(
        dependencyTargetArtifact.deploymentId,
        fxControlFrameworkSchemaArtifactDependencies.deploymentId,
      ),
      eq(
        dependencyTargetArtifact.owner,
        fxControlFrameworkSchemaArtifactDependencies.owner,
      ),
      eq(
        dependencyTargetArtifact.lineageId,
        fxControlFrameworkSchemaArtifactDependencies.dependencyLineageId,
      ),
    ),
  ).where(eq(
    fxControlFrameworkSchemaArtifactDependencies.artifactStorageId,
    artifactStorageId,
  )).orderBy(asc(
    fxControlFrameworkSchemaArtifactDependencies.dependencyOrdinal,
  )).limit(MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES + 1);
  const rows = yield* runAdmissionStatementEffect(
    query,
    evidence,
    "readDependencies",
  );
  if (rows.length !== evidence.dependencyEvidence.length) return false;

  const dependencyStorageIds = new Set<bigint>();
  for (let ordinal = 0; ordinal < rows.length; ordinal += 1) {
    const row = rows[ordinal];
    const expected = evidence.dependencyEvidence[ordinal];
    if (row === undefined || expected === undefined) return false;
    const dependencyStorageId = Result.getOrUndefined(
      decodeStoredFrameworkSchemaArtifactStorageIdResult(
        row.dependencyStorageId,
      ),
    );
    if (
      row.artifactStorageId !== artifactStorageId ||
      dependencyStorageId === undefined ||
      dependencyStorageId === artifactStorageId ||
      dependencyStorageIds.has(dependencyStorageId) ||
      row.deploymentId !== expected.identity.deploymentId ||
      row.owner !== expected.identity.owner ||
      row.artifactLineageId !== evidence.identity.lineageId ||
      row.dependencyOrdinal !== ordinal ||
      row.dependencyLineageId !== expected.identity.lineageId ||
      !isUint8ArrayWithByteLength(
        row.dependencyArtifactSha256,
        SHA256_BYTE_LENGTH,
      ) ||
      !bytesEqual(
        row.dependencyArtifactSha256,
        expected.artifactSha256Bytes,
      )
    ) {
      return false;
    }
    dependencyStorageIds.add(dependencyStorageId);
  }
  return true;
});

const resolveDependenciesEffect = Effect.fn(
  "FrameworkSchemaArtifactRepository.resolveDependencies",
)(function* (
  transaction: FlarexMetadataTransaction,
  evidence: FrameworkSchemaArtifactAdmissionEvidence,
  observePersistenceStage: (
    stage: FrameworkSchemaArtifactLockedAdmissionStage,
  ) => void,
): Effect.fn.Return<
  readonly ResolvedFrameworkSchemaArtifactDependency[],
  FrameworkSchemaArtifactError
> {
  if (evidence.dependencyEvidence.length === 0) {
    return Object.freeze([]);
  }

  observePersistenceStage("readDependencies");
  const requestedValues = sql.join(
    evidence.dependencyEvidence.map((dependency, ordinal) => sql`(
        ${ordinal}::integer,
        ${dependency.identity.deploymentId}::text,
        ${dependency.identity.owner}::text collate "C",
        ${dependency.identity.lineageId}::text collate "C",
        ${dependency.artifactSha256Bytes}::bytea
      )`),
    sql`, `,
  );
  const query = transaction.execute(sql`
      with requested(
        ordinal,
        deployment_id,
        owner,
        lineage_id,
        artifact_sha256
      ) as (values ${requestedValues})
      select
        requested.ordinal::text as "ordinalText",
        artifact.artifact_storage_id::text as "storageIdText"
      from requested
      left join fx_control_framework_schema_artifact as artifact
        on artifact.deployment_id = requested.deployment_id
        and artifact.owner = requested.owner
        and artifact.lineage_id = requested.lineage_id
        and artifact.artifact_sha256 = requested.artifact_sha256
      order by requested.ordinal asc
  `);
  const driverResult = yield* runAdmissionStatementEffect(
    query,
    evidence,
    "readDependencies",
  );
  const resolution = yield* Effect.fromResult(
    decodeDependencyResolutionResult(
      driverResult,
      evidence.dependencyEvidence,
    ).pipe(Result.mapError(cause =>
      FrameworkSchemaArtifactError.admissionResourceFailure(
        evidence.identity,
        "readDependencies",
        cause,
      )
    )),
  );
  if (resolution.kind === "missing") {
    return yield* Effect.fail(
      FrameworkSchemaArtifactError.admissionDependencyMissing(
        evidence.identity,
        resolution.identity,
        resolution.ordinal,
      ),
    );
  }
  return resolution.dependencies;
});

function runAdmissionStatementEffect<Value>(
  statement: PromiseLike<Value>,
  evidence: FrameworkSchemaArtifactAdmissionEvidence,
  stage: FrameworkSchemaArtifactLockedAdmissionStage,
): Effect.Effect<Value, FrameworkSchemaArtifactError, never> {
  return runDrizzleStatementEffect(
    statement,
    cause => FrameworkSchemaArtifactError.admissionResourceFailure(
      evidence.identity,
      stage,
      cause,
    ),
  );
}

type DependencyResolution =
  | Readonly<{
      readonly kind: "resolved";
      readonly dependencies:
        readonly ResolvedFrameworkSchemaArtifactDependency[];
    }>
  | Readonly<{
      readonly kind: "missing";
      readonly ordinal: number;
      readonly identity:
        FrameworkSchemaArtifactAdmissionEvidence["identity"];
    }>;

interface ResolvedFrameworkSchemaArtifactDependency {
  readonly identity: FrameworkSchemaArtifactAdmissionEvidence["identity"];
  readonly storageId: bigint;
}

function decodeDependencyResolutionResult(
  driverResult: unknown,
  dependencyEvidence:
    FrameworkSchemaArtifactAdmissionEvidence["dependencyEvidence"],
): Result.Result<
  DependencyResolution,
  unknown
> {
  const rowsResult = Result.try({
    try: () => detachUnknownDriverRows(rowsFromDriverExecuteResult(
      driverResult,
      () => {
        // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - raw Drizzle result adaptation requires a throwing invalid-result callback that Result.try maps into the admission resource channel
        throw admissionDriverResultError();
      },
    )),
    catch: cause => cause,
  });
  return Result.gen(function* () {
    const rows = yield* rowsResult;
    if (rows.length !== dependencyEvidence.length) {
      return yield* Result.fail(admissionDriverResultError());
    }
    const dependencies: ResolvedFrameworkSchemaArtifactDependency[] = [];
    for (
      const [ordinal, dependency] of dependencyEvidence.entries()
    ) {
      const row = rows[ordinal];
      if (
        !isNonArrayRecord(row) ||
        row.ordinalText !== String(ordinal)
      ) {
        return yield* Result.fail(admissionDriverResultError());
      }
      if (row.storageIdText === null) {
        return Object.freeze({
          kind: "missing" as const,
          ordinal,
          identity: dependency.identity,
        });
      }
      const storageId = decodeStorageIdText(row.storageIdText);
      if (storageId === undefined) {
        return yield* Result.fail(admissionDriverResultError());
      }
      dependencies.push(Object.freeze({
        identity: dependency.identity,
        storageId,
      }));
    }
    return Object.freeze({
      kind: "resolved" as const,
      dependencies: Object.freeze(dependencies),
    });
  });
}

function decodeStorageIdText(value: unknown): bigint | undefined {
  if (
    typeof value !== "string" ||
    value.length > 19 ||
    !/^[1-9][0-9]*$/u.test(value)
  ) {
    return undefined;
  }
  const storageId = BigInt(value);
  return storageId <= POSTGRES_BIGINT_MAXIMUM ? storageId : undefined;
}

function admissionDriverResultError():
  FrameworkSchemaArtifactAdmissionDriverResultError
{
  return new FrameworkSchemaArtifactAdmissionDriverResultError({
    stage: "readDependencies",
  });
}
