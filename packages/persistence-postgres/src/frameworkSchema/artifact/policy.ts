import { compareBytesLexicographically, copyBytes } from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import {
  compareUtf16Strings,
  isNonBlankString,
} from "@flarex/utils/strings";
import { Brand, Encoding, Result } from "effect";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";

import {
  FrameworkSchemaArtifactError,
  FrameworkSchemaArtifactInvariantDefect,
} from "./errors";
import {
  FRAMEWORK_SCHEMA_ARTIFACT_FORMAT,
  FRAMEWORK_SCHEMA_ARTIFACT_VERSION,
  type FrameworkSchemaArtifact,
  type FrameworkSchemaArtifactCaptureInput,
  type FrameworkSchemaArtifactCodec,
  type FrameworkSchemaArtifactCodecFormat,
  type FrameworkSchemaArtifactCodecVersion,
  type FrameworkSchemaArtifactCoordinate,
  type FrameworkSchemaArtifactFrame,
  type FrameworkSchemaArtifactIdentity,
  type FrameworkSchemaArtifactOwner,
  type FrameworkSchemaArtifactReplayClassification,
  type FrameworkSchemaArtifactSha256,
  type FrameworkSchemaCapabilityId,
  type FrameworkSchemaLineageId,
  type ListFrameworkSchemaArtifactIdentitiesInput,
} from "./model";

export const MAX_FRAMEWORK_SCHEMA_ARTIFACT_COMMON_IDENTITY_UTF8_BYTES = 1_024;
export const MAX_FRAMEWORK_SCHEMA_ARTIFACT_CAPABILITIES = 256;
export const MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES = 256;
export const MAX_FRAMEWORK_SCHEMA_ARTIFACT_LIST_LIMIT = 100;
export const MAX_FRAMEWORK_SCHEMA_ARTIFACT_JSON_CONTAINER_LEVELS = 128;
export const MAX_FRAMEWORK_SCHEMA_ARTIFACT_JSON_NODES = 262_144;
export const MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES = 1_048_576;

const CAPTURE_INPUT_KEYS = [
  "deploymentId",
  "owner",
  "lineageId",
  "payloadCodec",
  "provenance",
  "capabilities",
  "dependencies",
  "payload",
] as const satisfies ReadonlyArray<keyof FrameworkSchemaArtifactCaptureInput>;
const CODEC_KEYS = ["format", "version"] as const;
const DEPENDENCY_KEYS = [
  "deploymentId",
  "owner",
  "lineageId",
  "artifactSha256",
] as const;
const IDENTITY_KEYS = [
  "deploymentId",
  "owner",
  "lineageId",
  "artifactSha256",
] as const satisfies ReadonlyArray<keyof FrameworkSchemaArtifactIdentity>;
const LIST_INPUT_KEYS = [
  "deploymentId",
  "owner",
  "lineageId",
  "afterArtifactSha256",
  "limit",
] as const satisfies ReadonlyArray<
  keyof ListFrameworkSchemaArtifactIdentitiesInput
>;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const UTF8 = new TextEncoder();
const OWNER_ORDINAL = {
  payload: 0,
  medusa: 1,
  system: 2,
} as const satisfies Record<FrameworkSchemaArtifactOwner, number>;

const brandLineageId = Brand.nominal<FrameworkSchemaLineageId>();
const brandCapabilityId = Brand.nominal<FrameworkSchemaCapabilityId>();
const brandCodecFormat = Brand.nominal<FrameworkSchemaArtifactCodecFormat>();
const brandCodecVersion =
  Brand.nominal<FrameworkSchemaArtifactCodecVersion>();
const brandArtifactSha256 = Brand.nominal<FrameworkSchemaArtifactSha256>();

interface JsonCaptureBudget {
  nodes: number;
}

export interface DecodedFrameworkSchemaArtifactIdentity {
  readonly identity: FrameworkSchemaArtifactIdentity;
  readonly artifactSha256Bytes: Uint8Array;
}

export interface FrameworkSchemaArtifactIdentityIssue {
  readonly _tag: "FrameworkSchemaArtifactIdentityIssue";
}

export interface DecodedFrameworkSchemaArtifactListInput {
  readonly coordinate: FrameworkSchemaArtifactCoordinate;
  readonly afterArtifactSha256: FrameworkSchemaArtifactSha256 | null;
  readonly afterArtifactSha256Bytes: Uint8Array | null;
  readonly limit: number;
}

export interface FrameworkSchemaArtifactListInputIssue {
  readonly _tag: "FrameworkSchemaArtifactListInputIssue";
}

const frameworkSchemaArtifactIdentityIssue = Object.freeze({
  _tag: "FrameworkSchemaArtifactIdentityIssue" as const,
});
const frameworkSchemaArtifactListInputIssue = Object.freeze({
  _tag: "FrameworkSchemaArtifactListInputIssue" as const,
});

interface JsonRootHolder {
  value?: Json;
}

type JsonAssignment =
  | Readonly<{ readonly kind: "root"; readonly target: JsonRootHolder }>
  | Readonly<{
      readonly kind: "array";
      readonly target: Json[];
      readonly index: number;
    }>
  | Readonly<{
      readonly kind: "object";
      readonly target: { [key: string]: Json };
      readonly key: string;
    }>;

type JsonCaptureFrame =
  | Readonly<{
      readonly kind: "visit";
      readonly input: unknown;
      readonly containerLevel: number;
      readonly requireObjectRoot: boolean;
      readonly assignment: JsonAssignment;
    }>
  | Readonly<{
      readonly kind: "finish";
      readonly source: object;
      readonly output: Json[] | { [key: string]: Json };
    }>;

type JsonContainerSnapshot =
  | Readonly<{
      readonly kind: "array";
      readonly values: ReadonlyArray<unknown>;
    }>
  | Readonly<{
      readonly kind: "object";
      readonly entries: ReadonlyArray<Readonly<{
        readonly key: string;
        readonly value: unknown;
      }>>;
    }>;

export function normalizeFrameworkSchemaArtifact(
  input: unknown,
): Result.Result<FrameworkSchemaArtifactFrame, FrameworkSchemaArtifactError> {
  return Result.gen(function* () {
    const fields = yield* captureExactRecordValues(input, CAPTURE_INPUT_KEYS);
    const deploymentId = yield* decodeCommonIdentityString(fields.at(0));
    const owner = yield* decodeArtifactOwner(fields.at(1), true);
    const lineageId = yield* decodeCommonIdentityString(fields.at(2)).pipe(
      Result.map(brandLineageId),
    );
    const payloadCodec = yield* decodePayloadCodec(fields.at(3));
    const capabilities = yield* decodeCapabilities(fields.at(5));
    const dependencies = yield* decodeDependencies(fields.at(6), {
      deploymentId,
      owner,
      lineageId,
    });
    const jsonBudget: JsonCaptureBudget = { nodes: 0 };
    const provenance = yield* captureJsonObjectRoot(fields.at(4), jsonBudget);
    const payload = yield* captureJsonObjectRoot(fields.at(7), jsonBudget);

    return Object.freeze({
      format: FRAMEWORK_SCHEMA_ARTIFACT_FORMAT,
      version: FRAMEWORK_SCHEMA_ARTIFACT_VERSION,
      deploymentId,
      owner,
      lineageId,
      payloadCodec,
      provenance,
      capabilities,
      dependencies,
      payload,
    } satisfies FrameworkSchemaArtifactFrame);
  });
}

/** Strictly snapshot one complete natural identity and its owned digest. */
export function decodeFrameworkSchemaArtifactIdentityResult(
  input: unknown,
): Result.Result<
  DecodedFrameworkSchemaArtifactIdentity,
  FrameworkSchemaArtifactIdentityIssue
> {
  return Result.gen(function* () {
    const fields = yield* captureExactRecordValues(input, IDENTITY_KEYS);
    const deploymentId = yield* decodeCommonIdentityString(fields.at(0));
    const owner = yield* decodeArtifactOwner(fields.at(1), false);
    const lineageId = yield* decodeCommonIdentityString(fields.at(2)).pipe(
      Result.map(brandLineageId),
    );
    const artifactSha256 = yield* decodeArtifactSha256(fields.at(3));
    const artifactSha256Bytes = yield* Encoding.decodeHex(
      artifactSha256,
    ).pipe(Result.mapError(() => FrameworkSchemaArtifactError.invalidInput()));
    const stableArtifactSha256Bytes = copyBytes(artifactSha256Bytes);
    return Object.freeze({
      identity: Object.freeze({
        deploymentId,
        owner,
        lineageId,
        artifactSha256,
      }),
      get artifactSha256Bytes(): Uint8Array {
        return copyBytes(stableArtifactSha256Bytes);
      },
    });
  }).pipe(Result.mapError(() => frameworkSchemaArtifactIdentityIssue));
}

/** Strictly snapshot one bounded identity-list request and cursor. */
export function decodeFrameworkSchemaArtifactListInputResult(
  input: unknown,
): Result.Result<
  DecodedFrameworkSchemaArtifactListInput,
  FrameworkSchemaArtifactListInputIssue
> {
  return Result.gen(function* () {
    const fields = yield* captureExactRecordValues(input, LIST_INPUT_KEYS);
    const deploymentId = yield* decodeCommonIdentityString(fields.at(0));
    const owner = yield* decodeArtifactOwner(fields.at(1), false);
    const lineageId = yield* decodeCommonIdentityString(fields.at(2)).pipe(
      Result.map(brandLineageId),
    );
    const cursorInput = fields.at(3);
    const afterArtifactSha256 = cursorInput === null
      ? null
      : yield* decodeArtifactSha256(cursorInput);
    const decodedCursorBytes = afterArtifactSha256 === null
      ? null
      : yield* Encoding.decodeHex(afterArtifactSha256).pipe(
        Result.mapError(() => FrameworkSchemaArtifactError.invalidInput()),
      );
    const stableCursorBytes = decodedCursorBytes === null
      ? null
      : copyBytes(decodedCursorBytes);
    const limit = fields.at(4);
    if (
      !isPositiveSafeInteger(limit) ||
      limit > MAX_FRAMEWORK_SCHEMA_ARTIFACT_LIST_LIMIT
    ) {
      return yield* Result.fail(FrameworkSchemaArtifactError.invalidInput());
    }
    return Object.freeze({
      coordinate: Object.freeze({ deploymentId, owner, lineageId }),
      afterArtifactSha256,
      get afterArtifactSha256Bytes(): Uint8Array | null {
        return stableCursorBytes === null ? null : copyBytes(stableCursorBytes);
      },
      limit,
    });
  }).pipe(Result.mapError(() => frameworkSchemaArtifactListInputIssue));
}

export function compareFrameworkSchemaArtifactIdentities(
  left: FrameworkSchemaArtifactIdentity,
  right: FrameworkSchemaArtifactIdentity,
): number {
  const deployment = compareUtf8(left.deploymentId, right.deploymentId);
  if (deployment !== 0) return deployment;
  const owner = OWNER_ORDINAL[left.owner] - OWNER_ORDINAL[right.owner];
  if (owner !== 0) return owner;
  const lineage = compareUtf8(left.lineageId, right.lineageId);
  if (lineage !== 0) return lineage;
  return compareAscii(left.artifactSha256, right.artifactSha256);
}

export function classifyFrameworkSchemaArtifactReplay(
  existing: FrameworkSchemaArtifact,
  incoming: FrameworkSchemaArtifact,
): Result.Result<
  FrameworkSchemaArtifactReplayClassification,
  FrameworkSchemaArtifactError
> {
  if (
    compareFrameworkSchemaArtifactIdentities(
      existing.identity,
      incoming.identity,
    ) !== 0
  ) {
    return Result.succeed("differentIdentity");
  }
  return existing.canonicalJson === incoming.canonicalJson
    ? Result.succeed("exact")
    : Result.fail(FrameworkSchemaArtifactError.digestCollision());
}

function decodePayloadCodec(
  input: unknown,
): Result.Result<FrameworkSchemaArtifactCodec, FrameworkSchemaArtifactError> {
  return Result.gen(function* () {
    const fields = yield* captureExactRecordValues(input, CODEC_KEYS);
    const format = yield* decodeCommonIdentityString(fields.at(0)).pipe(
      Result.map(brandCodecFormat),
    );
    const versionInput = fields.at(1);
    if (!isPositiveSafeInteger(versionInput)) {
      return yield* Result.fail(FrameworkSchemaArtifactError.invalidInput());
    }
    return Object.freeze({
      format,
      version: brandCodecVersion(versionInput),
    });
  });
}

function decodeCapabilities(
  input: unknown,
): Result.Result<
  readonly FrameworkSchemaCapabilityId[],
  FrameworkSchemaArtifactError
> {
  return Result.gen(function* () {
    const values = yield* captureExactArrayValues(
      input,
      MAX_FRAMEWORK_SCHEMA_ARTIFACT_CAPABILITIES,
    );
    const capabilities: FrameworkSchemaCapabilityId[] = [];
    for (const value of values) {
      capabilities.push(yield* decodeCommonIdentityString(value).pipe(
        Result.map(brandCapabilityId),
      ));
    }
    capabilities.sort(compareUtf8);
    for (let index = 1; index < capabilities.length; index += 1) {
      if (capabilities[index - 1] === capabilities[index]) {
        return yield* Result.fail(
          FrameworkSchemaArtifactError.invalidInput(),
        );
      }
    }
    return Object.freeze(capabilities);
  });
}

function decodeDependencies(
  input: unknown,
  containing: Readonly<{
    readonly deploymentId: string;
    readonly owner: FrameworkSchemaArtifactOwner;
    readonly lineageId: FrameworkSchemaLineageId;
  }>,
): Result.Result<
  readonly FrameworkSchemaArtifactIdentity[],
  FrameworkSchemaArtifactError
> {
  return Result.gen(function* () {
    const values = yield* captureExactArrayValues(
      input,
      MAX_FRAMEWORK_SCHEMA_ARTIFACT_DEPENDENCIES,
    );
    const dependencies: FrameworkSchemaArtifactIdentity[] = [];
    for (const value of values) {
      const fields = yield* captureExactRecordValues(value, DEPENDENCY_KEYS);
      const deploymentId = yield* decodeCommonIdentityString(fields.at(0));
      const owner = yield* decodeArtifactOwner(fields.at(1), false);
      const lineageId = yield* decodeCommonIdentityString(fields.at(2)).pipe(
        Result.map(brandLineageId),
      );
      const artifactSha256 = yield* decodeArtifactSha256(fields.at(3));
      if (
        deploymentId !== containing.deploymentId ||
        owner !== containing.owner ||
        lineageId === containing.lineageId
      ) {
        return yield* Result.fail(
          FrameworkSchemaArtifactError.invalidInput(),
        );
      }
      dependencies.push(Object.freeze({
        deploymentId,
        owner,
        lineageId,
        artifactSha256,
      }));
    }
    dependencies.sort(compareFrameworkSchemaArtifactIdentities);
    for (let index = 1; index < dependencies.length; index += 1) {
      const previous = dependencies[index - 1];
      const current = dependencies[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        compareFrameworkSchemaArtifactIdentities(previous, current) === 0
      ) {
        return yield* Result.fail(
          FrameworkSchemaArtifactError.invalidInput(),
        );
      }
    }
    return Object.freeze(dependencies);
  });
}

function decodeArtifactOwner(
  input: unknown,
  isContainingOwner: boolean,
): Result.Result<FrameworkSchemaArtifactOwner, FrameworkSchemaArtifactError> {
  switch (input) {
    case "payload":
    case "medusa":
    case "system":
      return Result.succeed(input);
    case "application":
      return Result.fail(isContainingOwner
        ? FrameworkSchemaArtifactError.ownerNotAdmitted()
        : FrameworkSchemaArtifactError.invalidInput());
    default:
      return Result.fail(FrameworkSchemaArtifactError.invalidInput());
  }
}

function decodeCommonIdentityString(
  input: unknown,
): Result.Result<string, FrameworkSchemaArtifactError> {
  return isFrameworkSchemaArtifactCommonIdentityString(input)
    ? Result.succeed(input)
    : Result.fail(FrameworkSchemaArtifactError.invalidInput());
}

/** Classifies the exact common identity text admitted by artifact capture. */
export function isFrameworkSchemaArtifactCommonIdentityString(
  input: unknown,
): input is string {
  if (
    !isNonBlankString(input) ||
    input.includes("\0") ||
    !isWellFormedUnicode(input)
  ) {
    return false;
  }
  const byteLength = UTF8.encode(input).byteLength;
  return byteLength >= 1 &&
    byteLength <= MAX_FRAMEWORK_SCHEMA_ARTIFACT_COMMON_IDENTITY_UTF8_BYTES;
}

function decodeArtifactSha256(
  input: unknown,
): Result.Result<FrameworkSchemaArtifactSha256, FrameworkSchemaArtifactError> {
  return typeof input === "string" && LOWERCASE_SHA256.test(input)
    ? Result.succeed(brandArtifactSha256(input))
    : Result.fail(FrameworkSchemaArtifactError.invalidInput());
}

function captureExactRecordValues(
  input: unknown,
  expectedKeys: ReadonlyArray<string>,
): Result.Result<ReadonlyArray<unknown>, FrameworkSchemaArtifactError> {
  if (input === null || typeof input !== "object") {
    return Result.fail(FrameworkSchemaArtifactError.invalidInput());
  }
  let isArray: boolean;
  let prototype: object | null;
  let ownKeys: ReadonlyArray<PropertyKey>;
  try {
    isArray = Array.isArray(input);
    prototype = Object.getPrototypeOf(input);
    ownKeys = Reflect.ownKeys(input);
  } catch {
    return Result.fail(FrameworkSchemaArtifactError.invalidInput());
  }
  if (
    isArray ||
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some(key =>
      typeof key !== "string" || !expectedKeys.includes(key)
    )
  ) {
    return Result.fail(FrameworkSchemaArtifactError.invalidInput());
  }
  const values: unknown[] = [];
  for (const key of expectedKeys) {
    const descriptor = readOwnPropertyDescriptor(input, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      return Result.fail(FrameworkSchemaArtifactError.invalidInput());
    }
    values.push(descriptor.value);
  }
  return Result.succeed(Object.freeze(values));
}

function captureExactArrayValues(
  input: unknown,
  maximumLength: number,
): Result.Result<ReadonlyArray<unknown>, FrameworkSchemaArtifactError> {
  let isArray: boolean;
  try {
    isArray = Array.isArray(input);
  } catch {
    return Result.fail(FrameworkSchemaArtifactError.invalidInput());
  }
  if (!isArray || input === null || typeof input !== "object") {
    return Result.fail(FrameworkSchemaArtifactError.invalidInput());
  }
  const lengthDescriptor = readOwnPropertyDescriptor(input, "length");
  if (
    lengthDescriptor === undefined ||
    lengthDescriptor.enumerable ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maximumLength
  ) {
    return Result.fail(FrameworkSchemaArtifactError.invalidInput());
  }
  const length: number = lengthDescriptor.value;
  const ownKeys = readOwnKeys(input);
  if (
    ownKeys === undefined ||
    !hasExactDenseArrayOwnKeys(ownKeys, length)
  ) {
    return Result.fail(FrameworkSchemaArtifactError.invalidInput());
  }
  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = readOwnPropertyDescriptor(input, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      return Result.fail(FrameworkSchemaArtifactError.invalidInput());
    }
    values.push(descriptor.value);
  }
  return Result.succeed(Object.freeze(values));
}

function captureJsonObjectRoot(
  input: unknown,
  budget: JsonCaptureBudget,
): Result.Result<JsonObject, FrameworkSchemaArtifactError> {
  return Result.gen(function* () {
    const holder: JsonRootHolder = {};
    const ancestors = new WeakSet<object>();
    const frames: JsonCaptureFrame[] = [{
      kind: "visit",
      input,
      containerLevel: 1,
      requireObjectRoot: true,
      assignment: { kind: "root", target: holder },
    }];

    while (frames.length > 0) {
      const frame = frames.pop();
      if (frame === undefined) {
        throw new FrameworkSchemaArtifactInvariantDefect({
          reason: "ownedSnapshotInvalid",
        });
      }
      if (frame.kind === "finish") {
        ancestors.delete(frame.source);
        Object.freeze(frame.output);
        continue;
      }
      if (budget.nodes >= MAX_FRAMEWORK_SCHEMA_ARTIFACT_JSON_NODES) {
        return yield* Result.fail(
          FrameworkSchemaArtifactError.invalidInput(),
        );
      }
      budget.nodes += 1;
      const current = frame.input;
      if (
        current === null ||
        typeof current === "string" ||
        typeof current === "boolean"
      ) {
        if (frame.requireObjectRoot) {
          return yield* Result.fail(
            FrameworkSchemaArtifactError.invalidInput(),
          );
        }
        assignJsonValue(frame.assignment, current);
        continue;
      }
      if (typeof current === "number") {
        if (frame.requireObjectRoot || !Number.isFinite(current)) {
          return yield* Result.fail(
            FrameworkSchemaArtifactError.invalidInput(),
          );
        }
        assignJsonValue(frame.assignment, current);
        continue;
      }
      if (typeof current !== "object") {
        return yield* Result.fail(
          FrameworkSchemaArtifactError.invalidInput(),
        );
      }
      if (
        frame.containerLevel >
          MAX_FRAMEWORK_SCHEMA_ARTIFACT_JSON_CONTAINER_LEVELS ||
        ancestors.has(current)
      ) {
        return yield* Result.fail(
          FrameworkSchemaArtifactError.invalidInput(),
        );
      }
      const snapshot = yield* inspectJsonContainer(
        current,
        MAX_FRAMEWORK_SCHEMA_ARTIFACT_JSON_NODES - budget.nodes,
      );
      if (frame.requireObjectRoot && snapshot.kind !== "object") {
        return yield* Result.fail(
          FrameworkSchemaArtifactError.invalidInput(),
        );
      }
      ancestors.add(current);
      if (snapshot.kind === "array") {
        const output: Json[] = [];
        assignJsonValue(frame.assignment, output);
        frames.push({ kind: "finish", source: current, output });
        for (let index = snapshot.values.length - 1; index >= 0; index -= 1) {
          frames.push({
            kind: "visit",
            input: snapshot.values[index],
            containerLevel: frame.containerLevel + 1,
            requireObjectRoot: false,
            assignment: { kind: "array", target: output, index },
          });
        }
        continue;
      }
      const output: { [key: string]: Json } = Object.create(null);
      assignJsonValue(frame.assignment, output);
      frames.push({ kind: "finish", source: current, output });
      for (let index = snapshot.entries.length - 1; index >= 0; index -= 1) {
        const entry = snapshot.entries[index];
        if (entry === undefined) {
          throw new FrameworkSchemaArtifactInvariantDefect({
            reason: "ownedSnapshotInvalid",
          });
        }
        frames.push({
          kind: "visit",
          input: entry.value,
          containerLevel: frame.containerLevel + 1,
          requireObjectRoot: false,
          assignment: { kind: "object", target: output, key: entry.key },
        });
      }
    }

    const captured = holder.value;
    if (captured === undefined || !isJsonObject(captured)) {
      throw new FrameworkSchemaArtifactInvariantDefect({
        reason: "ownedSnapshotInvalid",
      });
    }
    return captured;
  });
}

function inspectJsonContainer(
  input: unknown,
  remainingNodes: number,
): Result.Result<JsonContainerSnapshot, FrameworkSchemaArtifactError> {
  if (input === null || typeof input !== "object") {
    return Result.fail(FrameworkSchemaArtifactError.invalidInput());
  }
  let isArray: boolean;
  try {
    isArray = Array.isArray(input);
  } catch {
    return Result.fail(FrameworkSchemaArtifactError.invalidInput());
  }
  if (isArray) {
    const lengthDescriptor = readOwnPropertyDescriptor(input, "length");
    if (
      lengthDescriptor === undefined ||
      lengthDescriptor.enumerable ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > remainingNodes
    ) {
      return Result.fail(FrameworkSchemaArtifactError.invalidInput());
    }
    const length: number = lengthDescriptor.value;
    const ownKeys = readOwnKeys(input);
    if (
      ownKeys === undefined ||
      !hasExactDenseArrayOwnKeys(ownKeys, length)
    ) {
      return Result.fail(FrameworkSchemaArtifactError.invalidInput());
    }
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = readOwnPropertyDescriptor(input, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return Result.fail(FrameworkSchemaArtifactError.invalidInput());
      }
      values.push(descriptor.value);
    }
    return Result.succeed({ kind: "array", values: Object.freeze(values) });
  }

  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(input);
  } catch {
    return Result.fail(FrameworkSchemaArtifactError.invalidInput());
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return Result.fail(FrameworkSchemaArtifactError.invalidInput());
  }
  const ownKeys = readOwnKeys(input);
  if (
    ownKeys === undefined ||
    ownKeys.length > remainingNodes ||
    ownKeys.some(key => typeof key !== "string")
  ) {
    return Result.fail(FrameworkSchemaArtifactError.invalidInput());
  }
  const keys: string[] = [];
  for (const key of ownKeys) {
    if (typeof key !== "string") {
      return Result.fail(FrameworkSchemaArtifactError.invalidInput());
    }
    keys.push(key);
  }
  keys.sort(compareUtf16Strings);
  const entries: Array<Readonly<{ key: string; value: unknown }>> = [];
  for (const key of keys) {
    const descriptor = readOwnPropertyDescriptor(input, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      return Result.fail(FrameworkSchemaArtifactError.invalidInput());
    }
    entries.push(Object.freeze({ key, value: descriptor.value }));
  }
  return Result.succeed({ kind: "object", entries: Object.freeze(entries) });
}

function assignJsonValue(assignment: JsonAssignment, value: Json): void {
  switch (assignment.kind) {
    case "root":
      assignment.target.value = value;
      return;
    case "array":
      Object.defineProperty(assignment.target, String(assignment.index), {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      return;
    case "object":
      Object.defineProperty(assignment.target, assignment.key, {
        value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
      return;
  }
}

function readOwnKeys(input: unknown): ReadonlyArray<PropertyKey> | undefined {
  if (input === null || typeof input !== "object") return undefined;
  try {
    return Reflect.ownKeys(input);
  } catch {
    return undefined;
  }
}

function hasExactDenseArrayOwnKeys(
  ownKeys: ReadonlyArray<PropertyKey>,
  length: number,
): boolean {
  if (ownKeys.length !== length + 1) return false;
  const keySet = new Set(ownKeys);
  if (keySet.size !== ownKeys.length || !keySet.has("length")) return false;
  for (let index = 0; index < length; index += 1) {
    if (!keySet.has(String(index))) return false;
  }
  return true;
}

function readOwnPropertyDescriptor(
  input: unknown,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  if (input === null || typeof input !== "object") return undefined;
  try {
    return Object.getOwnPropertyDescriptor(input, key);
  } catch {
    return undefined;
  }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function compareUtf8(left: string, right: string): number {
  return compareBytesLexicographically(UTF8.encode(left), UTF8.encode(right));
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
