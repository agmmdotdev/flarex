import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  type DeclarativeV2ArtifactModulePathHandleV1,
  type DeclarativeV2ArtifactModulePathV1Error,
} from "@flarex/analysis/internal/declarative-v2-verifier-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import {
  decodeSourceArtifactV2BlockFrame,
  decodeSourceArtifactV2CompletedRootFrame,
  decodeSourceArtifactV2ModuleFrame,
  decodeSourceArtifactV2TreeNodeFrame,
  type SourceArtifactV2CompletedRootFrameInput,
  type SourceArtifactV2DecodedModuleFrame,
  type SourceArtifactV2FrameDecodeError,
  type SourceArtifactV2TreeKind,
  type SourceArtifactV2TreeReference,
} from "./Framing";
import type {
  SourceArtifactV2ObjectKind,
  SourceArtifactV2R2Error,
  SourceArtifactV2R2Object,
  SourceArtifactV2R2Store,
} from "./R2Store";

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const UTF8_ENCODER = new TextEncoder();

export class DeclarativeV2ContentReadBudgetError extends Data.TaggedError(
  "DeclarativeV2ContentReadBudgetError",
)<{
  readonly operation: "createBudget" | "charge" | "read";
  readonly reason: "invalidInput" | "budgetExceeded" | "overflow";
  readonly dimension?: DeclarativeV2VerifierBudgetDimensionV2;
  readonly observed?: bigint;
  readonly maximum?: bigint;
}> {}

export class SourceArtifactV2FinalizedContentCorruptionError extends Data.TaggedError(
  "SourceArtifactV2FinalizedContentCorruptionError",
)<{
  readonly reason:
    | "invalidRoot"
    | "invalidTree"
    | "invalidModule"
    | "invalidBlock"
    | "rangeMismatch"
    | "countMismatch"
    | "byteLengthMismatch"
    | "sourceMapUnsupported"
    | "pathInvalid";
  readonly ordinal?: bigint;
}> {}

export type SourceArtifactV2FinalizedContentReaderError =
  | DeclarativeV2ContentReadBudgetError
  | SourceArtifactV2FinalizedContentCorruptionError
  | SourceArtifactV2R2Error
  | DeclarativeV2ArtifactModulePathV1Error;

export interface DeclarativeV2ContentReadBudgetInput {
  readonly ceilings: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
  readonly command: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2ContentReadBudgetReceipt {
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
  readonly commandUsage: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2ContentReadBudgetTracker {
  readonly admit: (
    dimension: DeclarativeV2VerifierBudgetDimensionV2,
    amount: bigint,
  ) => Result.Result<void, DeclarativeV2ContentReadBudgetError>;
  readonly charge: (
    dimension: DeclarativeV2VerifierBudgetDimensionV2,
    amount: bigint,
  ) => Result.Result<void, DeclarativeV2ContentReadBudgetError>;
  readonly remaining: (
    dimension: DeclarativeV2VerifierBudgetDimensionV2,
  ) => Result.Result<number, DeclarativeV2ContentReadBudgetError>;
  readonly receipt: () => DeclarativeV2ContentReadBudgetReceipt;
}

export interface SourceArtifactV2FinalizedModuleContent {
  readonly ordinal: number;
  readonly frameSha256: Uint8Array;
  readonly path: DeclarativeV2ArtifactModulePathHandleV1;
  readonly pathBytes: Uint8Array;
  readonly roles: number;
  readonly sourceSha256: Uint8Array;
  readonly sourceBytes: Uint8Array;
}

export interface SourceArtifactV2FinalizedContent {
  readonly root: SourceArtifactV2CompletedRootFrameInput;
  readonly modules: readonly SourceArtifactV2FinalizedModuleContent[];
}

export interface SourceArtifactV2FinalizedContentReader {
  readonly read: (
    rootSha256: unknown,
    budget: DeclarativeV2ContentReadBudgetTracker,
  ) => Effect.Effect<
    SourceArtifactV2FinalizedContent,
    SourceArtifactV2FinalizedContentReaderError,
    never
  >;
}

type MutableBudgetFrame = Record<
  DeclarativeV2VerifierBudgetDimensionV2,
  bigint
>;

interface PendingReference {
  readonly firstOrdinal: bigint;
  readonly count: bigint;
  readonly digest: Uint8Array;
}

function budgetError(
  operation: DeclarativeV2ContentReadBudgetError["operation"],
  reason: DeclarativeV2ContentReadBudgetError["reason"],
  dimension?: DeclarativeV2VerifierBudgetDimensionV2,
  observed?: bigint,
  maximum?: bigint,
): DeclarativeV2ContentReadBudgetError {
  return new DeclarativeV2ContentReadBudgetError({
    operation,
    reason,
    ...(dimension === undefined ? {} : { dimension }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}

function corruption(
  reason: SourceArtifactV2FinalizedContentCorruptionError["reason"],
  ordinal?: bigint,
): SourceArtifactV2FinalizedContentCorruptionError {
  return new SourceArtifactV2FinalizedContentCorruptionError({
    reason,
    ...(ordinal === undefined ? {} : { ordinal }),
  });
}

function measureUtf8(
  value: string,
  reason: SourceArtifactV2FinalizedContentCorruptionError["reason"],
): Result.Result<number, SourceArtifactV2FinalizedContentCorruptionError> {
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
        return Result.fail(corruption(reason));
      }
      byteLength += 4;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return Result.fail(corruption(reason));
    } else {
      byteLength += 3;
    }
    if (!Number.isSafeInteger(byteLength)) {
      return Result.fail(corruption(reason));
    }
  }
  return Result.succeed(byteLength);
}

function encodeUtf8(
  value: string,
  byteLength: number,
  reason: SourceArtifactV2FinalizedContentCorruptionError["reason"],
): Result.Result<Uint8Array, SourceArtifactV2FinalizedContentCorruptionError> {
  const bytes = new Uint8Array(byteLength);
  const encoded = UTF8_ENCODER.encodeInto(value, bytes);
  if (encoded.read !== value.length || encoded.written !== byteLength) {
    return Result.fail(corruption(reason));
  }
  return Result.succeed(bytes);
}

function captureBudgetFrame(
  value: unknown,
  kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
): Result.Result<DeclarativeV2VerifierBudgetFrameV2, DeclarativeV2ContentReadBudgetError> {
  try {
    if (!isNonArrayRecord(value)) {
      return Result.fail(budgetError("createBudget", "invalidInput"));
    }
    const expected = ["kind", ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2];
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expected.length ||
      !keys.every(key => typeof key === "string" && expected.includes(key))
    ) {
      return Result.fail(budgetError("createBudget", "invalidInput"));
    }
    const captured: Record<string, bigint | string> = { kind };
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        return Result.fail(budgetError("createBudget", "invalidInput"));
      }
      if (key === "kind") {
        if (descriptor.value !== kind) {
          return Result.fail(budgetError("createBudget", "invalidInput"));
        }
        continue;
      }
      const member = descriptor.value;
      if (
        typeof member !== "bigint" ||
        member < 0n ||
        member > MAX_SIGNED_INT64
      ) {
        return Result.fail(budgetError(
          "createBudget",
          "invalidInput",
          key as DeclarativeV2VerifierBudgetDimensionV2,
        ));
      }
      captured[key] = member;
    }
    return Result.succeed(
      Object.freeze(captured) as DeclarativeV2VerifierBudgetFrameV2,
    );
  } catch {
    return Result.fail(budgetError("createBudget", "invalidInput"));
  }
}

function captureBudgetInput(
  input: unknown,
): Readonly<Record<"ceilings" | "usage" | "command", unknown>> | undefined {
  try {
    if (!isNonArrayRecord(input)) return undefined;
    const expected = ["ceilings", "usage", "command"] as const;
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== expected.length ||
      !keys.every(key => typeof key === "string" && expected.includes(
        key as typeof expected[number],
      ))
    ) {
      return undefined;
    }
    const captured = Object.create(null) as Record<
      typeof expected[number],
      unknown
    >;
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        return undefined;
      }
      captured[key] = descriptor.value;
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

function mutableFrame(
  value: DeclarativeV2VerifierBudgetFrameV2,
): MutableBudgetFrame {
  const output = Object.create(null) as MutableBudgetFrame;
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    output[dimension] = value[dimension];
  }
  return output;
}

function frozenFrame(
  kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
  value: MutableBudgetFrame,
): DeclarativeV2VerifierBudgetFrameV2 {
  const output: Record<string, bigint | string> = { kind };
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    output[dimension] = value[dimension];
  }
  return Object.freeze(output) as DeclarativeV2VerifierBudgetFrameV2;
}

export function makeDeclarativeV2ContentReadBudgetTracker(
  input: unknown,
): Result.Result<
  DeclarativeV2ContentReadBudgetTracker,
  DeclarativeV2ContentReadBudgetError
> {
  const captured = captureBudgetInput(input);
  if (captured === undefined) {
    return Result.fail(budgetError("createBudget", "invalidInput"));
  }
  const decoded = Result.gen(function* () {
    const ceilings = yield* captureBudgetFrame(
      captured.ceilings,
      "attempt_ceilings",
    );
    const usage = yield* captureBudgetFrame(captured.usage, "attempt_usage");
    const command = yield* captureBudgetFrame(
      captured.command,
      "command_budget",
    );
    return { ceilings, usage, command } as const;
  });
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
  const { ceilings, usage, command } = decoded.success;
  const current = mutableFrame(usage);
  const commandUsage = mutableFrame(
    frozenFrame(
      "attempt_usage",
      Object.fromEntries(
        DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
          dimension,
          0n,
        ]),
      ) as MutableBudgetFrame,
    ),
  );
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    if (current[dimension] > ceilings[dimension]) {
      return Result.fail(budgetError(
        "createBudget",
        "budgetExceeded",
        dimension,
        current[dimension],
        ceilings[dimension],
      ));
    }
  }

  const admit: DeclarativeV2ContentReadBudgetTracker["admit"] = (
    dimension,
    amount,
  ) => {
    if (
      !DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.includes(dimension) ||
      amount < 0n ||
      amount > MAX_SIGNED_INT64
    ) {
      return Result.fail(budgetError("read", "invalidInput", dimension));
    }
    const nextCommand = commandUsage[dimension] + amount;
    const nextTotal = current[dimension] + amount;
    if (nextCommand > MAX_SIGNED_INT64 || nextTotal > MAX_SIGNED_INT64) {
      return Result.fail(budgetError("read", "overflow", dimension));
    }
    if (nextCommand > command[dimension]) {
      return Result.fail(budgetError(
        "read",
        "budgetExceeded",
        dimension,
        nextCommand,
        command[dimension],
      ));
    }
    if (nextTotal > ceilings[dimension]) {
      return Result.fail(budgetError(
        "read",
        "budgetExceeded",
        dimension,
        nextTotal,
        ceilings[dimension],
      ));
    }
    return Result.succeed(undefined);
  };

  const charge: DeclarativeV2ContentReadBudgetTracker["charge"] = (
    dimension,
    amount,
  ) => {
    if (
      !DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.includes(dimension) ||
      amount < 0n ||
      amount > MAX_SIGNED_INT64
    ) {
      return Result.fail(budgetError("charge", "invalidInput", dimension));
    }
    const nextCommand = commandUsage[dimension] + amount;
    const nextTotal = current[dimension] + amount;
    if (nextCommand > MAX_SIGNED_INT64 || nextTotal > MAX_SIGNED_INT64) {
      return Result.fail(budgetError("charge", "overflow", dimension));
    }
    if (nextCommand > command[dimension]) {
      return Result.fail(budgetError(
        "charge",
        "budgetExceeded",
        dimension,
        nextCommand,
        command[dimension],
      ));
    }
    if (nextTotal > ceilings[dimension]) {
      return Result.fail(budgetError(
        "charge",
        "budgetExceeded",
        dimension,
        nextTotal,
        ceilings[dimension],
      ));
    }
    commandUsage[dimension] = nextCommand;
    current[dimension] = nextTotal;
    return Result.succeed(undefined);
  };

  const remaining: DeclarativeV2ContentReadBudgetTracker["remaining"] = (
    dimension,
  ) => {
    const commandRemaining =
      command[dimension] - commandUsage[dimension];
    const attemptRemaining =
      ceilings[dimension] - current[dimension];
    const value = commandRemaining < attemptRemaining
      ? commandRemaining
      : attemptRemaining;
    if (value < 0n || value > MAX_SAFE_BIGINT) {
      return Result.fail(budgetError(
        "read",
        value < 0n ? "budgetExceeded" : "overflow",
        dimension,
        value,
        MAX_SAFE_BIGINT,
      ));
    }
    return Result.succeed(Number(value));
  };

  return Result.succeed(Object.freeze({
    admit,
    charge,
    remaining,
    receipt: () => Object.freeze({
      usage: frozenFrame("attempt_usage", current),
      commandUsage: frozenFrame("attempt_usage", commandUsage),
    }),
  }));
}

function charge(
  budget: DeclarativeV2ContentReadBudgetTracker,
  dimension: DeclarativeV2VerifierBudgetDimensionV2,
  amount: bigint,
): Effect.Effect<void, DeclarativeV2ContentReadBudgetError> {
  return Effect.fromResult(budget.charge(dimension, amount));
}

function safeNumber(
  value: bigint,
  reason: SourceArtifactV2FinalizedContentCorruptionError["reason"],
): Effect.Effect<number, SourceArtifactV2FinalizedContentCorruptionError> {
  return value > MAX_SAFE_BIGINT
    ? Effect.fail(corruption(reason))
    : Effect.succeed(Number(value));
}

function projectFrameFailure(
  reason: SourceArtifactV2FinalizedContentCorruptionError["reason"],
  failure: SourceArtifactV2FrameDecodeError,
): SourceArtifactV2FinalizedContentCorruptionError {
  return corruption(reason, failure.operation === "block" ? undefined : undefined);
}

export function makeSourceArtifactV2FinalizedContentReader(options: {
  readonly r2: SourceArtifactV2R2Store;
}): SourceArtifactV2FinalizedContentReader {
  const pathFactory = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1;

  const readObject = Effect.fn("SourceArtifactV2FinalizedContent.readObject")(
    function* (
      kind: SourceArtifactV2ObjectKind,
      digest: Uint8Array,
      budget: DeclarativeV2ContentReadBudgetTracker,
    ): Effect.fn.Return<
      SourceArtifactV2R2Object,
      DeclarativeV2ContentReadBudgetError | SourceArtifactV2R2Error
    > {
      yield* charge(budget, "calls", 1n);
      yield* charge(budget, "objectCalls", 1n);
      const object = yield* options.r2.readImmutableAdmitted(
        kind,
        digest,
        receipt => Effect.gen(function* () {
          const byteLength = BigInt(receipt.byteLength);
          yield* Effect.fromResult(budget.admit("objectBodyBytes", byteLength));
          yield* Effect.fromResult(budget.admit("hashBytes", byteLength));
          yield* Effect.fromResult(budget.admit("frameBytes", byteLength));
          yield* Effect.fromResult(budget.admit("canonicalBytes", byteLength));
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

  const decodePath = (
    path: string,
    budget: DeclarativeV2ContentReadBudgetTracker,
  ): Effect.Effect<
    Readonly<{
      readonly handle: DeclarativeV2ArtifactModulePathHandleV1;
      readonly bytes: Uint8Array;
    }>,
    DeclarativeV2ContentReadBudgetError | DeclarativeV2ArtifactModulePathV1Error
      | SourceArtifactV2FinalizedContentCorruptionError
  > =>
    Effect.gen(function* () {
      const byteLength = yield* Effect.fromResult(
        measureUtf8(path, "pathInvalid"),
      );
      const calls = Math.ceil(byteLength / 1_024) + 2;
      yield* charge(budget, "calls", BigInt(calls));
      yield* charge(budget, "stringBytes", BigInt(byteLength));
      yield* charge(budget, "outputBytes", BigInt(byteLength));
      const pathBytes = yield* Effect.fromResult(
        encodeUtf8(path, byteLength, "pathInvalid"),
      );
      const created = yield* Effect.fromResult(
        pathFactory.create(calls, pathBytes.byteLength, pathBytes.byteLength),
      );
      let offset = 0;
      while (offset < pathBytes.byteLength) {
        const chunk = pathBytes.subarray(
          offset,
          Math.min(pathBytes.byteLength, offset + 1_024),
        );
        const stepped = yield* Effect.fromResult(
          pathFactory.step(created, chunk, 1_024),
        );
        if (stepped.consumedBytes <= 0) {
          return yield* Effect.die(
            new Error("Canonical module-path validation made no progress."),
          );
        }
        offset += stepped.consumedBytes;
      }
      const finished = yield* Effect.fromResult(pathFactory.finish(created, 1_024));
      if ("status" in finished) {
        return yield* Effect.die(
          new Error("Canonical module-path validation did not settle."),
        );
      }
      return Object.freeze({
        handle: finished,
        bytes: new Uint8Array(pathBytes),
      });
    });

  const readLeafObjects = (
    treeKind: SourceArtifactV2TreeKind,
    leafKind: SourceArtifactV2ObjectKind,
    rootDigest: Uint8Array,
    count: bigint,
    budget: DeclarativeV2ContentReadBudgetTracker,
  ): Effect.Effect<
    readonly SourceArtifactV2R2Object[],
    SourceArtifactV2FinalizedContentReaderError
  > =>
    Effect.gen(function* () {
      const countNumber = yield* safeNumber(count, "countMismatch");
      if (countNumber < 1) return yield* Effect.fail(corruption("countMismatch"));
      const maximumNodes = count * 2n - 1n;
      yield* charge(budget, "graphNodes", maximumNodes);
      yield* charge(budget, "frontierEntries", maximumNodes);
      const pending: PendingReference[] = [{
        firstOrdinal: 0n,
        count,
        digest: copyBytes(rootDigest),
      }];
      const leaves: SourceArtifactV2R2Object[] = [];
      while (pending.length > 0) {
        const current = pending.pop()!;
        if (current.count === 1n) {
          const leaf = yield* readObject(
            leafKind,
            current.digest,
            budget,
          );
          leaves.push(leaf);
          continue;
        }
        const object = yield* readObject("tree-node", current.digest, budget);
        const decoded = decodeSourceArtifactV2TreeNodeFrame(
          treeKind,
          object.bytes,
          {
            maximumInputBytesMaterialized: object.bytes.byteLength,
            maximumCanonicalBytesMaterialized: object.bytes.byteLength,
            maximumFrameBytesMaterialized: object.bytes.byteLength,
          },
        );
        if (Result.isFailure(decoded)) {
          return yield* Effect.fail(
            projectFrameFailure("invalidTree", decoded.failure),
          );
        }
        const node = decoded.success.value;
        if (
          node.totalCount !== current.count ||
          node.left.firstOrdinal !== current.firstOrdinal ||
          node.right.firstOrdinal !==
            current.firstOrdinal + node.left.count ||
          node.left.count + node.right.count !== current.count
        ) {
          return yield* Effect.fail(corruption("rangeMismatch"));
        }
        pending.push(node.right, node.left);
      }
      if (leaves.length !== countNumber) {
        return yield* Effect.fail(corruption("countMismatch"));
      }
      return Object.freeze(leaves);
    });

  const read = Effect.fn("SourceArtifactV2FinalizedContent.read")(
    function* (
      rootSha256: unknown,
      budget: DeclarativeV2ContentReadBudgetTracker,
    ): Effect.fn.Return<
      SourceArtifactV2FinalizedContent,
      SourceArtifactV2FinalizedContentReaderError
    > {
      if (!isUint8ArrayWithByteLength(rootSha256, 32)) {
        return yield* Effect.fail(corruption("invalidRoot"));
      }
      const rootObject = yield* readObject(
        "completed-root",
        new Uint8Array(rootSha256),
        budget,
      );
      const decodedRoot = decodeSourceArtifactV2CompletedRootFrame(
        rootObject.bytes,
        {
          maximumInputBytesMaterialized: rootObject.bytes.byteLength,
          maximumCanonicalBytesMaterialized: rootObject.bytes.byteLength,
          maximumFrameBytesMaterialized: rootObject.bytes.byteLength,
        },
      );
      if (Result.isFailure(decodedRoot)) {
        return yield* Effect.fail(
          projectFrameFailure("invalidRoot", decodedRoot.failure),
        );
      }
      const root = decodedRoot.success.value;
      if (root.totalSourceMapBytes !== 0n) {
        return yield* Effect.fail(corruption("sourceMapUnsupported"));
      }
      yield* charge(budget, "modules", root.moduleCount);
      yield* charge(budget, "sourceBytes", root.totalSourceBytes);
      const moduleObjects = yield* readLeafObjects(
        "module",
        "module",
        root.moduleTreeDigest,
        root.moduleCount,
        budget,
      );
      const modules: SourceArtifactV2FinalizedModuleContent[] = [];
      let totalSourceBytes = 0n;
      for (let ordinal = 0; ordinal < moduleObjects.length; ordinal += 1) {
        const object = moduleObjects[ordinal]!;
        const decoded = decodeSourceArtifactV2ModuleFrame(object.bytes, {
          maximumInputBytesMaterialized: object.bytes.byteLength,
          maximumCanonicalBytesMaterialized: object.bytes.byteLength,
          maximumFrameBytesMaterialized: object.bytes.byteLength,
        });
        if (Result.isFailure(decoded)) {
          return yield* Effect.fail(
            projectFrameFailure("invalidModule", decoded.failure),
          );
        }
        const module: SourceArtifactV2DecodedModuleFrame = decoded.success.value;
        if (module.ordinal !== BigInt(ordinal)) {
          return yield* Effect.fail(
            corruption("rangeMismatch", module.ordinal),
          );
        }
        if (
          module.sourceMapByteLength !== 0n ||
          module.sourceMapBlockCount !== 0n ||
          module.sourceMapTreeDigest !== null
        ) {
          return yield* Effect.fail(
            corruption("sourceMapUnsupported", module.ordinal),
          );
        }
        const path = yield* decodePath(module.path, budget).pipe(
          Effect.catchTag(
            "DeclarativeV2ArtifactModulePathV1Error",
            () => Effect.fail(corruption("pathInvalid", module.ordinal)),
          ),
        );
        const blockObjects = yield* readLeafObjects(
          "source",
          "source-block",
          module.sourceTreeDigest,
          module.sourceBlockCount,
          budget,
        );
        const sourceLength = yield* safeNumber(
          module.sourceByteLength,
          "byteLengthMismatch",
        );
        yield* charge(budget, "outputBytes", BigInt(sourceLength));
        const sourceBytes = new Uint8Array(sourceLength);
        let sourceOffset = 0;
        for (let blockIndex = 0; blockIndex < blockObjects.length; blockIndex += 1) {
          const blockObject = blockObjects[blockIndex]!;
          const block = decodeSourceArtifactV2BlockFrame(
            "source",
            blockObject.bytes,
            {
              maximumInputBytesMaterialized: blockObject.bytes.byteLength,
              maximumCanonicalBytesMaterialized: blockObject.bytes.byteLength,
              maximumFrameBytesMaterialized: blockObject.bytes.byteLength,
            },
          );
          if (Result.isFailure(block)) {
            return yield* Effect.fail(
              projectFrameFailure("invalidBlock", block.failure),
            );
          }
          if (block.success.value.blockIndex !== BigInt(blockIndex)) {
            return yield* Effect.fail(
              corruption("rangeMismatch", BigInt(blockIndex)),
            );
          }
          const bytes = block.success.value.bytes;
          if (sourceOffset + bytes.byteLength > sourceBytes.byteLength) {
            return yield* Effect.fail(corruption("byteLengthMismatch"));
          }
          sourceBytes.set(bytes, sourceOffset);
          sourceOffset += bytes.byteLength;
        }
        if (sourceOffset !== sourceBytes.byteLength) {
          return yield* Effect.fail(corruption("byteLengthMismatch"));
        }
        totalSourceBytes += module.sourceByteLength;
        modules.push(Object.freeze({
          ordinal,
          frameSha256: copyBytes(object.digest),
          path: path.handle,
          pathBytes: path.bytes,
          roles: module.roles,
          sourceSha256: copyBytes(module.sourceTreeDigest),
          sourceBytes,
        }));
      }
      if (totalSourceBytes !== root.totalSourceBytes) {
        return yield* Effect.fail(corruption("byteLengthMismatch"));
      }
      if (
        root.executionPath.length === 0
      ) {
        return yield* Effect.fail(corruption("pathInvalid"));
      }
      const executionPath = yield* decodePath(root.executionPath, budget).pipe(
        Effect.catchTag(
          "DeclarativeV2ArtifactModulePathV1Error",
          () => Effect.fail(corruption("pathInvalid")),
        ),
      );
      if (!modules.some(module =>
        bytesEqualFullScan(module.pathBytes, executionPath.bytes)
      )) {
        return yield* Effect.fail(corruption("pathInvalid"));
      }
      return Object.freeze({
        root,
        modules: Object.freeze(modules),
      });
    },
  );

  return Object.freeze({ read });
}
