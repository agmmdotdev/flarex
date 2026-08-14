import {
  createDeclarativeV2SemanticStreamDecoderV1,
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  makeDeclarativeV2SemanticStreamBudgetV1,
  type DeclarativeV2ArtifactModulePathHandleV1,
  type DeclarativeV2ArtifactModulePathV1Error,
  type DeclarativeV2SemanticRecordV1,
  type DeclarativeV2SemanticRecordV1Error,
} from "@flarex/analysis/internal/system-test/declarative-v2-verifier-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Data, Effect, Result } from "effect";
import {
  decodeDeclarativeV2SemanticArtifactFrameV1,
  type DeclarativeV2SemanticArtifactCodecV1Error,
  type DeclarativeV2SemanticArtifactRootFrameV1,
  type DeclarativeV2SemanticArtifactTreeChildV1,
} from "flarex-protocol/internal/declarative-v2-semantic-artifact-v1";

import {
  type DeclarativeV2ContentReadBudgetError,
  type DeclarativeV2ContentReadBudgetTracker,
} from "../sourceArtifactV2/FinalizedContentReader";
import type {
  SemanticArtifactV1R2AdmittedObject,
  SemanticArtifactV1R2Error,
  SemanticArtifactV1R2Store,
} from "./R2Store";

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const UTF8_ENCODER = new TextEncoder();

export class SemanticArtifactV1FinalizedContentCorruptionError extends Data.TaggedError(
  "SemanticArtifactV1FinalizedContentCorruptionError",
)<{
  readonly reason:
    | "invalidRoot"
    | "invalidTree"
    | "invalidBlock"
    | "rangeMismatch"
    | "countMismatch"
    | "byteLengthMismatch"
    | "recordMismatch"
    | "sourceMismatch"
    | "pathInvalid";
  readonly ordinal?: bigint;
}> {}

export type SemanticArtifactV1FinalizedContentReaderError =
  | DeclarativeV2ContentReadBudgetError
  | SemanticArtifactV1FinalizedContentCorruptionError
  | SemanticArtifactV1R2Error
  | DeclarativeV2SemanticArtifactCodecV1Error
  | DeclarativeV2SemanticRecordV1Error
  | DeclarativeV2ArtifactModulePathV1Error;

export interface SemanticArtifactV1FinalizedModuleRecord {
  readonly path: DeclarativeV2ArtifactModulePathHandleV1;
  readonly pathBytes: Uint8Array;
}

export interface SemanticArtifactV1FinalizedContent {
  readonly root: DeclarativeV2SemanticArtifactRootFrameV1;
  readonly streamBytes: Uint8Array;
  readonly records: readonly DeclarativeV2SemanticRecordV1[];
  readonly modules: readonly SemanticArtifactV1FinalizedModuleRecord[];
}

export interface SemanticArtifactV1FinalizedContentReader {
  readonly read: (
    rootSha256: unknown,
    expectedSourceRootSha256: unknown,
    budget: DeclarativeV2ContentReadBudgetTracker,
  ) => Effect.Effect<
    SemanticArtifactV1FinalizedContent,
    SemanticArtifactV1FinalizedContentReaderError,
    never
  >;
}

interface PendingSemanticReference {
  readonly firstBlockOrdinal: bigint;
  readonly blockCount: bigint;
  readonly firstByteOffset: bigint;
  readonly byteLength: bigint;
  readonly lineFeedCount: bigint;
  readonly sha256: Uint8Array;
}

interface SettledSemanticLeaf {
  readonly reference: PendingSemanticReference;
  readonly object: SemanticArtifactV1R2AdmittedObject;
}

function corruption(
  reason: SemanticArtifactV1FinalizedContentCorruptionError["reason"],
  ordinal?: bigint,
): SemanticArtifactV1FinalizedContentCorruptionError {
  return new SemanticArtifactV1FinalizedContentCorruptionError({
    reason,
    ...(ordinal === undefined ? {} : { ordinal }),
  });
}

function measureUtf8(
  value: string,
): Result.Result<number, SemanticArtifactV1FinalizedContentCorruptionError> {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      byteLength += 1;
    } else if (codeUnit <= 0x7ff) {
      byteLength += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return Result.fail(corruption("pathInvalid"));
      }
      byteLength += 4;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return Result.fail(corruption("pathInvalid"));
    } else {
      byteLength += 3;
    }
    if (!Number.isSafeInteger(byteLength)) {
      return Result.fail(corruption("pathInvalid"));
    }
  }
  return Result.succeed(byteLength);
}

function encodeUtf8(
  value: string,
  byteLength: number,
): Result.Result<Uint8Array, SemanticArtifactV1FinalizedContentCorruptionError> {
  const bytes = new Uint8Array(byteLength);
  const encoded = UTF8_ENCODER.encodeInto(value, bytes);
  if (encoded.read !== value.length || encoded.written !== byteLength) {
    return Result.fail(corruption("pathInvalid"));
  }
  return Result.succeed(bytes);
}

function charge(
  budget: DeclarativeV2ContentReadBudgetTracker,
  dimension: Parameters<DeclarativeV2ContentReadBudgetTracker["charge"]>[0],
  amount: bigint,
): Effect.Effect<void, DeclarativeV2ContentReadBudgetError> {
  return Effect.fromResult(budget.charge(dimension, amount));
}

function admit(
  budget: DeclarativeV2ContentReadBudgetTracker,
  dimension: Parameters<DeclarativeV2ContentReadBudgetTracker["admit"]>[0],
  amount: bigint,
): Effect.Effect<void, DeclarativeV2ContentReadBudgetError> {
  return Effect.fromResult(budget.admit(dimension, amount));
}

function safeNumber(
  value: bigint,
  reason: SemanticArtifactV1FinalizedContentCorruptionError["reason"],
): Effect.Effect<number, SemanticArtifactV1FinalizedContentCorruptionError> {
  return value > MAX_SAFE_BIGINT
    ? Effect.fail(corruption(reason))
    : Effect.succeed(Number(value));
}

export function makeSemanticArtifactV1FinalizedContentReader(options: {
  readonly r2: SemanticArtifactV1R2Store;
}): SemanticArtifactV1FinalizedContentReader {
  const pathFactory = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1;

  const settleSemanticDecoderReceipt = (
    budget: DeclarativeV2ContentReadBudgetTracker,
    result: Readonly<{
      readonly records: ReadonlyArray<DeclarativeV2SemanticRecordV1>;
      readonly mechanical: Readonly<{
        readonly delta: Readonly<{
          readonly inputBytes: number;
          readonly canonicalBytes: number;
          readonly stringBytes: number;
          readonly members: number;
          readonly depth: number;
          readonly transitions: number;
        }>;
      }>;
    }>,
  ): Effect.Effect<void, DeclarativeV2ContentReadBudgetError> =>
    Effect.gen(function* () {
      const delta = result.mechanical.delta;
      yield* charge(budget, "tokenBytes", BigInt(delta.inputBytes));
      yield* charge(budget, "canonicalBytes", BigInt(delta.canonicalBytes));
      yield* charge(budget, "stringBytes", BigInt(delta.stringBytes));
      yield* charge(budget, "schemaNodes", BigInt(delta.members));
      yield* charge(budget, "nestingDepth", BigInt(delta.depth));
      yield* charge(budget, "parserStates", BigInt(delta.transitions));
      yield* charge(budget, "tokens", BigInt(result.records.length));
    });

  const semanticDecoderAllowance = (
    budget: DeclarativeV2ContentReadBudgetTracker,
  ): Effect.Effect<number, DeclarativeV2ContentReadBudgetError> =>
    Effect.gen(function* () {
      const remaining = yield* Effect.fromResult(
        budget.remaining("parserStates"),
      );
      if (remaining < 1) {
        yield* charge(budget, "parserStates", 1n);
      }
      return Math.min(remaining, 1_024);
    });

  const readObject = Effect.fn("SemanticArtifactV1FinalizedContent.readObject")(
    function* (
      kind: "block" | "tree" | "root",
      digest: Uint8Array,
      budget: DeclarativeV2ContentReadBudgetTracker,
    ): Effect.fn.Return<
      SemanticArtifactV1R2AdmittedObject,
      DeclarativeV2ContentReadBudgetError | SemanticArtifactV1R2Error
    > {
      yield* charge(budget, "calls", 1n);
      yield* charge(budget, "objectCalls", 1n);
      const object = yield* options.r2.readImmutableAdmitted(
        kind,
        digest,
        receipt => Effect.gen(function* () {
          const byteLength = BigInt(receipt.byteLength);
          yield* admit(budget, "objectBodyBytes", byteLength);
          yield* admit(budget, "hashBytes", byteLength);
          yield* admit(budget, "frameBytes", byteLength);
          yield* admit(budget, "canonicalBytes", byteLength);
        }),
      );
      const byteLength = BigInt(object.bytes.byteLength);
      yield* charge(budget, "objectBodyBytes", byteLength);
      yield* charge(budget, "hashBytes", byteLength);
      yield* charge(budget, "frameBytes", byteLength);
      yield* charge(budget, "canonicalBytes", byteLength);
      return object;
    },
  );

  const decodeObject = (
    object: SemanticArtifactV1R2AdmittedObject,
  ): Result.Result<
    ReturnType<typeof decodeDeclarativeV2SemanticArtifactFrameV1> extends
      Result.Result<infer A, unknown> ? A : never,
    DeclarativeV2SemanticArtifactCodecV1Error
  > =>
    decodeDeclarativeV2SemanticArtifactFrameV1(object.bytes, {
      maximumFrameBytes: object.bytes.byteLength,
      maximumCanonicalBytes: object.bytes.byteLength,
    });

  const makePath = (
    spelling: string,
    budget: DeclarativeV2ContentReadBudgetTracker,
  ): Effect.Effect<
    SemanticArtifactV1FinalizedModuleRecord,
    DeclarativeV2ContentReadBudgetError | DeclarativeV2ArtifactModulePathV1Error
      | SemanticArtifactV1FinalizedContentCorruptionError
  > =>
    Effect.gen(function* () {
      const byteLength = yield* Effect.fromResult(measureUtf8(spelling));
      const pathCalls = Math.ceil(byteLength / 1_024) + 2;
      yield* charge(budget, "calls", BigInt(pathCalls));
      yield* charge(budget, "stringBytes", BigInt(byteLength));
      yield* charge(budget, "outputBytes", BigInt(byteLength));
      const bytes = yield* Effect.fromResult(encodeUtf8(spelling, byteLength));
      const validator = yield* Effect.fromResult(
        pathFactory.create(pathCalls, bytes.byteLength, bytes.byteLength),
      );
      let offset = 0;
      while (offset < bytes.byteLength) {
        const stepped = yield* Effect.fromResult(
          pathFactory.step(
            validator,
            bytes.subarray(offset, Math.min(bytes.byteLength, offset + 1_024)),
            1_024,
          ),
        );
        if (stepped.consumedBytes <= 0) {
          return yield* Effect.die(
            new Error("Semantic module-path validation made no progress."),
          );
        }
        offset += stepped.consumedBytes;
      }
      const finished = yield* Effect.fromResult(
        pathFactory.finish(validator, 1_024),
      );
      if ("status" in finished) {
        return yield* Effect.die(
          new Error("Semantic module-path validation did not settle."),
        );
      }
      return Object.freeze({
        path: finished,
        pathBytes: new Uint8Array(bytes),
      });
    });

  const readBlocks = (
    root: DeclarativeV2SemanticArtifactRootFrameV1,
    budget: DeclarativeV2ContentReadBudgetTracker,
  ): Effect.Effect<
    readonly SettledSemanticLeaf[],
    SemanticArtifactV1FinalizedContentReaderError
  > =>
    Effect.gen(function* () {
      if (root.blockCount === 0n) return Object.freeze([]);
      const blockCount = yield* safeNumber(root.blockCount, "countMismatch");
      const maximumNodes = root.blockCount * 2n - 1n;
      yield* charge(budget, "graphNodes", maximumNodes);
      yield* charge(budget, "frontierEntries", maximumNodes);
      const pending: PendingSemanticReference[] = [{
        firstBlockOrdinal: 0n,
        blockCount: root.blockCount,
        firstByteOffset: 0n,
        byteLength: root.streamByteLength,
        lineFeedCount: root.recordCount,
        sha256: copyBytes(root.treeRootSha256),
      }];
      const blocks: SettledSemanticLeaf[] = [];
      while (pending.length > 0) {
        const current = pending.pop()!;
        if (current.blockCount === 1n) {
          blocks.push(Object.freeze({
            reference: current,
            object: yield* readObject("block", current.sha256, budget),
          }));
          continue;
        }
        const object = yield* readObject("tree", current.sha256, budget);
        const decoded = decodeObject(object);
        if (
          Result.isFailure(decoded) ||
          decoded.success.value.kind !== "semantic_tree"
        ) {
          return yield* Effect.fail(corruption("invalidTree"));
        }
        const [left, right] = decoded.success.value.children;
        if (
          left.firstBlockOrdinal !== current.firstBlockOrdinal ||
          left.blockCount + right.blockCount !== current.blockCount ||
          left.byteLength + right.byteLength !== current.byteLength ||
          left.lineFeedCount + right.lineFeedCount !== current.lineFeedCount ||
          left.firstByteOffset !== current.firstByteOffset ||
          right.firstBlockOrdinal !==
            current.firstBlockOrdinal + left.blockCount ||
          right.firstByteOffset !== current.firstByteOffset + left.byteLength
        ) {
          return yield* Effect.fail(corruption("rangeMismatch"));
        }
        pending.push(right, left);
      }
      if (blocks.length !== blockCount) {
        return yield* Effect.fail(corruption("countMismatch"));
      }
      return Object.freeze(blocks);
    });

  const read = Effect.fn("SemanticArtifactV1FinalizedContent.read")(
    function* (
      rootSha256: unknown,
      expectedSourceRootSha256: unknown,
      budget: DeclarativeV2ContentReadBudgetTracker,
    ): Effect.fn.Return<
      SemanticArtifactV1FinalizedContent,
      SemanticArtifactV1FinalizedContentReaderError
    > {
      if (
        !isUint8ArrayWithByteLength(rootSha256, 32) ||
        !isUint8ArrayWithByteLength(expectedSourceRootSha256, 32)
      ) {
        return yield* Effect.fail(corruption("invalidRoot"));
      }
      const rootObject = yield* readObject(
        "root",
        new Uint8Array(rootSha256),
        budget,
      );
      const decodedRoot = decodeObject(rootObject);
      if (
        Result.isFailure(decodedRoot) ||
        decodedRoot.success.value.kind !== "semantic_root"
      ) {
        return yield* Effect.fail(corruption("invalidRoot"));
      }
      const root = decodedRoot.success.value;
      if (!bytesEqualFullScan(root.sourceRootSha256, expectedSourceRootSha256)) {
        return yield* Effect.fail(corruption("sourceMismatch"));
      }
      yield* charge(budget, "semanticBytes", root.streamByteLength);
      const streamLength = yield* safeNumber(
        root.streamByteLength,
        "byteLengthMismatch",
      );
      const recordCount = yield* safeNumber(root.recordCount, "recordMismatch");
      if (root.recordCount > root.streamByteLength) {
        return yield* Effect.fail(corruption("byteLengthMismatch"));
      }
      yield* admit(budget, "tokenBytes", root.streamByteLength);
      yield* admit(
        budget,
        "canonicalBytes",
        root.streamByteLength - root.recordCount,
      );
      // The remaining semantic decoder dimensions are conservatively bounded
      // by authenticated root metadata before any block body is consumed.
      yield* admit(budget, "stringBytes", root.streamByteLength);
      yield* admit(budget, "schemaNodes", root.streamByteLength);
      yield* admit(budget, "nestingDepth", root.streamByteLength);
      yield* admit(budget, "tokens", root.recordCount);
      const blocks = yield* readBlocks(root, budget);
      yield* charge(budget, "outputBytes", BigInt(streamLength));
      const streamBytes = new Uint8Array(streamLength);
      let offset = 0;
      let lineFeeds = 0n;
      for (let index = 0; index < blocks.length; index += 1) {
        const leaf = blocks[index]!;
        const decoded = decodeObject(leaf.object);
        if (
          Result.isFailure(decoded) ||
          decoded.success.value.kind !== "semantic_block"
        ) {
          return yield* Effect.fail(corruption("invalidBlock", BigInt(index)));
        }
        const block = decoded.success.value;
        const reference = leaf.reference;
        if (
          block.blockOrdinal !== BigInt(index) ||
          block.blockOrdinal !== reference.firstBlockOrdinal ||
          block.firstByteOffset !== BigInt(offset) ||
          block.firstByteOffset !== reference.firstByteOffset ||
          BigInt(block.bodyBytes.byteLength) !== reference.byteLength ||
          block.lineFeedCount !== reference.lineFeedCount ||
          offset + block.bodyBytes.byteLength > streamBytes.byteLength
        ) {
          return yield* Effect.fail(corruption("rangeMismatch", BigInt(index)));
        }
        streamBytes.set(block.bodyBytes, offset);
        offset += block.bodyBytes.byteLength;
        lineFeeds += block.lineFeedCount;
      }
      if (
        offset !== streamBytes.byteLength ||
        lineFeeds !== root.recordCount
      ) {
        return yield* Effect.fail(corruption("byteLengthMismatch"));
      }

      const streamBudget = yield* Effect.fromResult(
        makeDeclarativeV2SemanticStreamBudgetV1(
          streamBytes.byteLength,
          streamBytes.byteLength,
          recordCount,
          streamBytes.byteLength,
        ),
      );
      const decoder = yield* Effect.fromResult(
        createDeclarativeV2SemanticStreamDecoderV1(streamBudget),
      );
      const records: DeclarativeV2SemanticRecordV1[] = [];
      let inputOffset = 0;
      while (inputOffset < streamBytes.byteLength) {
        const remainingInputBytes = yield* Effect.fromResult(
          budget.remaining("tokenBytes"),
        );
        if (remainingInputBytes < 1) {
          yield* charge(budget, "tokenBytes", 1n);
        }
        const allowance = yield* semanticDecoderAllowance(budget);
        yield* charge(budget, "calls", 1n);
        const pushed = yield* Effect.fromResult(
          decoder.push(
            streamBytes.subarray(
              inputOffset,
              inputOffset + remainingInputBytes,
            ),
            allowance,
          ),
        );
        yield* settleSemanticDecoderReceipt(budget, pushed);
        if (pushed.consumedInputBytes <= 0) {
          return yield* Effect.die(
            new Error("Semantic stream decoding made no progress."),
          );
        }
        records.push(...pushed.records);
        inputOffset += pushed.consumedInputBytes;
      }
      for (;;) {
        const allowance = yield* semanticDecoderAllowance(budget);
        yield* charge(budget, "calls", 1n);
        const finished = yield* Effect.fromResult(decoder.finish(allowance));
        yield* settleSemanticDecoderReceipt(budget, finished);
        records.push(...finished.records);
        if (finished.status === "complete") break;
      }
      if (records.length !== recordCount) {
        return yield* Effect.fail(corruption("recordMismatch"));
      }
      const modules: SemanticArtifactV1FinalizedModuleRecord[] = [];
      for (const record of records) {
        if (record.kind !== "module") continue;
        modules.push(yield* makePath(record.modulePath, budget).pipe(
          Effect.catchTag(
            "DeclarativeV2ArtifactModulePathV1Error",
            () => Effect.fail(corruption("pathInvalid")),
          ),
        ));
      }
      return Object.freeze({
        root,
        streamBytes,
        records: Object.freeze(records),
        modules: Object.freeze(modules),
      });
    },
  );

  return Object.freeze({ read });
}
