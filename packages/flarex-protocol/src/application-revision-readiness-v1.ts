import {
  bytesEqualFullScan,
  copyBytes,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Result } from "effect";

import {
  decodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2RuntimeExecutionGroupV1,
} from "./declarative-v2-physical-v1";
import {
  DECLARATIVE_V2_COLD_MATERIALIZATION_RECEIPT_CODEC_IDENTITY_V1,
} from "./declarative-v2-runtime-projection-v1";
import { isCanonicalIsoTimestamp } from "./iso-timestamp";

export const APPLICATION_REVISION_READINESS_RECEIPT_CODEC_IDENTITY_V1 =
  "flarex.system/application-revision-readiness-receipt/v1" as const;
export const APPLICATION_REVISION_READINESS_RECEIPT_CODEC_VERSION_V1 =
  1 as const;

const DOMAIN = new TextEncoder().encode(
  `${APPLICATION_REVISION_READINESS_RECEIPT_CODEC_IDENTITY_V1}\0`,
);
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const DIGEST_BYTES = 32;
const MAX_TEXT_BYTES = 1_024;
const MAX_RECEIPT_BYTES = 4_096;
const MAX_CANONICAL_BYTES = 16_384;
const MAX_U64 = 0xffff_ffff_ffff_ffffn;
const GROUP_ID = Object.freeze({ transaction: 1, edge_action: 2 } as const);
const GROUP_BY_ID = new Map<number, DeclarativeV2RuntimeExecutionGroupV1>([
  [1, "transaction"],
  [2, "edge_action"],
]);

const DIGEST_FIELDS = [
  "candidateSha256",
  "attemptSha256",
  "registrationInputSha256",
  "verifierReceiptSha256",
  "verifierTerminalProofSha256",
  "schemaArtifactSha256",
  "schemaBindingSha256",
  "functionMetadataSha256",
  "validatorRootSha256",
  "declaredHandlerSetSha256",
  "registrationRootSha256",
  "schemaValidationReceiptSha256",
  "enabledBuildRootSha256",
  "runtimeProjectionSetSha256",
  "functionGroupManifestSha256",
  "runtimePublicationRootSha256",
  "coldMaterializationRootSha256",
] as const;

const RECEIPT_FIELDS = [
  "codecIdentity",
  "group",
  "sha256",
  "canonicalBytes",
] as const;

const FRAME_FIELDS = [
  "kind",
  "revisionId",
  "scopeId",
  "storageGeneration",
  "storageGenerationFence",
  "scopeEpoch",
  ...DIGEST_FIELDS,
  "coldMaterializationReceipts",
  "readyAt",
] as const;

export interface ApplicationRevisionReadinessColdReceiptV1 {
  readonly codecIdentity:
    typeof DECLARATIVE_V2_COLD_MATERIALIZATION_RECEIPT_CODEC_IDENTITY_V1;
  readonly group: DeclarativeV2RuntimeExecutionGroupV1;
  readonly sha256: Uint8Array;
  readonly canonicalBytes: Uint8Array;
}

export interface ApplicationRevisionReadinessReceiptFrameV1 {
  readonly kind: "application_revision_readiness_receipt";
  readonly revisionId: string;
  readonly scopeId: string;
  readonly storageGeneration: "flarexdb_v1";
  readonly storageGenerationFence: bigint;
  readonly scopeEpoch: string;
  readonly candidateSha256: Uint8Array;
  readonly attemptSha256: Uint8Array;
  readonly registrationInputSha256: Uint8Array;
  readonly verifierReceiptSha256: Uint8Array;
  readonly verifierTerminalProofSha256: Uint8Array;
  readonly schemaArtifactSha256: Uint8Array;
  readonly schemaBindingSha256: Uint8Array;
  readonly functionMetadataSha256: Uint8Array;
  readonly validatorRootSha256: Uint8Array;
  readonly declaredHandlerSetSha256: Uint8Array;
  readonly registrationRootSha256: Uint8Array;
  readonly schemaValidationReceiptSha256: Uint8Array;
  readonly enabledBuildRootSha256: Uint8Array;
  readonly runtimeProjectionSetSha256: Uint8Array;
  readonly functionGroupManifestSha256: Uint8Array;
  readonly runtimePublicationRootSha256: Uint8Array;
  readonly coldMaterializationRootSha256: Uint8Array;
  readonly coldMaterializationReceipts:
    ReadonlyArray<ApplicationRevisionReadinessColdReceiptV1>;
  readonly readyAt: string;
}

export interface ApplicationRevisionReadinessReceiptEncodedV1 {
  readonly frame: ApplicationRevisionReadinessReceiptFrameV1;
  readonly canonicalBytes: Uint8Array;
}

export class ApplicationRevisionReadinessReceiptV1Error
  extends Data.TaggedError("ApplicationRevisionReadinessReceiptV1Error")<{
    readonly operation: "encode" | "decode";
    readonly reason: "invalidInput" | "malformed" | "nonCanonical";
    readonly path?: string;
  }> {}

export function encodeApplicationRevisionReadinessReceiptV1(
  input: unknown,
): Result.Result<
  ApplicationRevisionReadinessReceiptEncodedV1,
  ApplicationRevisionReadinessReceiptV1Error
> {
  return captureFrame(input, "encode").pipe(Result.map(frame => {
    const textValues = [
      frame.revisionId,
      frame.scopeId,
      frame.scopeEpoch,
      frame.readyAt,
    ].map(value => TEXT_ENCODER.encode(value));
    const byteLength = DOMAIN.byteLength + 4 +
      textValues.reduce((sum, value) => sum + 4 + value.byteLength, 0) +
      8 + DIGEST_FIELDS.length * DIGEST_BYTES + 1 +
      frame.coldMaterializationReceipts.reduce(
        (sum, receipt) => sum + 1 + DIGEST_BYTES + 4 +
          receipt.canonicalBytes.byteLength,
        0,
      );
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    bytes.set(DOMAIN, offset);
    offset += DOMAIN.byteLength;
    writeU32(bytes, offset, FRAME_FIELDS.length);
    offset += 4;
    for (const value of textValues.slice(0, 2)) {
      offset = writeBytes(bytes, offset, value);
    }
    offset = writeU64(bytes, offset, frame.storageGenerationFence);
    offset = writeBytes(bytes, offset, textValues[2]!);
    for (const field of DIGEST_FIELDS) {
      bytes.set(frame[field], offset);
      offset += DIGEST_BYTES;
    }
    bytes[offset++] = frame.coldMaterializationReceipts.length;
    for (const receipt of frame.coldMaterializationReceipts) {
      bytes[offset++] = GROUP_ID[receipt.group];
      bytes.set(receipt.sha256, offset);
      offset += DIGEST_BYTES;
      offset = writeBytes(bytes, offset, receipt.canonicalBytes);
    }
    writeBytes(bytes, offset, textValues[3]!);
    return Object.freeze({ frame: copyFrame(frame), canonicalBytes: bytes });
  }));
}

export function decodeApplicationRevisionReadinessReceiptV1(
  input: unknown,
): Result.Result<
  ApplicationRevisionReadinessReceiptEncodedV1,
  ApplicationRevisionReadinessReceiptV1Error
> {
  if (
    !isUint8Array(input) ||
    input.byteLength < DOMAIN.byteLength + 4 ||
    input.byteLength > MAX_CANONICAL_BYTES ||
    !bytesEqualFullScan(input.subarray(0, DOMAIN.byteLength), DOMAIN)
  ) {
    return Result.fail(error("decode", "malformed", "canonicalBytes"));
  }
  try {
    let offset = DOMAIN.byteLength;
    if (readU32(input, offset) !== FRAME_FIELDS.length) {
      return Result.fail(error("decode", "malformed", "fieldCount"));
    }
    offset += 4;
    const revision = readText(input, offset);
    offset = revision.offset;
    const scope = readText(input, offset);
    offset = scope.offset;
    const storageGenerationFence = readU64(input, offset);
    offset += 8;
    const epoch = readText(input, offset);
    offset = epoch.offset;
    const digests: Record<string, Uint8Array> = {};
    for (const field of DIGEST_FIELDS) {
      if (offset + DIGEST_BYTES > input.byteLength) {
        return Result.fail(error("decode", "malformed", field));
      }
      digests[field] = copyBytes(input.subarray(offset, offset + DIGEST_BYTES));
      offset += DIGEST_BYTES;
    }
    if (offset >= input.byteLength) {
      return Result.fail(error("decode", "malformed", "coldMaterializationReceipts"));
    }
    const receiptCount = input[offset++]!;
    const receipts: ApplicationRevisionReadinessColdReceiptV1[] = [];
    for (let index = 0; index < receiptCount; index += 1) {
      const group = GROUP_BY_ID.get(input[offset++]!);
      if (group === undefined || offset + DIGEST_BYTES > input.byteLength) {
        return Result.fail(error("decode", "malformed", `coldMaterializationReceipts.${index}`));
      }
      const sha256 = copyBytes(input.subarray(offset, offset + DIGEST_BYTES));
      offset += DIGEST_BYTES;
      const receiptBytes = readBytes(input, offset, MAX_RECEIPT_BYTES);
      offset = receiptBytes.offset;
      receipts.push({
        codecIdentity:
          DECLARATIVE_V2_COLD_MATERIALIZATION_RECEIPT_CODEC_IDENTITY_V1,
        group,
        sha256,
        canonicalBytes: receiptBytes.value,
      });
    }
    const readyAt = readText(input, offset);
    offset = readyAt.offset;
    if (offset !== input.byteLength) {
      return Result.fail(error("decode", "malformed", "trailingBytes"));
    }
    return Result.gen(function* () {
      const frame = yield* captureFrame({
        kind: "application_revision_readiness_receipt",
        revisionId: revision.value,
        scopeId: scope.value,
        storageGeneration: "flarexdb_v1",
        storageGenerationFence,
        scopeEpoch: epoch.value,
        ...digests,
        coldMaterializationReceipts: receipts,
        readyAt: readyAt.value,
      }, "decode");
      const encoded = yield* encodeApplicationRevisionReadinessReceiptV1(frame);
      if (!bytesEqualFullScan(encoded.canonicalBytes, input)) {
        return yield* Result.fail(error("decode", "nonCanonical", "canonicalBytes"));
      }
      return Object.freeze({ frame, canonicalBytes: copyBytes(input) });
    });
  } catch {
    return Result.fail(error("decode", "malformed", "canonicalBytes"));
  }
}

function captureFrame(
  input: unknown,
  operation: "encode" | "decode",
): Result.Result<
  ApplicationRevisionReadinessReceiptFrameV1,
  ApplicationRevisionReadinessReceiptV1Error
> {
  const snapshot = snapshotOwnDataProperties(input, FRAME_FIELDS);
  if (snapshot === undefined) return Result.fail(error(operation, "invalidInput", "frame"));
  if (snapshot.kind !== "application_revision_readiness_receipt") {
    return Result.fail(error(operation, "invalidInput", "kind"));
  }
  if (!isBoundedText(snapshot.revisionId) || !isBoundedText(snapshot.scopeId)) {
    return Result.fail(error(operation, "invalidInput", "revision"));
  }
  if (
    snapshot.storageGeneration !== "flarexdb_v1" ||
    typeof snapshot.storageGenerationFence !== "bigint" ||
    snapshot.storageGenerationFence < 1n ||
    snapshot.storageGenerationFence > MAX_U64 ||
    !isBoundedText(snapshot.scopeEpoch)
  ) {
    return Result.fail(error(operation, "invalidInput", "scopeAuthority"));
  }
  for (const field of DIGEST_FIELDS) {
    if (!isUint8ArrayWithByteLength(snapshot[field], DIGEST_BYTES)) {
      return Result.fail(error(operation, "invalidInput", field));
    }
  }
  if (!Array.isArray(snapshot.coldMaterializationReceipts)) {
    return Result.fail(error(operation, "invalidInput", "coldMaterializationReceipts"));
  }
  if (
    snapshot.coldMaterializationReceipts.length < 1 ||
    snapshot.coldMaterializationReceipts.length > 2
  ) {
    return Result.fail(error(operation, "invalidInput", "coldMaterializationReceipts.length"));
  }
  const receipts: ApplicationRevisionReadinessColdReceiptV1[] = [];
  let previousGroup = 0;
  for (let index = 0; index < snapshot.coldMaterializationReceipts.length; index += 1) {
    const raw = snapshot.coldMaterializationReceipts[index];
    const receipt = snapshotOwnDataProperties(raw, RECEIPT_FIELDS);
    if (
      receipt === undefined ||
      receipt.codecIdentity !==
        DECLARATIVE_V2_COLD_MATERIALIZATION_RECEIPT_CODEC_IDENTITY_V1 ||
      typeof receipt.group !== "string" ||
      !Object.hasOwn(GROUP_ID, receipt.group) ||
      !isUint8ArrayWithByteLength(receipt.sha256, DIGEST_BYTES) ||
      !isUint8Array(receipt.canonicalBytes) ||
      receipt.canonicalBytes.byteLength < 1 ||
      receipt.canonicalBytes.byteLength > MAX_RECEIPT_BYTES
    ) {
      return Result.fail(error(operation, "invalidInput", `coldMaterializationReceipts.${index}`));
    }
    const group = receipt.group as DeclarativeV2RuntimeExecutionGroupV1;
    if (GROUP_ID[group] <= previousGroup) {
      return Result.fail(error(operation, "invalidInput", `coldMaterializationReceipts.${index}.group`));
    }
    previousGroup = GROUP_ID[group];
    const decoded = decodeDeclarativeV2PhysicalFrameV1(receipt.canonicalBytes, {
      maximumFrameBytes: MAX_RECEIPT_BYTES,
      maximumCanonicalBytes: MAX_RECEIPT_BYTES,
    });
    const decodedFrame = Result.match(decoded, {
      onFailure: () => null,
      onSuccess: value => value.frame,
    });
    if (
      decodedFrame === null ||
      decodedFrame.kind !== "cold_materialization_receipt" ||
      decodedFrame.group !== group ||
      !bytesEqualFullScan(
        decodedFrame.candidateSha256,
        snapshot.candidateSha256 as Uint8Array,
      ) ||
      !bytesEqualFullScan(
        decodedFrame.functionGroupManifestSha256,
        snapshot.functionGroupManifestSha256 as Uint8Array,
      )
    ) {
      return Result.fail(error(operation, "invalidInput", `coldMaterializationReceipts.${index}.canonicalBytes`));
    }
    receipts.push(Object.freeze({
      codecIdentity:
        DECLARATIVE_V2_COLD_MATERIALIZATION_RECEIPT_CODEC_IDENTITY_V1,
      group,
      sha256: copyBytes(receipt.sha256 as Uint8Array),
      canonicalBytes: copyBytes(receipt.canonicalBytes as Uint8Array),
    }));
  }
  if (typeof snapshot.readyAt !== "string" || !isCanonicalIsoTimestamp(snapshot.readyAt)) {
    return Result.fail(error(operation, "invalidInput", "readyAt"));
  }
  return Result.succeed(Object.freeze({
    kind: "application_revision_readiness_receipt",
    revisionId: snapshot.revisionId as string,
    scopeId: snapshot.scopeId as string,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: snapshot.storageGenerationFence as bigint,
    scopeEpoch: snapshot.scopeEpoch as string,
    ...Object.fromEntries(DIGEST_FIELDS.map(field => [
      field,
      copyBytes(snapshot[field] as Uint8Array),
    ])),
    coldMaterializationReceipts: Object.freeze(receipts),
    readyAt: snapshot.readyAt,
  } as ApplicationRevisionReadinessReceiptFrameV1));
}

function copyFrame(
  frame: ApplicationRevisionReadinessReceiptFrameV1,
): ApplicationRevisionReadinessReceiptFrameV1 {
  return Object.freeze({
    ...frame,
    ...Object.fromEntries(DIGEST_FIELDS.map(field => [field, copyBytes(frame[field])])),
    coldMaterializationReceipts: Object.freeze(
      frame.coldMaterializationReceipts.map(receipt => Object.freeze({
        ...receipt,
        sha256: copyBytes(receipt.sha256),
        canonicalBytes: copyBytes(receipt.canonicalBytes),
      })),
    ),
  });
}

function snapshotOwnDataProperties(
  value: unknown,
  keys: ReadonlyArray<string>,
): Record<string, unknown> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    if (Reflect.ownKeys(value).length !== keys.length) return undefined;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) return undefined;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return undefined;
  }
}

function isBoundedText(value: unknown): value is string {
  return isNonBlankString(value) &&
    TEXT_ENCODER.encode(value).byteLength <= MAX_TEXT_BYTES;
}

function writeBytes(target: Uint8Array, offset: number, value: Uint8Array): number {
  writeU32(target, offset, value.byteLength);
  target.set(value, offset + 4);
  return offset + 4 + value.byteLength;
}

function readBytes(
  source: Uint8Array,
  offset: number,
  maximum: number,
): { readonly value: Uint8Array; readonly offset: number } {
  const length = readU32(source, offset);
  const start = offset + 4;
  const end = start + length;
  if (length < 1 || length > maximum || end > source.byteLength) throw new RangeError();
  return { value: copyBytes(source.subarray(start, end)), offset: end };
}

function readText(
  source: Uint8Array,
  offset: number,
): { readonly value: string; readonly offset: number } {
  const bytes = readBytes(source, offset, MAX_TEXT_BYTES);
  return { value: TEXT_DECODER.decode(bytes.value), offset: bytes.offset };
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer, target.byteOffset, target.byteLength)
    .setUint32(offset, value, false);
}

function readU32(source: Uint8Array, offset: number): number {
  if (offset + 4 > source.byteLength) throw new RangeError();
  return new DataView(source.buffer, source.byteOffset, source.byteLength)
    .getUint32(offset, false);
}

function writeU64(target: Uint8Array, offset: number, value: bigint): number {
  new DataView(target.buffer, target.byteOffset, target.byteLength)
    .setBigUint64(offset, value, false);
  return offset + 8;
}

function readU64(source: Uint8Array, offset: number): bigint {
  if (offset + 8 > source.byteLength) throw new RangeError();
  return new DataView(source.buffer, source.byteOffset, source.byteLength)
    .getBigUint64(offset, false);
}

function error(
  operation: "encode" | "decode",
  reason: "invalidInput" | "malformed" | "nonCanonical",
  path?: string,
): ApplicationRevisionReadinessReceiptV1Error {
  return new ApplicationRevisionReadinessReceiptV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
  });
}
