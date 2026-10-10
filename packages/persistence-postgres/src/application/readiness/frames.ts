import type { PreparedReadiness } from "./identity";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { StoredBundle } from "./bundle";
import type { ColdEvidence } from "./coldEvidence";
import {
  encodeBytesToLowercaseHex,
  copyBytesToArrayBuffer,
} from "@flarex/utils/bytes";
import {
  type Json,
  isJson,
  encodeCanonicalJson,
} from "flarex-protocol/json";
import { UTF8 } from "./limits";
import { Effect } from "effect";

export function readinessFrame(
  prepared: PreparedReadiness,
  physicalReadinessSha256: Uint8Array,
  readyAt: Date,
): Uint8Array {
  return readinessFrameFromAuthority({
    bundle: prepared.bundle,
    schemaVersionId: prepared.schema.schemaVersionId,
    schemaManifestSha256Hex: prepared.schema.schemaManifestSha256,
    schemaBindingSha256: prepared.schemaBindingSha256,
    runtimeHostIdentity: prepared.runtimeHostIdentity,
    compatibilityDate: prepared.compatibilityDate,
    coldReceiptSetSha256: prepared.coldReceiptSetSha256,
    candidateValidationReceiptSha256Hex:
      prepared.candidateValidation.receiptSha256Hex,
    uniqueConstraintStatus: prepared.uniqueConstraintEligibility.status,
    uniqueConstraintEligibilitySha256:
      prepared.uniqueConstraintEligibilitySha256,
    physicalReadinessSha256,
    cold: prepared.cold,
  }, readyAt);
}

interface ReadinessFrameAuthority {
  readonly bundle: StoredBundle;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly schemaManifestSha256Hex: string;
  readonly schemaBindingSha256: Uint8Array;
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly coldReceiptSetSha256: Uint8Array;
  readonly candidateValidationReceiptSha256Hex: string;
  readonly uniqueConstraintStatus: "not_required" | "eligible";
  readonly uniqueConstraintEligibilitySha256: Uint8Array;
  readonly physicalReadinessSha256: Uint8Array;
  readonly cold: ReadonlyArray<ColdEvidence>;
}

export function readinessFrameFromAuthority(
  authority: ReadinessFrameAuthority,
  readyAt: Date,
): Uint8Array {
  return canonicalBytes({
    format: "flarex.application-readiness",
    version: 1,
    status: "ready",
    scopeId: authority.bundle.revision.scopeId,
    deploymentId: authority.bundle.deploymentId,
    revisionId: authority.bundle.revision.revisionId,
    candidateId: authority.bundle.revision.candidateId,
    analysisId: authority.bundle.revision.analysisId,
    storageGeneration: authority.bundle.authority.storageGeneration,
    storageGenerationFence:
      authority.bundle.authority.storageGenerationFence.toString(),
    epoch: authority.bundle.authority.epoch,
    sourceArtifactRootSha256: encodeBytesToLowercaseHex(
      authority.bundle.revision.sourceArtifactRootSha256,
    ),
    manifestSha256:
      encodeBytesToLowercaseHex(authority.bundle.revision.manifestSha256),
    publicationSha256:
      encodeBytesToLowercaseHex(authority.bundle.publication.publicationSha256),
    applicationSchemaSha256:
      encodeBytesToLowercaseHex(authority.bundle.publication.schemaSha256),
    functionCatalogSha256: encodeBytesToLowercaseHex(
      authority.bundle.publication.functionCatalogSha256,
    ),
    schemaVersionId: authority.schemaVersionId,
    schemaManifestSha256: authority.schemaManifestSha256Hex,
    schemaBindingSha256:
      encodeBytesToLowercaseHex(authority.schemaBindingSha256),
    taskCatalogBindingSha256: encodeBytesToLowercaseHex(
      authority.bundle.task.taskCatalogBindingSha256,
    ),
    runtimeHostIdentity: authority.runtimeHostIdentity,
    compatibilityDate: authority.compatibilityDate,
    coldReceiptSetSha256:
      encodeBytesToLowercaseHex(authority.coldReceiptSetSha256),
    candidateValidationReceiptSha256:
      authority.candidateValidationReceiptSha256Hex,
    uniqueConstraintStatus: authority.uniqueConstraintStatus,
    uniqueConstraintEligibilitySha256:
      encodeBytesToLowercaseHex(authority.uniqueConstraintEligibilitySha256),
    physicalReadinessSha256:
      encodeBytesToLowercaseHex(authority.physicalReadinessSha256),
    coldReceipts: authority.cold.map(entry => ({
      functionPath: entry.functionPath,
      runtimeTargetSha256:
        encodeBytesToLowercaseHex(entry.runtimeTargetSha256),
      coldReceiptSha256: encodeBytesToLowercaseHex(entry.coldReceiptSha256),
    })),
    readyAt: readyAt.toISOString(),
  });
}

export function canonicalBytes(value: Readonly<Record<string, Json>>): Uint8Array {
  if (!isJson(value)) throw new Error("Application readiness frame is not JSON.");
  return UTF8.encode(encodeCanonicalJson(value, issue => {
    throw new Error(`Application readiness frame invariant: ${issue.reason}`);
  }));
}

export function digestCanonicalJson(
  value: Readonly<Record<string, Json>>,
): Effect.Effect<Uint8Array> {
  return sha256(canonicalBytes(value));
}

export function decodeSha256(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("Application readiness SHA-256 text is invalid.");
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function sha256(bytes: Uint8Array): Effect.Effect<Uint8Array> {
  return Effect.tryPromise(() => crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(bytes),
  )).pipe(Effect.map(buffer => new Uint8Array(buffer)), Effect.orDie);
}
