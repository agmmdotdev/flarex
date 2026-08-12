import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import {
  encodeCanonicalJson,
  isJson,
  type Json,
} from "flarex-protocol/json";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export interface ApplicationActivationFrameInput {
  readonly scopeId: string;
  readonly activationSequence: bigint;
  readonly previousActivationSequence: bigint | null;
  readonly revisionId: string;
  readonly readinessSha256: Uint8Array;
  readonly activationRequestSha256: Uint8Array;
  readonly activatedAtIso: string;
}

export interface ApplicationActiveHeadFrameInput {
  readonly scopeId: string;
  readonly activationSequence: bigint;
  readonly revisionId: string;
  readonly readinessSha256: Uint8Array;
  readonly activationSha256: Uint8Array;
}

export interface ApplicationSchemaBindingFrameInput {
  readonly deploymentId: string;
  readonly applicationSchemaSha256: string;
  readonly schemaVersionId: string;
  readonly schemaVersion: number;
  readonly schemaManifestSha256: string;
  readonly tables: ReadonlyArray<Json>;
  readonly indexes: ReadonlyArray<Json>;
}

export interface ApplicationColdReceiptSetFrameInput {
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly entries: ReadonlyArray<Readonly<{
    readonly functionPath: string;
    readonly runtimeTargetSha256: string;
    readonly coldReceiptSha256: string;
  }>>;
}

export interface ApplicationReadinessFrameProjection {
  readonly scopeId: string;
  readonly deploymentId: string;
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly storageGeneration: string;
  readonly storageGenerationFence: string;
  readonly epoch: string;
  readonly sourceArtifactRootSha256: string;
  readonly manifestSha256: string;
  readonly publicationSha256: string;
  readonly applicationSchemaSha256: string;
  readonly functionCatalogSha256: string;
  readonly schemaVersionId: string;
  readonly schemaManifestSha256: string;
  readonly schemaBindingSha256: string;
  readonly taskCatalogBindingSha256: string;
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly coldReceiptSetSha256: string;
  readonly candidateValidationReceiptSha256: string;
  readonly uniqueConstraintStatus: "not_required" | "eligible";
  readonly uniqueConstraintEligibilitySha256: string;
  readonly physicalReadinessSha256: string;
  readonly coldReceipts: ReadonlyArray<Readonly<{
    readonly functionPath: string;
    readonly runtimeTargetSha256: string;
    readonly coldReceiptSha256: string;
  }>>;
  readonly readyAt: string;
}

export function applicationActivationFrameBytes(
  input: ApplicationActivationFrameInput,
): Result.Result<Uint8Array, Error> {
  return canonicalFrame({
    format: "flarex.application-activation",
    version: 1,
    scopeId: input.scopeId,
    activationSequence: input.activationSequence.toString(),
    previousActivationSequence:
      input.previousActivationSequence?.toString() ?? null,
    revisionId: input.revisionId,
    readinessSha256: encodeBytesToLowercaseHex(input.readinessSha256),
    activationRequestSha256:
      encodeBytesToLowercaseHex(input.activationRequestSha256),
    activatedAt: input.activatedAtIso,
  });
}

export function applicationActiveHeadFrameBytes(
  input: ApplicationActiveHeadFrameInput,
): Result.Result<Uint8Array, Error> {
  return canonicalFrame({
    format: "flarex.application-active-head",
    version: 1,
    scopeId: input.scopeId,
    activationSequence: input.activationSequence.toString(),
    revisionId: input.revisionId,
    readinessSha256: encodeBytesToLowercaseHex(input.readinessSha256),
    activationSha256: encodeBytesToLowercaseHex(input.activationSha256),
  });
}

export function applicationSchemaBindingFrameBytes(
  input: ApplicationSchemaBindingFrameInput,
): Result.Result<Uint8Array, Error> {
  return canonicalFrame({
    format: "flarex.application-schema-binding",
    version: 1,
    deploymentId: input.deploymentId,
    applicationSchemaSha256: input.applicationSchemaSha256,
    schemaVersionId: input.schemaVersionId,
    schemaVersion: input.schemaVersion,
    schemaManifestSha256: input.schemaManifestSha256,
    tables: input.tables,
    indexes: input.indexes,
  });
}

export function applicationColdReceiptSetFrameBytes(
  input: ApplicationColdReceiptSetFrameInput,
): Result.Result<Uint8Array, Error> {
  return canonicalFrame({
    format: "flarex.application-cold-receipt-set",
    version: 1,
    runtimeHostIdentity: input.runtimeHostIdentity,
    compatibilityDate: input.compatibilityDate,
    entries: input.entries.map(entry => ({ ...entry })),
  });
}

export function validateCanonicalFrame(
  bytes: Uint8Array,
  expectedSha256: Uint8Array,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_FRAME_BYTES) {
      return yield* Effect.fail(new Error("Application frame size invalid."));
    }
    const actualSha256 = yield* sha256(bytes);
    if (!bytesEqualFullScan(actualSha256, expectedSha256)) {
      return yield* Effect.fail(new Error("Application frame digest mismatch."));
    }
    const value = yield* Effect.try({
      try: () => JSON.parse(UTF8_FATAL.decode(bytes)) as unknown,
      catch: cause => new Error("Application frame JSON invalid.", { cause }),
    });
    const canonical = yield* Effect.fromResult(canonicalFrame(value));
    if (!bytesEqualFullScan(canonical, bytes)) {
      return yield* Effect.fail(new Error("Application frame is noncanonical."));
    }
  });
}

export function decodeApplicationReadinessFrame(
  bytes: Uint8Array,
): Result.Result<ApplicationReadinessFrameProjection, Error> {
  return Result.try({
    try: () => {
      const value = JSON.parse(UTF8_FATAL.decode(bytes)) as unknown;
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Application readiness frame is not a record.");
      }
      const expected = [
        "format", "version", "status", "scopeId", "deploymentId",
        "revisionId", "candidateId", "analysisId", "storageGeneration",
        "storageGenerationFence", "epoch", "sourceArtifactRootSha256",
        "manifestSha256", "publicationSha256", "applicationSchemaSha256",
        "functionCatalogSha256", "schemaVersionId", "schemaManifestSha256",
        "schemaBindingSha256", "taskCatalogBindingSha256",
        "runtimeHostIdentity", "compatibilityDate", "coldReceiptSetSha256",
        "candidateValidationReceiptSha256", "uniqueConstraintStatus",
        "uniqueConstraintEligibilitySha256", "physicalReadinessSha256",
        "coldReceipts", "readyAt",
      ] as const;
      const record = value as Record<string, unknown>;
      const keys = Reflect.ownKeys(record);
      if (keys.length !== expected.length || keys.some(key =>
        typeof key !== "string" || !expected.includes(
          key as typeof expected[number],
        ))) throw new Error("Application readiness frame keys are invalid.");
      const shaFields = [
        "sourceArtifactRootSha256", "manifestSha256", "publicationSha256",
        "applicationSchemaSha256", "functionCatalogSha256",
        "schemaManifestSha256", "schemaBindingSha256",
        "taskCatalogBindingSha256", "coldReceiptSetSha256",
        "candidateValidationReceiptSha256",
        "uniqueConstraintEligibilitySha256", "physicalReadinessSha256",
      ] as const;
      const textFields = [
        "scopeId", "deploymentId", "revisionId", "candidateId", "analysisId",
        "storageGeneration", "storageGenerationFence", "epoch",
        "schemaVersionId", "runtimeHostIdentity", "compatibilityDate",
        "readyAt",
      ] as const;
      if (record.format !== "flarex.application-readiness" ||
        record.version !== 1 || record.status !== "ready" ||
        textFields.some(field => typeof record[field] !== "string") ||
        shaFields.some(field => typeof record[field] !== "string" ||
          !/^[0-9a-f]{64}$/.test(record[field] as string)) ||
        (record.uniqueConstraintStatus !== "not_required" &&
          record.uniqueConstraintStatus !== "eligible") ||
        !Array.isArray(record.coldReceipts)) {
        throw new Error("Application readiness frame fields are invalid.");
      }
      const coldReceipts = record.coldReceipts.map(entry => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          throw new Error("Application readiness cold receipt is invalid.");
        }
        const item = entry as Record<string, unknown>;
        const itemKeys = Reflect.ownKeys(item);
        if (itemKeys.length !== 3 ||
          itemKeys.some(key => typeof key !== "string" || ![
            "functionPath", "runtimeTargetSha256", "coldReceiptSha256",
          ].includes(key)) ||
          typeof item.functionPath !== "string" ||
          typeof item.runtimeTargetSha256 !== "string" ||
          typeof item.coldReceiptSha256 !== "string" ||
          !/^[0-9a-f]{64}$/.test(item.runtimeTargetSha256) ||
          !/^[0-9a-f]{64}$/.test(item.coldReceiptSha256)) {
          throw new Error("Application readiness cold receipt is invalid.");
        }
        return Object.freeze({
          functionPath: item.functionPath,
          runtimeTargetSha256: item.runtimeTargetSha256,
          coldReceiptSha256: item.coldReceiptSha256,
        });
      });
      const text = (field: typeof textFields[number]): string => {
        const fieldValue = record[field];
        if (typeof fieldValue !== "string") {
          throw new Error("Application readiness frame field is invalid.");
        }
        return fieldValue;
      };
      const sha = (field: typeof shaFields[number]): string => {
        const fieldValue = record[field];
        if (typeof fieldValue !== "string" ||
          !/^[0-9a-f]{64}$/.test(fieldValue)) {
          throw new Error("Application readiness frame digest is invalid.");
        }
        return fieldValue;
      };
      return Object.freeze({
        scopeId: text("scopeId"),
        deploymentId: text("deploymentId"),
        revisionId: text("revisionId"),
        candidateId: text("candidateId"),
        analysisId: text("analysisId"),
        storageGeneration: text("storageGeneration"),
        storageGenerationFence: text("storageGenerationFence"),
        epoch: text("epoch"),
        sourceArtifactRootSha256: sha("sourceArtifactRootSha256"),
        manifestSha256: sha("manifestSha256"),
        publicationSha256: sha("publicationSha256"),
        applicationSchemaSha256: sha("applicationSchemaSha256"),
        functionCatalogSha256: sha("functionCatalogSha256"),
        schemaVersionId: text("schemaVersionId"),
        schemaManifestSha256: sha("schemaManifestSha256"),
        schemaBindingSha256: sha("schemaBindingSha256"),
        taskCatalogBindingSha256: sha("taskCatalogBindingSha256"),
        runtimeHostIdentity: text("runtimeHostIdentity"),
        compatibilityDate: text("compatibilityDate"),
        coldReceiptSetSha256: sha("coldReceiptSetSha256"),
        candidateValidationReceiptSha256:
          sha("candidateValidationReceiptSha256"),
        uniqueConstraintStatus: record.uniqueConstraintStatus,
        uniqueConstraintEligibilitySha256:
          sha("uniqueConstraintEligibilitySha256"),
        physicalReadinessSha256: sha("physicalReadinessSha256"),
        coldReceipts: Object.freeze(coldReceipts),
        readyAt: text("readyAt"),
      });
    },
    catch: cause => cause instanceof Error
      ? cause
      : new Error("Application readiness frame is invalid.", { cause }),
  });
}

export function sha256(
  bytes: Uint8Array,
): Effect.Effect<Uint8Array, Error> {
  return Effect.tryPromise({
    try: () => globalThis.crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    ),
    catch: cause => new Error("Application frame hashing failed.", { cause }),
  }).pipe(Effect.map(buffer => copyBytes(new Uint8Array(buffer))));
}

function canonicalFrame(value: unknown): Result.Result<Uint8Array, Error> {
  return Result.try({
    try: () => {
      if (!isJson(value)) throw new Error("Application frame is not JSON.");
      const bytes = UTF8.encode(encodeCanonicalJson(value, issue => {
        throw new Error(`Application frame invariant: ${issue.reason}`);
      }));
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_FRAME_BYTES) {
        throw new Error("Application frame size invalid.");
      }
      return bytes;
    },
    catch: cause => cause instanceof Error
      ? cause
      : new Error("Application frame invalid.", { cause }),
  });
}
