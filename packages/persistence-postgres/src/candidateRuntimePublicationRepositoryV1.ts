import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { and, asc, eq } from "drizzle-orm";
import { Data, Effect, Result } from "effect";
import {
  DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
  decodeDeclarativeV2PhysicalFrameV1,
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import {
  DECLARATIVE_V2_RUNTIME_READINESS_POLICY_IDENTITY_V1,
  frameDeclarativeV2RuntimeRootSha256PreimageV1,
  makeDeclarativeV2RuntimeArtifactObjectReferenceV1,
  type DeclarativeV2RuntimeArtifactObjectKindV1,
  type DeclarativeV2RuntimeArtifactObjectReferenceV1,
} from "flarex-protocol/internal/declarative-v2-runtime-projection-v1";
import {
  FlarexDbV1StorageGenerationSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import type {
  CandidateRuntimePublicationV1,
  CandidateRuntimePublishedAuthorityV1,
  CandidateRuntimeStoredAuthorityV1,
} from "./candidateRuntimeProjectionV1";
import {
  makeLiveDeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1Error,
} from "./declarativeV2Sha256";
import {
  fxSystemDeclarativeV2Candidates,
  fxSystemDeclarativeV2FunctionGroupEntries,
  fxSystemDeclarativeV2FunctionGroupManifests,
  fxSystemDeclarativeV2RuntimeProjectionModules,
  fxSystemDeclarativeV2RuntimeProjections,
} from "./schema";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const FRAME_BUDGET = Object.freeze({
  maximumFrameBytes: 64 * 1_048_576,
  maximumCanonicalBytes: 64 * 1_048_576,
});
const HASH_BUDGET = Object.freeze({ maximumInputBytes: 64 * 1_048_576 });
const ROOT_BUDGET = Object.freeze({
  maximumDigests: 32_768,
  maximumPreimageBytes: 2 * 1_048_576,
});

export type CandidateRuntimePublicationWriteBoundaryV1 =
  | "candidate"
  | "projection"
  | "projectionModule"
  | "manifest"
  | "manifestEntry";

export class CandidateRuntimePublicationStorageV1Error
  extends Data.TaggedError("CandidateRuntimePublicationStorageV1Error")<{
    readonly operation: "publish" | "load";
    readonly reason:
      | "conflict"
      | "corruption"
      | "confirmedRollback"
      | "decisionUncertain"
      | "infrastructure";
    readonly scopeId: string;
    readonly path?: string;
    readonly cause?: unknown;
  }> {}

export type CandidateRuntimePublicationRepositoryV1Error =
  | CandidateRuntimePublicationStorageV1Error
  | DeclarativeV2Sha256V1Error;

export interface PublishCandidateRuntimePublicationV1Input {
  readonly authority: TrustedScopeAuthority;
  readonly candidate: DeclarativeV2CandidateFrameV1;
  readonly candidateSha256: Uint8Array;
  readonly candidateFrameBytes: Uint8Array;
  readonly publication: CandidateRuntimePublicationV1;
  readonly publishedAuthority: CandidateRuntimePublishedAuthorityV1;
}

export interface CandidateRuntimePublicationRepositoryV1Options {
  readonly faultAfter?: (
    boundary: CandidateRuntimePublicationWriteBoundaryV1,
    ordinal: number,
  ) => void;
}

export interface LoadedCandidateRuntimePublicationV1 {
  readonly candidate: DeclarativeV2CandidateFrameV1;
  readonly candidateSha256: Uint8Array;
  readonly candidateFrameBytes: Uint8Array;
  readonly publication: CandidateRuntimeStoredAuthorityV1;
}

export interface CandidateRuntimePublicationRepositoryV1 {
  readonly publish: (
    input: PublishCandidateRuntimePublicationV1Input,
  ) => Effect.Effect<
    "inserted" | "replayed",
    CandidateRuntimePublicationRepositoryV1Error
  >;
  readonly load: (
    scopeId: ScopeId,
    candidateSha256: Uint8Array,
  ) => Effect.Effect<
    LoadedCandidateRuntimePublicationV1,
    CandidateRuntimePublicationRepositoryV1Error
  >;
}

class PublicationConflict extends Error {
  constructor(readonly path: string) {
    super(`Candidate runtime publication conflict at ${path}.`);
  }
}

export function makeCandidateRuntimePublicationRepositoryV1(
  target: LocatedReadCommittedAttemptTargetV1,
  options: CandidateRuntimePublicationRepositoryV1Options = {},
  sha256: DeclarativeV2Sha256V1 = makeLiveDeclarativeV2Sha256V1(),
): CandidateRuntimePublicationRepositoryV1 {
  const publish = Effect.fn(
    "CandidateRuntimePublicationRepository.publishV1",
  )(function* (
    input: PublishCandidateRuntimePublicationV1Input,
  ): Effect.fn.Return<
    "inserted" | "replayed",
    CandidateRuntimePublicationRepositoryV1Error
  > {
    yield* validatePublishInput(input, sha256);
    let callbackFailure: unknown;
    const transaction = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
      try {
        const candidateInserted = await tx
          .insert(fxSystemDeclarativeV2Candidates)
          .values({
            scopeId: input.authority.scopeId,
            candidateSha256: input.candidateSha256,
            storageGeneration:
              FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
            storageGenerationFence: input.authority.storageGenerationFence,
            epoch: input.authority.epoch,
            frameCodecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
            frameByteLength: BigInt(input.candidateFrameBytes.byteLength),
            frameSha256: input.candidateSha256,
            frameBytes: input.candidateFrameBytes,
          })
          .onConflictDoNothing()
          .returning({ digest: fxSystemDeclarativeV2Candidates.candidateSha256 });
        options.faultAfter?.("candidate", 0);
        if (candidateInserted.length === 0) {
          await requireCandidateReplay(tx, input);
        }
        for (let index = 0; index < input.publication.projections.length; index += 1) {
          const projection = input.publication.projections[index]!;
          const published = input.publishedAuthority.projections[index]!;
          await insertProjection(tx, input, projection, published);
          options.faultAfter?.("projection", index);
          for (let ordinal = 0; ordinal < projection.moduleFrames.length; ordinal += 1) {
            await insertModule(tx, input, projection, published, ordinal);
            options.faultAfter?.("projectionModule", ordinal);
          }
        }
        await insertManifest(tx, input);
        options.faultAfter?.("manifest", 0);
        for (let ordinal = 0; ordinal < input.publication.functionEntries.length; ordinal += 1) {
          await insertEntry(tx, input, ordinal);
          options.faultAfter?.("manifestEntry", ordinal);
        }
        return candidateInserted.length === 1
          ? "inserted" as const
          : "replayed" as const;
      } catch (cause) {
        callbackFailure = cause;
        throw cause;
      }
    });
    return yield* Effect.tryPromise({
      try: () => transaction,
      catch: cause => mapTransactionFailure(
        "publish",
        input.authority.scopeId,
        callbackFailure,
        cause,
      ),
    });
  });

  const load = Effect.fn(
    "CandidateRuntimePublicationRepository.loadV1",
  )(function* (
    scopeId: ScopeId,
    candidateSha256: Uint8Array,
  ): Effect.fn.Return<
    LoadedCandidateRuntimePublicationV1,
    CandidateRuntimePublicationRepositoryV1Error
  > {
    let callbackFailure: unknown;
    const transaction = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
      try {
        const candidates = await tx.select()
          .from(fxSystemDeclarativeV2Candidates)
          .where(and(
            eq(fxSystemDeclarativeV2Candidates.scopeId, scopeId),
            eq(fxSystemDeclarativeV2Candidates.candidateSha256, candidateSha256),
          )).limit(1);
        const manifests = await tx.select()
          .from(fxSystemDeclarativeV2FunctionGroupManifests)
          .where(and(
            eq(fxSystemDeclarativeV2FunctionGroupManifests.scopeId, scopeId),
            eq(fxSystemDeclarativeV2FunctionGroupManifests.candidateSha256, candidateSha256),
          )).limit(1);
        const projections = await tx.select()
          .from(fxSystemDeclarativeV2RuntimeProjections)
          .where(and(
            eq(fxSystemDeclarativeV2RuntimeProjections.scopeId, scopeId),
            eq(fxSystemDeclarativeV2RuntimeProjections.candidateSha256, candidateSha256),
          )).orderBy(asc(fxSystemDeclarativeV2RuntimeProjections.executionGroup));
        const modules = await tx.select()
          .from(fxSystemDeclarativeV2RuntimeProjectionModules)
          .where(and(
            eq(fxSystemDeclarativeV2RuntimeProjectionModules.scopeId, scopeId),
            eq(fxSystemDeclarativeV2RuntimeProjectionModules.candidateSha256, candidateSha256),
          )).orderBy(
            asc(fxSystemDeclarativeV2RuntimeProjectionModules.executionGroup),
            asc(fxSystemDeclarativeV2RuntimeProjectionModules.moduleOrdinal),
          );
        const entries = await tx.select()
          .from(fxSystemDeclarativeV2FunctionGroupEntries)
          .where(and(
            eq(fxSystemDeclarativeV2FunctionGroupEntries.scopeId, scopeId),
            eq(fxSystemDeclarativeV2FunctionGroupEntries.candidateSha256, candidateSha256),
          )).orderBy(asc(fxSystemDeclarativeV2FunctionGroupEntries.functionOrdinal));
        return {
          candidate: candidates[0],
          manifest: manifests[0],
          projections,
          modules,
          entries,
        };
      } catch (cause) {
        callbackFailure = cause;
        throw cause;
      }
    });
    const stored = yield* Effect.tryPromise({
      try: () => transaction,
      catch: cause => mapTransactionFailure(
        "load",
        scopeId,
        callbackFailure,
        cause,
      ),
    });
    return yield* validateLoaded(scopeId, candidateSha256, stored, sha256);
  });

  return Object.freeze({ publish, load });
}

function validatePublishInput(
  input: PublishCandidateRuntimePublicationV1Input,
  sha256: DeclarativeV2Sha256V1,
): Effect.Effect<void, CandidateRuntimePublicationRepositoryV1Error> {
  const scopeId = input.authority.scopeId;
  return Effect.gen(function* () {
    const candidateBytes = yield* encodeFrame(scopeId, "publish", "candidate", input.candidate);
    const candidateDigest = yield* sha256(candidateBytes, HASH_BUDGET);
    if (
      input.candidate.scopeId !== scopeId ||
      input.candidate.deploymentId !== input.authority.deploymentId ||
      input.candidate.storageGeneration !== input.authority.storageGeneration ||
      input.candidate.storageGenerationFence !== input.authority.storageGenerationFence ||
      input.candidate.scopeEpoch !== input.authority.epoch ||
      input.candidate.readinessPolicyIdentity !== DECLARATIVE_V2_RUNTIME_READINESS_POLICY_IDENTITY_V1 ||
      !bytesEqualFullScan(candidateBytes, input.candidateFrameBytes) ||
      !bytesEqualFullScan(candidateDigest, input.candidateSha256) ||
      !bytesEqualFullScan(input.candidate.runtimeProjectionSetSha256, input.publication.runtimeProjectionSetSha256) ||
      !bytesEqualFullScan(input.candidate.functionGroupManifestSha256, input.publication.functionGroupManifestSha256)
    ) return yield* storageError("publish", scopeId, "conflict", "candidateAuthority");

    const projectionSetBytes = yield* encodeFrame(
      scopeId,
      "publish",
      "projectionSet",
      input.publication.projectionSetFrame,
    );
    const projectionSetDigest = yield* sha256(projectionSetBytes, HASH_BUDGET);
    const manifestBytes = yield* encodeFrame(
      scopeId,
      "publish",
      "manifest",
      input.publication.manifestFrame,
    );
    const manifestDigest = yield* sha256(manifestBytes, HASH_BUDGET);
    if (
      !bytesEqualFullScan(projectionSetBytes, input.publication.projectionSetFrameBytes) ||
      !bytesEqualFullScan(projectionSetDigest, input.publication.runtimeProjectionSetSha256) ||
      !bytesEqualFullScan(manifestBytes, input.publication.manifestFrameBytes) ||
      !bytesEqualFullScan(manifestDigest, input.publication.functionGroupManifestSha256)
    ) return yield* storageError("publish", scopeId, "conflict", "canonicalRoots");

    const projectionByGroup = new Map<
      CandidateRuntimePublicationV1["projections"][number]["group"],
      CandidateRuntimePublicationV1["projections"][number]
    >();
    for (const projection of input.publication.projections) {
      if (projectionByGroup.has(projection.group)) {
        return yield* storageError("publish", scopeId, "conflict", `projection:${projection.group}:duplicate`);
      }
      const bytes = yield* encodeFrame(scopeId, "publish", `projection:${projection.group}`, projection.projectionFrame);
      const digest = yield* sha256(bytes, HASH_BUDGET);
      if (
        projection.projectionFrame.group !== projection.group ||
        !bytesEqualFullScan(bytes, projection.projectionFrameBytes) ||
        !bytesEqualFullScan(digest, projection.projectionSha256) ||
        projection.moduleFrames.length !== projection.moduleFrameBytes.length ||
        projection.moduleFrames.length !== projection.moduleFrameSha256.length ||
        projection.projectionFrame.moduleCount !== BigInt(projection.moduleFrames.length)
      ) return yield* storageError("publish", scopeId, "conflict", `projection:${projection.group}`);
      const moduleDigests: Uint8Array[] = [];
      let rawByteLength = 0n;
      let hasExecutionModule = false;
      for (let ordinal = 0; ordinal < projection.moduleFrames.length; ordinal += 1) {
        const frame = projection.moduleFrames[ordinal]!;
        const moduleBytes = yield* encodeFrame(scopeId, "publish", `projection:${projection.group}:module:${ordinal}`, frame);
        const moduleDigest = yield* sha256(moduleBytes, HASH_BUDGET);
        const sourceDigest = yield* sha256(frame.sourceBytes, HASH_BUDGET);
        if (
          frame.group !== projection.group ||
          frame.moduleOrdinal !== BigInt(ordinal) ||
          !bytesEqualFullScan(moduleBytes, projection.moduleFrameBytes[ordinal]!) ||
          !bytesEqualFullScan(moduleDigest, projection.moduleFrameSha256[ordinal]!) ||
          !bytesEqualFullScan(sourceDigest, frame.sourceSha256)
        ) return yield* storageError("publish", scopeId, "conflict", `projection:${projection.group}:module:${ordinal}`);
        moduleDigests.push(moduleDigest);
        rawByteLength += BigInt(frame.sourceBytes.byteLength);
        hasExecutionModule ||= frame.modulePath === projection.projectionFrame.executionModule;
      }
      const rootPreimage = yield* Effect.fromResult(
        frameDeclarativeV2RuntimeRootSha256PreimageV1(
          "runtimeProjectionModules",
          projection.group,
          moduleDigests,
          ROOT_BUDGET,
        ),
      ).pipe(Effect.mapError(() => new CandidateRuntimePublicationStorageV1Error({
        operation: "publish", reason: "conflict", scopeId, path: `projection:${projection.group}:root`,
      })));
      const root = yield* sha256(rootPreimage, HASH_BUDGET);
      if (
        !hasExecutionModule ||
        projection.projectionFrame.rawByteLength !== rawByteLength ||
        !bytesEqualFullScan(projection.projectionFrame.moduleRootSha256, root)
      ) return yield* storageError("publish", scopeId, "conflict", `projection:${projection.group}:root`);
      projectionByGroup.set(projection.group, projection);
    }
    if (
      input.publication.projectionSetFrame.groupCount !== BigInt(projectionByGroup.size) ||
      !nullableDigestEqual(
        input.publication.projectionSetFrame.transactionProjectionSha256,
        projectionByGroup.get("transaction")?.projectionSha256 ?? null,
      ) ||
      !nullableDigestEqual(
        input.publication.projectionSetFrame.edgeActionProjectionSha256,
        projectionByGroup.get("edge_action")?.projectionSha256 ?? null,
      )
    ) return yield* storageError("publish", scopeId, "conflict", "projectionSet");

    const entryDigests: Uint8Array[] = [];
    for (let ordinal = 0; ordinal < input.publication.functionEntries.length; ordinal += 1) {
      const frame = input.publication.functionEntries[ordinal]!;
      const bytes = yield* encodeFrame(scopeId, "publish", `entry:${ordinal}`, frame);
      const digest = yield* sha256(bytes, HASH_BUDGET);
      const projection = projectionByGroup.get(frame.group);
      if (
        frame.functionOrdinal !== BigInt(ordinal) ||
        !bytesEqualFullScan(bytes, input.publication.functionEntryBytes[ordinal]!) ||
        !bytesEqualFullScan(digest, input.publication.functionEntrySha256[ordinal]!) ||
        projection === undefined ||
        !bytesEqualFullScan(frame.projectionSha256, projection.projectionSha256) ||
        !projection.moduleFrames.some(module => module.modulePath === frame.executionModule) ||
        (frame.handlerKind === "action" ? frame.group !== "edge_action" : frame.group !== "transaction")
      ) return yield* storageError("publish", scopeId, "conflict", `entry:${ordinal}`);
      entryDigests.push(digest);
    }
    const functionRootPreimage = yield* Effect.fromResult(
      frameDeclarativeV2RuntimeRootSha256PreimageV1(
        "functionGroupEntries",
        null,
        entryDigests,
        ROOT_BUDGET,
      ),
    ).pipe(Effect.mapError(() => new CandidateRuntimePublicationStorageV1Error({
      operation: "publish", reason: "conflict", scopeId, path: "manifest:functionRoot",
    })));
    const functionRoot = yield* sha256(functionRootPreimage, HASH_BUDGET);
    if (
      input.publication.manifestFrame.functionCount !== BigInt(entryDigests.length) ||
      !bytesEqualFullScan(input.publication.manifestFrame.functionRootSha256, functionRoot)
    ) return yield* storageError("publish", scopeId, "conflict", "manifest:functionRoot");

    yield* requireReference(
      scopeId,
      "projectionSet",
      "runtime-projection-set",
      input.publication.runtimeProjectionSetSha256,
      input.publication.projectionSetFrameBytes,
      input.publishedAuthority.projectionSetReference,
    );
    yield* requireReference(
      scopeId,
      "manifest",
      "function-group-manifest",
      input.publication.functionGroupManifestSha256,
      input.publication.manifestFrameBytes,
      input.publishedAuthority.manifestReference,
    );
    if (
      input.publication.projections.length !== input.publishedAuthority.projections.length ||
      input.publication.functionEntries.length !== input.publishedAuthority.functionEntries.length ||
      !bytesEqualFullScan(input.publication.manifestFrame.runtimeProjectionSetSha256, input.publication.runtimeProjectionSetSha256) ||
      !bytesEqualFullScan(input.publication.manifestFrame.validatorRootSha256, input.candidate.validatorRootSha256) ||
      !bytesEqualFullScan(input.publication.manifestFrame.declaredHandlerSetSha256, input.candidate.declaredHandlerSetSha256)
    ) return yield* storageError("publish", scopeId, "conflict", "publicationAuthority");

    for (let index = 0; index < input.publication.projections.length; index += 1) {
      const projection = input.publication.projections[index]!;
      const published = input.publishedAuthority.projections[index]!;
      if (projection.group !== published.group || projection.moduleFrames.length !== published.modules.length) {
        return yield* storageError("publish", scopeId, "conflict", `projection:${index}`);
      }
      yield* requireReference(scopeId, `projection:${index}`, "runtime-projection", projection.projectionSha256, projection.projectionFrameBytes, published.reference);
      for (let ordinal = 0; ordinal < projection.moduleFrames.length; ordinal += 1) {
        const frame = projection.moduleFrames[ordinal]!;
        const authority = published.modules[ordinal]!;
        if (authority.frame !== frame) {
          return yield* storageError("publish", scopeId, "conflict", `projection:${index}:module:${ordinal}:correlation`);
        }
        yield* requireReference(scopeId, `projection:${index}:module:${ordinal}`, "runtime-projection-module", projection.moduleFrameSha256[ordinal]!, projection.moduleFrameBytes[ordinal]!, authority.reference);
      }
    }
    for (let ordinal = 0; ordinal < input.publication.functionEntries.length; ordinal += 1) {
      const frame = input.publication.functionEntries[ordinal]!;
      const authority = input.publishedAuthority.functionEntries[ordinal]!;
      if (authority.frame !== frame) {
        return yield* storageError("publish", scopeId, "conflict", `entry:${ordinal}:correlation`);
      }
      yield* requireReference(scopeId, `entry:${ordinal}`, "function-group-entry", input.publication.functionEntrySha256[ordinal]!, input.publication.functionEntryBytes[ordinal]!, authority.reference);
    }
  });
}

function nullableDigestEqual(left: Uint8Array | null, right: Uint8Array | null): boolean {
  return left === null || right === null ? left === right : bytesEqualFullScan(left, right);
}

function requireReference(
  scopeId: ScopeId,
  path: string,
  kind: DeclarativeV2RuntimeArtifactObjectKindV1,
  digest: Uint8Array,
  bytes: Uint8Array,
  actual: DeclarativeV2RuntimeArtifactObjectReferenceV1,
): Effect.Effect<void, CandidateRuntimePublicationStorageV1Error> {
  return Effect.gen(function* () {
    const expected = yield* Effect.fromResult(
      makeDeclarativeV2RuntimeArtifactObjectReferenceV1(kind, digest, bytes.byteLength),
    ).pipe(Effect.orDie);
    if (!referenceEqual(expected, actual)) {
      return yield* storageError("publish", scopeId, "conflict", `${path}:reference`);
    }
  });
}

async function requireCandidateReplay(
  tx: AppRowTransaction,
  input: PublishCandidateRuntimePublicationV1Input,
): Promise<void> {
  const rows = await tx.select({
    digest: fxSystemDeclarativeV2Candidates.frameSha256,
    bytes: fxSystemDeclarativeV2Candidates.frameBytes,
  }).from(fxSystemDeclarativeV2Candidates).where(and(
    eq(fxSystemDeclarativeV2Candidates.scopeId, input.authority.scopeId),
    eq(fxSystemDeclarativeV2Candidates.candidateSha256, input.candidateSha256),
  )).limit(1);
  if (
    rows[0] === undefined ||
    !bytesEqualFullScan(rows[0].digest, input.candidateSha256) ||
    !bytesEqualFullScan(rows[0].bytes, input.candidateFrameBytes)
  ) throw new PublicationConflict("candidate");
}

function referenceColumns(reference: DeclarativeV2RuntimeArtifactObjectReferenceV1) {
  return {
    objectStoreIdentity: reference.storeIdentity,
    objectCodecIdentity: reference.codecIdentity,
    objectKey: reference.objectKey,
    objectByteLength: reference.byteLength,
    objectSha256: reference.sha256,
  } as const;
}

async function insertProjection(
  tx: AppRowTransaction,
  input: PublishCandidateRuntimePublicationV1Input,
  projection: CandidateRuntimePublicationV1["projections"][number],
  published: CandidateRuntimePublishedAuthorityV1["projections"][number],
): Promise<void> {
  const values = {
    scopeId: input.authority.scopeId,
    candidateSha256: input.candidateSha256,
    executionGroup: projection.group,
    executionModule: projection.projectionFrame.executionModule,
    moduleCount: projection.projectionFrame.moduleCount,
    rawByteLength: projection.projectionFrame.rawByteLength,
    moduleRootSha256: projection.projectionFrame.moduleRootSha256,
    ...referenceColumns(published.reference),
  } satisfies typeof fxSystemDeclarativeV2RuntimeProjections.$inferInsert;
  const inserted = await tx.insert(fxSystemDeclarativeV2RuntimeProjections)
    .values(values).onConflictDoNothing().returning({
      digest: fxSystemDeclarativeV2RuntimeProjections.objectSha256,
    });
  if (inserted.length === 1) return;
  const rows = await tx.select().from(fxSystemDeclarativeV2RuntimeProjections).where(and(
    eq(fxSystemDeclarativeV2RuntimeProjections.scopeId, input.authority.scopeId),
    eq(fxSystemDeclarativeV2RuntimeProjections.candidateSha256, input.candidateSha256),
    eq(fxSystemDeclarativeV2RuntimeProjections.executionGroup, projection.group),
  )).limit(1);
  if (rows[0] === undefined || !projectionRowEqual(rows[0], values)) {
    throw new PublicationConflict(`projection:${projection.group}`);
  }
}

async function insertModule(
  tx: AppRowTransaction,
  input: PublishCandidateRuntimePublicationV1Input,
  projection: CandidateRuntimePublicationV1["projections"][number],
  published: CandidateRuntimePublishedAuthorityV1["projections"][number],
  ordinal: number,
): Promise<void> {
  const frame = projection.moduleFrames[ordinal]!;
  const values = {
    scopeId: input.authority.scopeId,
    candidateSha256: input.candidateSha256,
    executionGroup: projection.group,
    moduleOrdinal: frame.moduleOrdinal,
    modulePath: frame.modulePath,
    roles: frame.roles,
    sourceByteLength: BigInt(frame.sourceBytes.byteLength),
    sourceSha256: frame.sourceSha256,
    ...referenceColumns(published.modules[ordinal]!.reference),
  } satisfies typeof fxSystemDeclarativeV2RuntimeProjectionModules.$inferInsert;
  const inserted = await tx.insert(fxSystemDeclarativeV2RuntimeProjectionModules)
    .values(values).onConflictDoNothing().returning({
      digest: fxSystemDeclarativeV2RuntimeProjectionModules.objectSha256,
    });
  if (inserted.length === 1) return;
  const rows = await tx.select().from(fxSystemDeclarativeV2RuntimeProjectionModules).where(and(
    eq(fxSystemDeclarativeV2RuntimeProjectionModules.scopeId, input.authority.scopeId),
    eq(fxSystemDeclarativeV2RuntimeProjectionModules.candidateSha256, input.candidateSha256),
    eq(fxSystemDeclarativeV2RuntimeProjectionModules.executionGroup, projection.group),
    eq(fxSystemDeclarativeV2RuntimeProjectionModules.moduleOrdinal, frame.moduleOrdinal),
  )).limit(1);
  if (rows[0] === undefined || !moduleRowEqual(rows[0], values)) {
    throw new PublicationConflict(`projection:${projection.group}:module:${ordinal}`);
  }
}

async function insertManifest(
  tx: AppRowTransaction,
  input: PublishCandidateRuntimePublicationV1Input,
): Promise<void> {
  const projectionSet = input.publishedAuthority.projectionSetReference;
  const manifest = input.publishedAuthority.manifestReference;
  const frame = input.publication.manifestFrame;
  const values = {
    scopeId: input.authority.scopeId,
    candidateSha256: input.candidateSha256,
    projectionSetObjectStoreIdentity: projectionSet.storeIdentity,
    projectionSetObjectCodecIdentity: projectionSet.codecIdentity,
    projectionSetObjectKey: projectionSet.objectKey,
    projectionSetObjectByteLength: projectionSet.byteLength,
    projectionSetSha256: projectionSet.sha256,
    manifestObjectStoreIdentity: manifest.storeIdentity,
    manifestObjectCodecIdentity: manifest.codecIdentity,
    manifestObjectKey: manifest.objectKey,
    manifestObjectByteLength: manifest.byteLength,
    manifestSha256: manifest.sha256,
    functionCount: frame.functionCount,
    functionRootSha256: frame.functionRootSha256,
    validatorRootSha256: frame.validatorRootSha256,
    declaredHandlerSetSha256: frame.declaredHandlerSetSha256,
  } satisfies typeof fxSystemDeclarativeV2FunctionGroupManifests.$inferInsert;
  const inserted = await tx.insert(fxSystemDeclarativeV2FunctionGroupManifests)
    .values(values).onConflictDoNothing().returning({
      digest: fxSystemDeclarativeV2FunctionGroupManifests.manifestSha256,
    });
  if (inserted.length === 1) return;
  const rows = await tx.select().from(fxSystemDeclarativeV2FunctionGroupManifests).where(and(
    eq(fxSystemDeclarativeV2FunctionGroupManifests.scopeId, input.authority.scopeId),
    eq(fxSystemDeclarativeV2FunctionGroupManifests.candidateSha256, input.candidateSha256),
  )).limit(1);
  if (rows[0] === undefined || !manifestRowEqual(rows[0], values)) {
    throw new PublicationConflict("manifest");
  }
}

async function insertEntry(
  tx: AppRowTransaction,
  input: PublishCandidateRuntimePublicationV1Input,
  ordinal: number,
): Promise<void> {
  const frame = input.publication.functionEntries[ordinal]!;
  const reference = input.publishedAuthority.functionEntries[ordinal]!.reference;
  const values = {
    scopeId: input.authority.scopeId,
    candidateSha256: input.candidateSha256,
    functionOrdinal: frame.functionOrdinal,
    functionPath: frame.functionPath,
    executionModule: frame.executionModule,
    exportName: frame.exportName,
    handlerKind: frame.handlerKind,
    visibility: frame.visibility,
    executionGroup: frame.group,
    projectionSha256: frame.projectionSha256,
    ...referenceColumns(reference),
  } satisfies typeof fxSystemDeclarativeV2FunctionGroupEntries.$inferInsert;
  const inserted = await tx.insert(fxSystemDeclarativeV2FunctionGroupEntries)
    .values(values).onConflictDoNothing().returning({
      digest: fxSystemDeclarativeV2FunctionGroupEntries.objectSha256,
    });
  if (inserted.length === 1) return;
  const rows = await tx.select().from(fxSystemDeclarativeV2FunctionGroupEntries).where(and(
    eq(fxSystemDeclarativeV2FunctionGroupEntries.scopeId, input.authority.scopeId),
    eq(fxSystemDeclarativeV2FunctionGroupEntries.candidateSha256, input.candidateSha256),
    eq(fxSystemDeclarativeV2FunctionGroupEntries.functionOrdinal, frame.functionOrdinal),
  )).limit(1);
  if (rows[0] === undefined || !entryRowEqual(rows[0], values)) {
    throw new PublicationConflict(`manifestEntry:${ordinal}`);
  }
}

function validateLoaded(
  scopeId: ScopeId,
  requestedCandidateSha256: Uint8Array,
  stored: {
    readonly candidate: typeof fxSystemDeclarativeV2Candidates.$inferSelect | undefined;
    readonly manifest: typeof fxSystemDeclarativeV2FunctionGroupManifests.$inferSelect | undefined;
    readonly projections: ReadonlyArray<typeof fxSystemDeclarativeV2RuntimeProjections.$inferSelect>;
    readonly modules: ReadonlyArray<typeof fxSystemDeclarativeV2RuntimeProjectionModules.$inferSelect>;
    readonly entries: ReadonlyArray<typeof fxSystemDeclarativeV2FunctionGroupEntries.$inferSelect>;
  },
  sha256: DeclarativeV2Sha256V1,
): Effect.Effect<LoadedCandidateRuntimePublicationV1, CandidateRuntimePublicationRepositoryV1Error> {
  return Effect.gen(function* () {
    if (stored.candidate === undefined || stored.manifest === undefined) {
      return yield* storageError("load", scopeId, "corruption", "root");
    }
    const candidateDigest = yield* sha256(stored.candidate.frameBytes, HASH_BUDGET);
    const decoded = yield* Effect.fromResult(
      decodeDeclarativeV2PhysicalFrameV1(stored.candidate.frameBytes, FRAME_BUDGET),
    ).pipe(Effect.mapError(() => new CandidateRuntimePublicationStorageV1Error({
      operation: "load",
      reason: "corruption",
      scopeId,
      path: "candidate",
    })));
    const candidate = decoded.frame;
    if (
      candidate.kind !== "candidate" ||
      candidate.scopeId !== scopeId ||
      candidate.storageGeneration !== stored.candidate.storageGeneration ||
      candidate.storageGenerationFence !== stored.candidate.storageGenerationFence ||
      candidate.scopeEpoch !== stored.candidate.epoch ||
      candidate.readinessPolicyIdentity !== DECLARATIVE_V2_RUNTIME_READINESS_POLICY_IDENTITY_V1 ||
      !bytesEqualFullScan(candidateDigest, requestedCandidateSha256) ||
      !bytesEqualFullScan(stored.candidate.frameSha256, requestedCandidateSha256) ||
      !bytesEqualFullScan(candidate.runtimeProjectionSetSha256, stored.manifest.projectionSetSha256) ||
      !bytesEqualFullScan(candidate.functionGroupManifestSha256, stored.manifest.manifestSha256) ||
      !bytesEqualFullScan(candidate.validatorRootSha256, stored.manifest.validatorRootSha256) ||
      !bytesEqualFullScan(candidate.declaredHandlerSetSha256, stored.manifest.declaredHandlerSetSha256)
    ) return yield* storageError("load", scopeId, "corruption", "candidateAuthority");

    const projectionSetReference = yield* referenceFromManifestRow(scopeId, "runtime-projection-set", stored.manifest, true);
    const manifestReference = yield* referenceFromManifestRow(scopeId, "function-group-manifest", stored.manifest, false);
    const projections: CandidateRuntimeStoredAuthorityV1["projections"][number][] = [];
    for (const row of stored.projections) {
      const reference = yield* referenceFromRow(scopeId, "runtime-projection", row);
      const rows = stored.modules.filter(module => module.executionGroup === row.executionGroup);
      const modules: CandidateRuntimeStoredAuthorityV1["projections"][number]["modules"][number][] = [];
      for (let ordinal = 0; ordinal < rows.length; ordinal += 1) {
        const module = rows[ordinal]!;
        if (module.moduleOrdinal !== BigInt(ordinal)) {
          return yield* storageError("load", scopeId, "corruption", `module:${row.executionGroup}:${ordinal}`);
        }
        modules.push(Object.freeze({
          group: module.executionGroup,
          moduleOrdinal: module.moduleOrdinal,
          modulePath: module.modulePath,
          roles: module.roles,
          sourceByteLength: module.sourceByteLength,
          sourceSha256: new Uint8Array(module.sourceSha256),
          reference: yield* referenceFromRow(scopeId, "runtime-projection-module", module),
        }));
      }
      const frame = Object.freeze({
        kind: "runtime_projection" as const,
        group: row.executionGroup,
        executionModule: row.executionModule,
        moduleCount: row.moduleCount,
        rawByteLength: row.rawByteLength,
        moduleRootSha256: new Uint8Array(row.moduleRootSha256),
      });
      const rootPreimage = yield* Effect.fromResult(
        frameDeclarativeV2RuntimeRootSha256PreimageV1(
          "runtimeProjectionModules",
          row.executionGroup,
          modules.map(module => module.reference.sha256),
          ROOT_BUDGET,
        ),
      ).pipe(Effect.mapError(() => new CandidateRuntimePublicationStorageV1Error({
        operation: "load", reason: "corruption", scopeId, path: `projection:${row.executionGroup}:root`,
      })));
      const root = yield* sha256(rootPreimage, HASH_BUDGET);
      const rawByteLength = modules.reduce(
        (sum, module) => sum + module.sourceByteLength,
        0n,
      );
      if (
        frame.moduleCount !== BigInt(modules.length) ||
        frame.rawByteLength !== rawByteLength ||
        !bytesEqualFullScan(frame.moduleRootSha256, root) ||
        !modules.some(module => module.modulePath === frame.executionModule)
      ) return yield* storageError("load", scopeId, "corruption", `projection:${row.executionGroup}`);
      projections.push(Object.freeze({ frame, reference, modules: Object.freeze(modules) }));
    }
    const functionEntries: CandidateRuntimeStoredAuthorityV1["functionEntries"][number][] = [];
    for (let ordinal = 0; ordinal < stored.entries.length; ordinal += 1) {
      const row = stored.entries[ordinal]!;
      if (row.functionOrdinal !== BigInt(ordinal)) {
        return yield* storageError("load", scopeId, "corruption", `entry:${ordinal}`);
      }
      functionEntries.push(Object.freeze({
        frame: Object.freeze({
          kind: "function_group_entry" as const,
          functionOrdinal: row.functionOrdinal,
          functionPath: row.functionPath,
          executionModule: row.executionModule,
          exportName: row.exportName,
          // SAFETY: persisted handler-kind and visibility columns are
          // constrained to these enum spellings at write time.
          handlerKind: row.handlerKind as "query" | "mutation" | "workflowMutation" | "action",
          // SAFETY: the visibility column is constrained to public or
          // internal at write time.
          visibility: row.visibility as "public" | "internal",
          group: row.executionGroup,
          projectionSha256: new Uint8Array(row.projectionSha256),
        }),
        reference: yield* referenceFromRow(scopeId, "function-group-entry", row),
      }));
    }
    const functionRootPreimage = yield* Effect.fromResult(
      frameDeclarativeV2RuntimeRootSha256PreimageV1(
        "functionGroupEntries",
        null,
        functionEntries.map(entry => entry.reference.sha256),
        ROOT_BUDGET,
      ),
    ).pipe(Effect.mapError(() => new CandidateRuntimePublicationStorageV1Error({
      operation: "load", reason: "corruption", scopeId, path: "manifest:functionRoot",
    })));
    const functionRoot = yield* sha256(functionRootPreimage, HASH_BUDGET);
    if (
      stored.manifest.functionCount !== BigInt(functionEntries.length) ||
      !bytesEqualFullScan(stored.manifest.functionRootSha256, functionRoot)
    ) return yield* storageError("load", scopeId, "corruption", "manifest:functionRoot");
    const projectionByGroup = new Map(projections.map(item => [item.frame.group, item]));
    for (const entry of functionEntries) {
      const projection = projectionByGroup.get(entry.frame.group);
      const groupMatchesKind = entry.frame.handlerKind === "action"
        ? entry.frame.group === "edge_action"
        : entry.frame.group === "transaction";
      if (
        !groupMatchesKind ||
        projection === undefined ||
        !bytesEqualFullScan(entry.frame.projectionSha256, projection.reference.sha256) ||
        !projection.modules.some(module => module.modulePath === entry.frame.executionModule)
      ) return yield* storageError("load", scopeId, "corruption", `entry:${entry.frame.functionOrdinal}:binding`);
    }
    return Object.freeze({
      candidate,
      candidateSha256: new Uint8Array(requestedCandidateSha256),
      candidateFrameBytes: new Uint8Array(stored.candidate.frameBytes),
      publication: Object.freeze({
        projectionSetReference,
        manifestReference,
        manifestFrame: Object.freeze({
          kind: "function_group_manifest" as const,
          runtimeProjectionSetSha256: new Uint8Array(stored.manifest.projectionSetSha256),
          functionCount: stored.manifest.functionCount,
          functionRootSha256: new Uint8Array(stored.manifest.functionRootSha256),
          validatorRootSha256: new Uint8Array(stored.manifest.validatorRootSha256),
          declaredHandlerSetSha256: new Uint8Array(stored.manifest.declaredHandlerSetSha256),
        }),
        projections: Object.freeze(projections),
        functionEntries: Object.freeze(functionEntries),
      }),
    });
  });
}

function referenceFromRow(
  scopeId: ScopeId,
  kind: DeclarativeV2RuntimeArtifactObjectKindV1,
  row: {
    readonly objectStoreIdentity: string;
    readonly objectCodecIdentity: string;
    readonly objectKey: string;
    readonly objectByteLength: bigint;
    readonly objectSha256: Uint8Array;
  },
): Effect.Effect<DeclarativeV2RuntimeArtifactObjectReferenceV1, CandidateRuntimePublicationStorageV1Error> {
  return Effect.fromResult(makeDeclarativeV2RuntimeArtifactObjectReferenceV1(
    kind,
    row.objectSha256,
    Number(row.objectByteLength),
  ).pipe(Result.mapError(() => new CandidateRuntimePublicationStorageV1Error({
    operation: "load",
    scopeId,
    reason: "corruption",
    path: `${kind}:reference`,
  })))).pipe(Effect.flatMap(reference => referenceEqual(reference, {
    // SAFETY: persisted store-identity and codec-identity columns are
    // constrained to the reference enum spellings at write time.
    storeIdentity: row.objectStoreIdentity as DeclarativeV2RuntimeArtifactObjectReferenceV1["storeIdentity"],
    kind,
    // SAFETY: the codec-identity column is constrained to the reference
    // enum spellings at write time.
    codecIdentity: row.objectCodecIdentity as DeclarativeV2RuntimeArtifactObjectReferenceV1["codecIdentity"],
    objectKey: row.objectKey,
    byteLength: row.objectByteLength,
    sha256: row.objectSha256,
  })
    ? Effect.succeed(reference)
    : storageError("load", scopeId, "corruption", `${kind}:reference`)));
}

function referenceFromManifestRow(
  scopeId: ScopeId,
  kind: "runtime-projection-set" | "function-group-manifest",
  row: typeof fxSystemDeclarativeV2FunctionGroupManifests.$inferSelect,
  projectionSet: boolean,
) {
  return referenceFromRow(scopeId, kind, projectionSet ? {
    objectStoreIdentity: row.projectionSetObjectStoreIdentity,
    objectCodecIdentity: row.projectionSetObjectCodecIdentity,
    objectKey: row.projectionSetObjectKey,
    objectByteLength: row.projectionSetObjectByteLength,
    objectSha256: row.projectionSetSha256,
  } : {
    objectStoreIdentity: row.manifestObjectStoreIdentity,
    objectCodecIdentity: row.manifestObjectCodecIdentity,
    objectKey: row.manifestObjectKey,
    objectByteLength: row.manifestObjectByteLength,
    objectSha256: row.manifestSha256,
  });
}

function encodeFrame(
  scopeId: ScopeId,
  operation: "publish" | "load",
  path: string,
  frame: Parameters<typeof encodeDeclarativeV2PhysicalFrameV1>[0],
): Effect.Effect<Uint8Array, CandidateRuntimePublicationStorageV1Error> {
  return Effect.fromResult(
    encodeDeclarativeV2PhysicalFrameV1(frame, FRAME_BUDGET).pipe(
      Result.map(encoded => new Uint8Array(encoded.canonicalBytes)),
      Result.mapError(() => new CandidateRuntimePublicationStorageV1Error({
        operation, reason: operation === "publish" ? "conflict" : "corruption", scopeId, path,
      })),
    ),
  );
}

function referenceEqual(
  left: DeclarativeV2RuntimeArtifactObjectReferenceV1,
  right: DeclarativeV2RuntimeArtifactObjectReferenceV1,
): boolean {
  return left.storeIdentity === right.storeIdentity &&
    left.kind === right.kind &&
    left.codecIdentity === right.codecIdentity &&
    left.objectKey === right.objectKey &&
    left.byteLength === right.byteLength &&
    bytesEqualFullScan(left.sha256, right.sha256);
}

function refColumnsEqual(
  left: { readonly objectStoreIdentity: string; readonly objectCodecIdentity: string; readonly objectKey: string; readonly objectByteLength: bigint; readonly objectSha256: Uint8Array },
  right: { readonly objectStoreIdentity: string; readonly objectCodecIdentity: string; readonly objectKey: string; readonly objectByteLength: bigint; readonly objectSha256: Uint8Array },
) {
  return left.objectStoreIdentity === right.objectStoreIdentity &&
    left.objectCodecIdentity === right.objectCodecIdentity &&
    left.objectKey === right.objectKey &&
    left.objectByteLength === right.objectByteLength &&
    bytesEqualFullScan(left.objectSha256, right.objectSha256);
}

function projectionRowEqual(left: typeof fxSystemDeclarativeV2RuntimeProjections.$inferSelect, right: typeof fxSystemDeclarativeV2RuntimeProjections.$inferInsert) {
  return left.executionModule === right.executionModule && left.moduleCount === right.moduleCount && left.rawByteLength === right.rawByteLength && bytesEqualFullScan(left.moduleRootSha256, right.moduleRootSha256) && refColumnsEqual(left, right);
}
function moduleRowEqual(left: typeof fxSystemDeclarativeV2RuntimeProjectionModules.$inferSelect, right: typeof fxSystemDeclarativeV2RuntimeProjectionModules.$inferInsert) {
  return left.modulePath === right.modulePath && left.roles === right.roles && left.sourceByteLength === right.sourceByteLength && bytesEqualFullScan(left.sourceSha256, right.sourceSha256) && refColumnsEqual(left, right);
}
function manifestRowEqual(left: typeof fxSystemDeclarativeV2FunctionGroupManifests.$inferSelect, right: typeof fxSystemDeclarativeV2FunctionGroupManifests.$inferInsert) {
  return left.projectionSetObjectStoreIdentity === right.projectionSetObjectStoreIdentity && left.projectionSetObjectCodecIdentity === right.projectionSetObjectCodecIdentity && left.projectionSetObjectKey === right.projectionSetObjectKey && left.projectionSetObjectByteLength === right.projectionSetObjectByteLength && bytesEqualFullScan(left.projectionSetSha256, right.projectionSetSha256) && left.manifestObjectStoreIdentity === right.manifestObjectStoreIdentity && left.manifestObjectCodecIdentity === right.manifestObjectCodecIdentity && left.manifestObjectKey === right.manifestObjectKey && left.manifestObjectByteLength === right.manifestObjectByteLength && bytesEqualFullScan(left.manifestSha256, right.manifestSha256) && left.functionCount === right.functionCount && bytesEqualFullScan(left.functionRootSha256, right.functionRootSha256) && bytesEqualFullScan(left.validatorRootSha256, right.validatorRootSha256) && bytesEqualFullScan(left.declaredHandlerSetSha256, right.declaredHandlerSetSha256);
}
function entryRowEqual(left: typeof fxSystemDeclarativeV2FunctionGroupEntries.$inferSelect, right: typeof fxSystemDeclarativeV2FunctionGroupEntries.$inferInsert) {
  return left.functionPath === right.functionPath && left.executionModule === right.executionModule && left.exportName === right.exportName && left.handlerKind === right.handlerKind && left.visibility === right.visibility && left.executionGroup === right.executionGroup && bytesEqualFullScan(left.projectionSha256, right.projectionSha256) && refColumnsEqual(left, right);
}

function mapTransactionFailure(
  operation: "publish" | "load",
  scopeId: string,
  callbackFailure: unknown,
  cause: unknown,
): CandidateRuntimePublicationStorageV1Error {
  if (callbackFailure instanceof PublicationConflict) {
    return new CandidateRuntimePublicationStorageV1Error({ operation, reason: "conflict", scopeId, path: callbackFailure.path });
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    if (cause.issue.kind === "decisionUncertain") {
      return new CandidateRuntimePublicationStorageV1Error({ operation, reason: "decisionUncertain", scopeId, cause });
    }
    if (cause.issue.kind === "callbackRolledBack") {
      return new CandidateRuntimePublicationStorageV1Error({ operation, reason: "confirmedRollback", scopeId, cause: callbackFailure ?? cause });
    }
  }
  return new CandidateRuntimePublicationStorageV1Error({ operation, reason: "infrastructure", scopeId, cause });
}

function storageError(
  operation: "publish" | "load",
  scopeId: string,
  reason: CandidateRuntimePublicationStorageV1Error["reason"],
  path: string,
): Effect.Effect<never, CandidateRuntimePublicationStorageV1Error> {
  return Effect.fail(new CandidateRuntimePublicationStorageV1Error({ operation, reason, scopeId, path }));
}
