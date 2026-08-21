import {
  ApplicationAnalysisRejectionCodeV1,
  APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1,
  canonicalizeApplicationAnalysisReceiptV1,
  canonicalizeApplicationManifestV1,
  type ApplicationAnalysisReceiptV1,
  type ApplicationAnalysisRejectionCodeV1 as ApplicationAnalysisRejectionCode,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  bytesEqualFullScan,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { and, eq, sql } from "drizzle-orm";
import { Data, Effect, Result } from "effect";
import type {
  ScopeEpoch,
  ScopeId,
  FlarexDbV1StorageGeneration,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { FlarexMetadataDatabase } from "./deployments";
import { runEffectTransaction } from "./effectTransaction";
import {
  fxSystemApplicationAnalysesV1,
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationRevisionsV2,
  fxSystemScopeClocks,
} from "./schema";

const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const UTF8 = new TextEncoder();
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const IDENTITY_MAXIMUM_LENGTH = 256;

export interface ApplicationAnalysisAuthority {
  readonly scopeId: ScopeId;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: ScopeEpoch;
}

export interface BeginApplicationAnalysisInput {
  readonly authority: ApplicationAnalysisAuthority;
  readonly requestKey: string;
  readonly sourceArtifactRootSha256: string;
  readonly analyzerIdentity: string;
  readonly analyzerPolicyIdentity: string;
}

interface ApplicationAnalysisTerminalBase {
  readonly candidateId: string;
  readonly sourceArtifactRootSha256: string;
  readonly analyzerIdentity: string;
  readonly analyzerPolicyIdentity: string;
}

export type ApplicationAnalysisTerminalInput =
  | Readonly<ApplicationAnalysisTerminalBase & {
    readonly kind: "analyzed";
    readonly canonicalManifest: string;
  }>
  | Readonly<ApplicationAnalysisTerminalBase & {
    readonly kind: "rejected";
    readonly failureCode: ApplicationAnalysisRejectionCode;
    readonly detail: string;
  }>;

interface ApplicationAnalysisProjectionBase {
  readonly scopeId: ScopeId;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly sourceArtifactRootSha256: string;
  readonly analyzerIdentity: string;
  readonly analyzerPolicyIdentity: string;
}

export type ApplicationAnalysisProjection =
  | Readonly<ApplicationAnalysisProjectionBase & {
    readonly status: "pending";
  }>
  | Readonly<ApplicationAnalysisProjectionBase & {
    readonly status: "rejected";
    readonly receipt: ApplicationAnalysisReceiptV1;
    readonly receiptSha256: string;
  }>
  | Readonly<ApplicationAnalysisProjectionBase & {
    readonly status: "analyzed";
    readonly receipt: ApplicationAnalysisReceiptV1;
    readonly receiptSha256: string;
    readonly manifest: ApplicationManifestV1;
    readonly manifestSha256: string;
    readonly revision: Readonly<{
      readonly revisionId: string;
      readonly status: "inactive";
      readonly registeredAt: Date;
    }>;
  }>;

export class ApplicationAnalysisPersistenceError extends Data.TaggedError(
  "ApplicationAnalysisPersistenceError",
)<{
  readonly operation: "begin" | "settle" | "inspect";
  readonly reason:
    | "invalidInput"
    | "requestKeyReuse"
    | "authorityChanged"
    | "candidateMissing"
    | "terminalMismatch"
    | "storedState"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export interface ApplicationAnalysisRepository {
  readonly begin: (
    input: BeginApplicationAnalysisInput,
  ) => Effect.Effect<ApplicationAnalysisProjection, ApplicationAnalysisPersistenceError>;
  readonly settle: (
    authority: ApplicationAnalysisAuthority,
    terminal: ApplicationAnalysisTerminalInput,
  ) => Effect.Effect<ApplicationAnalysisProjection, ApplicationAnalysisPersistenceError>;
  readonly inspect: (
    authority: ApplicationAnalysisAuthority,
    candidateId: string,
  ) => Effect.Effect<ApplicationAnalysisProjection, ApplicationAnalysisPersistenceError>;
}

export function makeApplicationAnalysisRepository(
  db: FlarexMetadataDatabase,
  options: { readonly randomUuid?: () => string } = {},
): ApplicationAnalysisRepository {
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());

  const begin = Effect.fn("ApplicationAnalysisRepository.begin")(function* (
    input: BeginApplicationAnalysisInput,
  ): Effect.fn.Return<
    ApplicationAnalysisProjection,
    ApplicationAnalysisPersistenceError
  > {
    const prepared = yield* Effect.fromResult(prepareBegin(input));
    return yield* runTransaction(db, "begin", tx => beginInTransaction(
      tx,
      prepared,
      randomUuid,
    ));
  });

  const settle = Effect.fn("ApplicationAnalysisRepository.settle")(function* (
    authority: ApplicationAnalysisAuthority,
    terminal: ApplicationAnalysisTerminalInput,
  ): Effect.fn.Return<
    ApplicationAnalysisProjection,
    ApplicationAnalysisPersistenceError
  > {
    const prepared = yield* Effect.fromResult(prepareTerminal(authority, terminal));
    return yield* runTransaction(db, "settle", tx => settleInTransaction(
      tx,
      prepared,
      randomUuid,
    ));
  });

  const inspect = Effect.fn("ApplicationAnalysisRepository.inspect")(function* (
    authority: ApplicationAnalysisAuthority,
    candidateId: string,
  ): Effect.fn.Return<
    ApplicationAnalysisProjection,
    ApplicationAnalysisPersistenceError
  > {
    const preparedAuthority = yield* Effect.fromResult(
      prepareAuthority("inspect", authority),
    );
    if (!validIdentity(candidateId)) {
      return yield* failure("inspect", "invalidInput");
    }
    return yield* runTransaction(db, "inspect", tx => Effect.gen(function* () {
      yield* requireExactAuthority(tx, "inspect", preparedAuthority);
      return yield* loadProjection(tx, "inspect", preparedAuthority, candidateId);
    }));
  });

  return Object.freeze({ begin, settle, inspect });
}

interface PreparedBegin extends BeginApplicationAnalysisInput {
  readonly sourceRootBytes: Uint8Array;
}

function prepareBegin(
  input: BeginApplicationAnalysisInput,
): Result.Result<PreparedBegin, ApplicationAnalysisPersistenceError> {
  return Result.gen(function* () {
    const authority = yield* prepareAuthority("begin", input.authority);
    if (
      !validIdentity(input.requestKey) ||
      !validIdentity(input.analyzerIdentity) ||
      !validIdentity(input.analyzerPolicyIdentity)
    ) return yield* Result.fail(failureValue("begin", "invalidInput"));
    const sourceRootBytes = yield* decodeSha256(
      "begin",
      input.sourceArtifactRootSha256,
    );
    return Object.freeze({ ...input, authority, sourceRootBytes });
  });
}

interface PreparedTerminal {
  readonly authority: ApplicationAnalysisAuthority;
  readonly terminal: ApplicationAnalysisTerminalInput;
  readonly sourceRootBytes: Uint8Array;
  readonly canonicalManifest?: Readonly<{
    readonly manifest: ApplicationManifestV1;
    readonly canonicalBytes: Uint8Array;
  }>;
}

function prepareTerminal(
  authorityInput: ApplicationAnalysisAuthority,
  terminal: ApplicationAnalysisTerminalInput,
): Result.Result<PreparedTerminal, ApplicationAnalysisPersistenceError> {
  return Result.gen(function* () {
    const authority = yield* prepareAuthority("settle", authorityInput);
    if (
      !validIdentity(terminal.candidateId) ||
      !validIdentity(terminal.analyzerIdentity) ||
      !validIdentity(terminal.analyzerPolicyIdentity)
    ) return yield* Result.fail(failureValue("settle", "invalidInput"));
    const sourceRootBytes = yield* decodeSha256(
      "settle",
      terminal.sourceArtifactRootSha256,
    );
    if (terminal.kind === "rejected") {
      if (!isRejectionCode(terminal.failureCode)) {
        return yield* Result.fail(failureValue("settle", "invalidInput"));
      }
      const ownedTerminal = Object.freeze({ ...terminal });
      return Object.freeze({
        authority,
        terminal: ownedTerminal,
        sourceRootBytes,
      });
    }
    if (
      UTF8.encode(terminal.canonicalManifest).byteLength >
        APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1
    ) return yield* Result.fail(failureValue("settle", "invalidInput"));
    let parsed: unknown;
    try {
      parsed = JSON.parse(terminal.canonicalManifest);
    } catch (cause) {
      return yield* Result.fail(failureValue(
        "settle",
        "invalidInput",
        false,
        cause,
      ));
    }
    const canonical = yield* canonicalizeApplicationManifestV1(parsed).pipe(
      Result.mapError(cause => failureValue(
        "settle",
        "invalidInput",
        false,
        cause,
      )),
    );
    if (
      canonical.canonicalText !== terminal.canonicalManifest ||
      canonical.manifest.sourceArtifact.rootSha256 !==
        terminal.sourceArtifactRootSha256
    ) return yield* Result.fail(failureValue("settle", "terminalMismatch"));
    const ownedTerminal = Object.freeze({ ...terminal });
    return Object.freeze({
      authority,
      terminal: ownedTerminal,
      sourceRootBytes,
      canonicalManifest: Object.freeze({
        manifest: canonical.manifest,
        canonicalBytes: canonical.canonicalBytes,
      }),
    });
  });
}

function prepareAuthority(
  operation: ApplicationAnalysisPersistenceError["operation"],
  authority: ApplicationAnalysisAuthority,
): Result.Result<ApplicationAnalysisAuthority, ApplicationAnalysisPersistenceError> {
  return validIdentity(authority.scopeId) &&
      authority.storageGeneration === "flarexdb_v1" &&
      typeof authority.storageGenerationFence === "bigint" &&
      authority.storageGenerationFence >= 1n &&
      validIdentity(authority.epoch)
    ? Result.succeed(Object.freeze({ ...authority }))
    : Result.fail(failureValue(operation, "invalidInput"));
}

function beginInTransaction(
  tx: AppRowTransaction,
  input: PreparedBegin,
  randomUuid: () => string,
): Effect.Effect<ApplicationAnalysisProjection, ApplicationAnalysisPersistenceError> {
  return Effect.gen(function* () {
    yield* requireExactAuthority(tx, "begin", input.authority);
    const existingCandidates = yield* query(
      "begin",
      tx.select().from(fxSystemApplicationCandidatesV1).where(and(
        eq(fxSystemApplicationCandidatesV1.scopeId, input.authority.scopeId),
        eq(fxSystemApplicationCandidatesV1.requestKey, input.requestKey),
      )).limit(1).for("update"),
    );
    const existing = existingCandidates[0];
    if (existing !== undefined) {
      if (
        existing.storageGeneration !== input.authority.storageGeneration ||
        existing.storageGenerationFence !== input.authority.storageGenerationFence ||
        existing.epoch !== input.authority.epoch
      ) return yield* failure("begin", "authorityChanged");
      if (
        !bytesEqualFullScan(existing.sourceArtifactRootSha256, input.sourceRootBytes)
      ) return yield* failure("begin", "requestKeyReuse");
      const analyses = yield* query(
        "begin",
        tx.select().from(fxSystemApplicationAnalysesV1).where(and(
          eq(fxSystemApplicationAnalysesV1.scopeId, input.authority.scopeId),
          eq(fxSystemApplicationAnalysesV1.candidateId, existing.candidateId),
        )).limit(1).for("update"),
      );
      const analysis = analyses[0];
      if (
        analysis === undefined ||
        analysis.analyzerIdentity !== input.analyzerIdentity ||
        analysis.analyzerPolicyIdentity !== input.analyzerPolicyIdentity
      ) return yield* failure("begin", "requestKeyReuse");
      return yield* projectionFromRows(tx, "begin", input.authority, existing, analysis);
    }
    const identities = yield* issueIdentities("begin", randomUuid, [
      "candidate",
      "analysis",
    ]);
    const candidateId = identities.candidate;
    const analysisId = identities.analysis;
    const candidateInsert: typeof fxSystemApplicationCandidatesV1.$inferInsert = {
      scopeId: input.authority.scopeId,
      candidateId,
      requestKey: input.requestKey,
      sourceArtifactRootSha256: input.sourceRootBytes,
      storageGeneration: input.authority.storageGeneration,
      storageGenerationFence: input.authority.storageGenerationFence,
      epoch: input.authority.epoch,
    };
    const candidateRows = yield* query(
      "begin",
      tx.insert(fxSystemApplicationCandidatesV1).values(candidateInsert).returning(),
    );
    const candidate = candidateRows[0];
    if (candidate === undefined) return yield* failure("begin", "storedState");
    const analysisRows = yield* query(
      "begin",
      tx.insert(fxSystemApplicationAnalysesV1).values({
        scopeId: input.authority.scopeId,
        analysisId,
        candidateId,
        sourceArtifactRootSha256: input.sourceRootBytes,
        analyzerIdentity: input.analyzerIdentity,
        analyzerPolicyIdentity: input.analyzerPolicyIdentity,
        status: "pending",
      }).returning(),
    );
    const analysis = analysisRows[0];
    return analysis === undefined
      ? yield* failure("begin", "storedState")
      : pendingProjection(candidate, analysis);
  });
}

function settleInTransaction(
  tx: AppRowTransaction,
  prepared: PreparedTerminal,
  randomUuid: () => string,
): Effect.Effect<ApplicationAnalysisProjection, ApplicationAnalysisPersistenceError> {
  return Effect.gen(function* () {
    yield* requireExactAuthority(tx, "settle", prepared.authority);
    const candidateRows = yield* query(
      "settle",
      tx.select().from(fxSystemApplicationCandidatesV1).where(and(
        eq(fxSystemApplicationCandidatesV1.scopeId, prepared.authority.scopeId),
        eq(fxSystemApplicationCandidatesV1.candidateId, prepared.terminal.candidateId),
      )).limit(1).for("update"),
    );
    const candidate = candidateRows[0];
    if (candidate === undefined) return yield* failure("settle", "candidateMissing");
    if (!candidateAuthorityMatches(candidate, prepared.authority)) {
      return yield* failure("settle", "authorityChanged");
    }
    const analysisRows = yield* query(
      "settle",
      tx.select().from(fxSystemApplicationAnalysesV1).where(and(
        eq(fxSystemApplicationAnalysesV1.scopeId, prepared.authority.scopeId),
        eq(fxSystemApplicationAnalysesV1.candidateId, candidate.candidateId),
      )).limit(1).for("update"),
    );
    const analysis = analysisRows[0];
    if (analysis === undefined) return yield* failure("settle", "storedState");
    if (
      !bytesEqualFullScan(candidate.sourceArtifactRootSha256, prepared.sourceRootBytes) ||
      !bytesEqualFullScan(analysis.sourceArtifactRootSha256, prepared.sourceRootBytes) ||
      analysis.analyzerIdentity !== prepared.terminal.analyzerIdentity ||
      analysis.analyzerPolicyIdentity !==
        prepared.terminal.analyzerPolicyIdentity
    ) return yield* failure("settle", "terminalMismatch");
    if (analysis.status !== "pending") {
      return yield* projectionFromRows(
        tx,
        "settle",
        prepared.authority,
        candidate,
        analysis,
      );
    }
    const completedAt = yield* databaseTime(tx, "settle", prepared.authority.scopeId);
    const manifestSha256 = prepared.canonicalManifest === undefined
      ? undefined
      : yield* sha256("settle", prepared.canonicalManifest.canonicalBytes);
    const manifestSha256Hex = manifestSha256 === undefined
      ? undefined
      : encodeBytesToLowercaseHex(manifestSha256);
    if (
      prepared.terminal.kind === "analyzed" &&
      manifestSha256Hex === undefined
    ) {
      return yield* Effect.die(
        new Error("Analyzed settlement lost its manifest digest."),
      );
    }
    const receiptValue = prepared.terminal.kind === "analyzed"
      ? {
        format: "flarex.application-analysis-receipt" as const,
        version: 1 as const,
        analysisId: analysis.analysisId,
        candidateId: candidate.candidateId,
        scopeId: prepared.authority.scopeId,
        sourceArtifactRootSha256: prepared.terminal.sourceArtifactRootSha256,
        analyzerIdentity: analysis.analyzerIdentity,
        analyzerPolicyIdentity: analysis.analyzerPolicyIdentity,
        completedAt: completedAt.toISOString(),
        status: "analyzed" as const,
        manifestSha256: manifestSha256Hex,
      }
      : {
        format: "flarex.application-analysis-receipt" as const,
        version: 1 as const,
        analysisId: analysis.analysisId,
        candidateId: candidate.candidateId,
        scopeId: prepared.authority.scopeId,
        sourceArtifactRootSha256: prepared.terminal.sourceArtifactRootSha256,
        analyzerIdentity: analysis.analyzerIdentity,
        analyzerPolicyIdentity: analysis.analyzerPolicyIdentity,
        completedAt: completedAt.toISOString(),
        status: "rejected" as const,
        failureCode: prepared.terminal.failureCode,
        detail: prepared.terminal.detail,
      };
    const canonicalReceipt = yield* Effect.fromResult(
      canonicalizeApplicationAnalysisReceiptV1(receiptValue).pipe(
        Result.mapError(cause => failureValue(
          "settle",
          "invalidInput",
          false,
          cause,
        )),
      ),
    );
    const receiptSha256 = yield* sha256("settle", canonicalReceipt.canonicalBytes);
    const updatedRows = yield* query(
      "settle",
      tx.update(fxSystemApplicationAnalysesV1).set({
        status: prepared.terminal.kind,
        manifestSha256: manifestSha256 ?? null,
        manifestBytes: prepared.canonicalManifest?.canonicalBytes ?? null,
        receiptSha256,
        receiptBytes: canonicalReceipt.canonicalBytes,
        failureCode: prepared.terminal.kind === "rejected"
          ? prepared.terminal.failureCode
          : null,
        failureDetail: prepared.terminal.kind === "rejected"
          ? prepared.terminal.detail
          : null,
        completedAt,
        updatedAt: completedAt,
      }).where(and(
        eq(fxSystemApplicationAnalysesV1.scopeId, prepared.authority.scopeId),
        eq(fxSystemApplicationAnalysesV1.analysisId, analysis.analysisId),
        eq(fxSystemApplicationAnalysesV1.status, "pending"),
      )).returning(),
    );
    const updated = updatedRows[0];
    if (updated === undefined) return yield* failure("settle", "storedState");
    if (prepared.terminal.kind === "analyzed") {
      if (manifestSha256 === undefined) {
        return yield* Effect.die(
          new Error("Analyzed settlement lost its manifest digest."),
        );
      }
      const identities = yield* issueIdentities("settle", randomUuid, ["revision"]);
      const revisionRows = yield* query(
        "settle",
        tx.insert(fxSystemApplicationRevisionsV2).values({
          scopeId: prepared.authority.scopeId,
          revisionId: identities.revision,
          candidateId: candidate.candidateId,
          analysisId: analysis.analysisId,
          analysisStatus: "analyzed",
          sourceArtifactRootSha256: prepared.sourceRootBytes,
          manifestSha256,
          status: "inactive",
          registeredAt: completedAt,
        }).returning(),
      );
      if (revisionRows[0] === undefined) {
        return yield* failure("settle", "storedState");
      }
    }
    return yield* projectionFromRows(
      tx,
      "settle",
      prepared.authority,
      candidate,
      updated,
    );
  });
}

function loadProjection(
  tx: AppRowTransaction,
  operation: ApplicationAnalysisPersistenceError["operation"],
  authority: ApplicationAnalysisAuthority,
  candidateId: string,
): Effect.Effect<ApplicationAnalysisProjection, ApplicationAnalysisPersistenceError> {
  return Effect.gen(function* () {
    const candidateRows = yield* query(
      operation,
      tx.select().from(fxSystemApplicationCandidatesV1).where(and(
        eq(fxSystemApplicationCandidatesV1.scopeId, authority.scopeId),
        eq(fxSystemApplicationCandidatesV1.candidateId, candidateId),
      )).limit(1).for("update"),
    );
    const candidate = candidateRows[0];
    if (candidate === undefined) return yield* failure(operation, "candidateMissing");
    const analysisRows = yield* query(
      operation,
      tx.select().from(fxSystemApplicationAnalysesV1).where(and(
        eq(fxSystemApplicationAnalysesV1.scopeId, authority.scopeId),
        eq(fxSystemApplicationAnalysesV1.candidateId, candidateId),
      )).limit(1).for("update"),
    );
    const analysis = analysisRows[0];
    return analysis === undefined
      ? yield* failure(operation, "storedState")
      : yield* projectionFromRows(tx, operation, authority, candidate, analysis);
  });
}

type CandidateRow = typeof fxSystemApplicationCandidatesV1.$inferSelect;
type AnalysisRow = typeof fxSystemApplicationAnalysesV1.$inferSelect;

function candidateAuthorityMatches(
  candidate: CandidateRow,
  authority: ApplicationAnalysisAuthority,
): boolean {
  return candidate.storageGeneration === authority.storageGeneration &&
    candidate.storageGenerationFence === authority.storageGenerationFence &&
    candidate.epoch === authority.epoch;
}

function projectionFromRows(
  tx: AppRowTransaction,
  operation: ApplicationAnalysisPersistenceError["operation"],
  authority: ApplicationAnalysisAuthority,
  candidate: CandidateRow,
  analysis: AnalysisRow,
): Effect.Effect<ApplicationAnalysisProjection, ApplicationAnalysisPersistenceError> {
  return Effect.gen(function* () {
    if (!candidateAuthorityMatches(candidate, authority)) {
      return yield* failure(operation, "authorityChanged");
    }
    if (
      candidate.scopeId !== authority.scopeId ||
      analysis.scopeId !== authority.scopeId ||
      analysis.candidateId !== candidate.candidateId ||
      !bytesEqualFullScan(
        analysis.sourceArtifactRootSha256,
        candidate.sourceArtifactRootSha256,
      )
    ) return yield* failure(operation, "storedState");
    if (analysis.status === "pending") return pendingProjection(candidate, analysis);
    const receipt = yield* decodeStoredReceipt(operation, candidate, analysis);
    const base = projectionBase(candidate, analysis);
    if (analysis.status === "rejected") {
      if (
        receipt.receipt.status !== "rejected" ||
        receipt.receipt.failureCode !== analysis.failureCode ||
        receipt.receipt.detail !== analysis.failureDetail
      ) return yield* failure(operation, "storedState");
      return Object.freeze({
        ...base,
        status: "rejected" as const,
        receipt: receipt.receipt,
        receiptSha256: receipt.sha256,
      });
    }
    const manifest = yield* decodeStoredManifest(operation, candidate, analysis);
    if (
      receipt.receipt.status !== "analyzed" ||
      receipt.receipt.manifestSha256 !== manifest.sha256
    ) return yield* failure(operation, "storedState");
    const revisionRows = yield* query(
      operation,
      tx.select().from(fxSystemApplicationRevisionsV2).where(and(
        eq(fxSystemApplicationRevisionsV2.scopeId, authority.scopeId),
        eq(fxSystemApplicationRevisionsV2.analysisId, analysis.analysisId),
      )).limit(1).for("update"),
    );
    const revision = revisionRows[0];
    const registeredAt = databaseTimestampFromUnknown(revision?.registeredAt);
    if (
      revision === undefined ||
      registeredAt === null ||
      revision.candidateId !== candidate.candidateId ||
      revision.analysisStatus !== "analyzed" ||
      revision.status !== "inactive" ||
      !bytesEqualFullScan(
        revision.sourceArtifactRootSha256,
        candidate.sourceArtifactRootSha256,
      ) ||
      analysis.manifestSha256 === null ||
      !bytesEqualFullScan(revision.manifestSha256, analysis.manifestSha256)
    ) return yield* failure(operation, "storedState");
    return Object.freeze({
      ...base,
      status: "analyzed" as const,
      receipt: receipt.receipt,
      receiptSha256: receipt.sha256,
      manifest: manifest.manifest,
      manifestSha256: manifest.sha256,
      revision: Object.freeze({
        revisionId: revision.revisionId,
        status: "inactive" as const,
        registeredAt,
      }),
    });
  });
}

function pendingProjection(
  candidate: CandidateRow,
  analysis: AnalysisRow,
): ApplicationAnalysisProjection {
  return Object.freeze({
    ...projectionBase(candidate, analysis),
    status: "pending" as const,
  });
}

function projectionBase(
  candidate: CandidateRow,
  analysis: AnalysisRow,
): ApplicationAnalysisProjectionBase {
  return Object.freeze({
    scopeId: candidate.scopeId,
    candidateId: candidate.candidateId,
    analysisId: analysis.analysisId,
    sourceArtifactRootSha256: encodeBytesToLowercaseHex(
      candidate.sourceArtifactRootSha256,
    ),
    analyzerIdentity: analysis.analyzerIdentity,
    analyzerPolicyIdentity: analysis.analyzerPolicyIdentity,
  });
}

function decodeStoredReceipt(
  operation: ApplicationAnalysisPersistenceError["operation"],
  candidate: CandidateRow,
  analysis: AnalysisRow,
): Effect.Effect<
  Readonly<{ readonly receipt: ApplicationAnalysisReceiptV1; readonly sha256: string }>,
  ApplicationAnalysisPersistenceError
> {
  return Effect.gen(function* () {
    if (analysis.receiptBytes === null || analysis.receiptSha256 === null) {
      return yield* failure(operation, "storedState");
    }
    const canonical = yield* decodeCanonicalReceipt(
      operation,
      analysis.receiptBytes,
    );
    const digest = yield* sha256(operation, canonical.canonicalBytes);
    if (
      !bytesEqualFullScan(digest, analysis.receiptSha256) ||
      canonical.receipt.analysisId !== analysis.analysisId ||
      canonical.receipt.candidateId !== candidate.candidateId ||
      canonical.receipt.scopeId !== candidate.scopeId ||
      canonical.receipt.sourceArtifactRootSha256 !==
        encodeBytesToLowercaseHex(candidate.sourceArtifactRootSha256) ||
      canonical.receipt.analyzerIdentity !== analysis.analyzerIdentity ||
      canonical.receipt.analyzerPolicyIdentity !== analysis.analyzerPolicyIdentity ||
      canonical.receipt.status !== analysis.status
    ) return yield* failure(operation, "storedState");
    return Object.freeze({
      receipt: canonical.receipt,
      sha256: encodeBytesToLowercaseHex(digest),
    });
  });
}

function decodeStoredManifest(
  operation: ApplicationAnalysisPersistenceError["operation"],
  candidate: CandidateRow,
  analysis: AnalysisRow,
): Effect.Effect<
  Readonly<{ readonly manifest: ApplicationManifestV1; readonly sha256: string }>,
  ApplicationAnalysisPersistenceError
> {
  return Effect.gen(function* () {
    if (analysis.manifestBytes === null || analysis.manifestSha256 === null) {
      return yield* failure(operation, "storedState");
    }
    const canonical = yield* decodeCanonicalManifest(
      operation,
      analysis.manifestBytes,
    );
    const digest = yield* sha256(operation, canonical.canonicalBytes);
    if (
      !bytesEqualFullScan(digest, analysis.manifestSha256) ||
      canonical.manifest.sourceArtifact.rootSha256 !==
        encodeBytesToLowercaseHex(candidate.sourceArtifactRootSha256)
    ) return yield* failure(operation, "storedState");
    return Object.freeze({
      manifest: canonical.manifest,
      sha256: encodeBytesToLowercaseHex(digest),
    });
  });
}

function decodeCanonicalReceipt(
  operation: ApplicationAnalysisPersistenceError["operation"],
  bytes: Uint8Array,
) {
  return decodeCanonical(
    operation,
    bytes,
    canonicalizeApplicationAnalysisReceiptV1,
  );
}

function decodeCanonicalManifest(
  operation: ApplicationAnalysisPersistenceError["operation"],
  bytes: Uint8Array,
) {
  return decodeCanonical(operation, bytes, canonicalizeApplicationManifestV1);
}

function decodeCanonical<A extends { readonly canonicalBytes: Uint8Array }>(
  operation: ApplicationAnalysisPersistenceError["operation"],
  bytes: Uint8Array,
  canonicalize: (value: unknown) => Result.Result<A, unknown>,
): Effect.Effect<A, ApplicationAnalysisPersistenceError> {
  return Effect.gen(function* () {
    let parsed: unknown;
    try {
      parsed = JSON.parse(FATAL_UTF8.decode(bytes));
    } catch (cause) {
      return yield* failure(operation, "storedState", false, cause);
    }
    const canonical = yield* Effect.fromResult(canonicalize(parsed).pipe(
      Result.mapError(cause => failureValue(
        operation,
        "storedState",
        false,
        cause,
      )),
    ));
    return bytesEqualFullScan(bytes, canonical.canonicalBytes)
      ? canonical
      : yield* failure(operation, "storedState");
  });
}

function requireExactAuthority(
  tx: AppRowTransaction,
  operation: ApplicationAnalysisPersistenceError["operation"],
  authority: ApplicationAnalysisAuthority,
): Effect.Effect<void, ApplicationAnalysisPersistenceError> {
  return Effect.gen(function* () {
    const rows = yield* query(
      operation,
      tx.select().from(fxSystemScopeClocks).where(
        eq(fxSystemScopeClocks.scopeId, authority.scopeId),
      ).limit(1).for("update"),
    );
    const clock = rows[0];
    if (
      clock === undefined ||
      clock.storageGeneration !== authority.storageGeneration ||
      clock.storageGenerationFence !== authority.storageGenerationFence ||
      clock.epoch !== authority.epoch
    ) return yield* failure(operation, "authorityChanged");
  });
}

function databaseTime(
  tx: AppRowTransaction,
  operation: ApplicationAnalysisPersistenceError["operation"],
  scopeId: ScopeId,
): Effect.Effect<Date, ApplicationAnalysisPersistenceError> {
  return query(
    operation,
    tx.select({ now: sql<Date>`current_timestamp` })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, scopeId))
      .limit(1),
  ).pipe(Effect.flatMap(rows => {
    const date = databaseTimestampFromUnknown(rows[0]?.now);
    return date === null
      ? failure(operation, "storedState")
      : Effect.succeed(date);
  }));
}

function query<Row>(
  operation: ApplicationAnalysisPersistenceError["operation"],
  statement: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<ReadonlyArray<Row>, ApplicationAnalysisPersistenceError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => failureValue(
      operation,
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  });
}

function runTransaction<A>(
  db: FlarexMetadataDatabase,
  operation: ApplicationAnalysisPersistenceError["operation"],
  body: (
    tx: AppRowTransaction,
  ) => Effect.Effect<A, ApplicationAnalysisPersistenceError>,
): Effect.Effect<A, ApplicationAnalysisPersistenceError> {
  return runEffectTransaction(
    callback => db.transaction(callback),
    "Application Analysis transaction rolled back.",
    body,
    cause => failureValue(
      operation,
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  );
}

function sha256(
  operation: ApplicationAnalysisPersistenceError["operation"],
  bytes: Uint8Array,
): Effect.Effect<Uint8Array, ApplicationAnalysisPersistenceError> {
  return Effect.tryPromise({
    try: async () => new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    )),
    catch: cause => failureValue(
      operation,
      "resourceFailure",
      true,
      cause,
    ),
  }).pipe(Effect.flatMap(digest => digest.byteLength === 32
    ? Effect.succeed(digest)
    : Effect.die(new Error("SHA-256 returned a non-32-byte digest."))));
}

function issueIdentities<K extends string>(
  operation: ApplicationAnalysisPersistenceError["operation"],
  randomUuid: () => string,
  kinds: readonly K[],
): Effect.Effect<Readonly<Record<K, string>>, ApplicationAnalysisPersistenceError> {
  return Effect.try({
    try: () => {
      // SAFETY: the loop below assigns exactly one entry per requested
      // kind, so the record carries every K key.
      const identities = {} as Record<K, string>;
      for (const kind of kinds) {
        const uuid = randomUuid();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
          throw new Error("Identity generator returned a non-canonical UUID.");
        }
        identities[kind] = `app_${kind}_${uuid}`;
      }
      return Object.freeze(identities);
    },
    catch: cause => failureValue(
      operation,
      "resourceFailure",
      false,
      cause,
    ),
  });
}

function decodeSha256(
  operation: ApplicationAnalysisPersistenceError["operation"],
  value: string,
): Result.Result<Uint8Array, ApplicationAnalysisPersistenceError> {
  if (!LOWERCASE_SHA256.test(value)) {
    return Result.fail(failureValue(operation, "invalidInput"));
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return Result.succeed(bytes);
}

function validIdentity(value: string): boolean {
  return value.length >= 1 && value.length <= IDENTITY_MAXIMUM_LENGTH &&
    !value.includes("\0");
}

function isRejectionCode(value: unknown): value is ApplicationAnalysisRejectionCode {
  return typeof value === "string" &&
    Object.values(ApplicationAnalysisRejectionCodeV1).some(code => code === value);
}

function failure(
  operation: ApplicationAnalysisPersistenceError["operation"],
  reason: ApplicationAnalysisPersistenceError["reason"],
  retryable = false,
  cause?: unknown,
): Effect.Effect<never, ApplicationAnalysisPersistenceError> {
  return Effect.fail(failureValue(operation, reason, retryable, cause));
}

function failureValue(
  operation: ApplicationAnalysisPersistenceError["operation"],
  reason: ApplicationAnalysisPersistenceError["reason"],
  retryable = false,
  cause?: unknown,
): ApplicationAnalysisPersistenceError {
  return new ApplicationAnalysisPersistenceError({
    operation,
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}

function isRetryableTransactionCause(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const code = Reflect.get(cause, "code");
  return code === "40001" || code === "40P01";
}
