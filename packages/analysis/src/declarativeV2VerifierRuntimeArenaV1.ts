import { isUint8Array } from "@flarex/utils/bytes";
import { Data, Result } from "effect";
import type {
  DeclarativeV2VerifierBudgetDimensionV2,
  DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

interface DeclarativeV2VerifierArenaRegionV2 {
  readonly name: string;
  readonly offset: number;
  readonly byteLength: number;
}

interface DeclarativeV2VerifierArenaPlanV2 {
  readonly requiredBytes: number;
  readonly regions: ReadonlyArray<DeclarativeV2VerifierArenaRegionV2>;
  readonly usage: DeclarativeV2VerifierBudgetFrameV2;
}

const MAXIMUM_TRANSITIONS_PER_CALL = 1_024;
const MAX_U32 = 0xffff_ffff;
const SHA256_BLOCK_BYTES = 64;
const SHA256_DIGEST_BYTES = 32;
const SHA256_LENGTH_BYTES = 8;
const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  Uint8Array.prototype,
);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const UINT8_ARRAY_SUBARRAY = Uint8Array.prototype.subarray;

const SHA256_INITIAL = Object.freeze([
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
] as const);

const SHA256_ROUND_CONSTANTS = Object.freeze([
  0x428a2f98,
  0x71374491,
  0xb5c0fbcf,
  0xe9b5dba5,
  0x3956c25b,
  0x59f111f1,
  0x923f82a4,
  0xab1c5ed5,
  0xd807aa98,
  0x12835b01,
  0x243185be,
  0x550c7dc3,
  0x72be5d74,
  0x80deb1fe,
  0x9bdc06a7,
  0xc19bf174,
  0xe49b69c1,
  0xefbe4786,
  0x0fc19dc6,
  0x240ca1cc,
  0x2de92c6f,
  0x4a7484aa,
  0x5cb0a9dc,
  0x76f988da,
  0x983e5152,
  0xa831c66d,
  0xb00327c8,
  0xbf597fc7,
  0xc6e00bf3,
  0xd5a79147,
  0x06ca6351,
  0x14292967,
  0x27b70a85,
  0x2e1b2138,
  0x4d2c6dfc,
  0x53380d13,
  0x650a7354,
  0x766a0abb,
  0x81c2c92e,
  0x92722c85,
  0xa2bfe8a1,
  0xa81a664b,
  0xc24b8b70,
  0xc76c51a3,
  0xd192e819,
  0xd6990624,
  0xf40e3585,
  0x106aa070,
  0x19a4c116,
  0x1e376c08,
  0x2748774c,
  0x34b0bcb5,
  0x391c0cb3,
  0x4ed8aa4a,
  0x5b9cca4f,
  0x682e6ff3,
  0x748f82ee,
  0x78a5636f,
  0x84c87814,
  0x8cc70208,
  0x90befffa,
  0xa4506ceb,
  0xbef9a3f7,
  0xc67178f2,
] as const);

export type DeclarativeV2VerifierRuntimeArenaV1Operation =
  | "createArena"
  | "beginText"
  | "writeText"
  | "finishText"
  | "createComparison"
  | "compareText"
  | "createSearch"
  | "searchText"
  | "createOrder"
  | "order"
  | "createHash"
  | "hash"
  | "finishHash"
  | "createCursor"
  | "readCursor"
  | "revoke";

export type DeclarativeV2VerifierRuntimeArenaV1ErrorReason =
  | "invalidInput"
  | "invalidAllowance"
  | "budgetExceeded"
  | "addressabilityExceeded"
  | "closed"
  | "staleHandle"
  | "invalidUtf8"
  | "incompleteUtf8";

export class DeclarativeV2VerifierRuntimeArenaV1Error extends Data.TaggedError(
  "DeclarativeV2VerifierRuntimeArenaV1Error",
)<{
  readonly operation: DeclarativeV2VerifierRuntimeArenaV1Operation;
  readonly reason: DeclarativeV2VerifierRuntimeArenaV1ErrorReason;
  readonly dimension?: DeclarativeV2VerifierBudgetDimensionV2 | "transitions";
  readonly observed?: bigint;
  readonly maximum?: bigint;
}> {}

export interface DeclarativeV2VerifierRuntimeArenaHandleV1 {
  readonly _tag: "DeclarativeV2VerifierRuntimeArenaHandleV1";
}

export interface DeclarativeV2VerifierRuntimeTextHandleV1 {
  readonly _tag: "DeclarativeV2VerifierRuntimeTextHandleV1";
}

export interface DeclarativeV2VerifierRuntimeTextWriterV1 {
  readonly _tag: "DeclarativeV2VerifierRuntimeTextWriterV1";
}

export interface DeclarativeV2VerifierRuntimeComparisonV1 {
  readonly _tag: "DeclarativeV2VerifierRuntimeComparisonV1";
}

export interface DeclarativeV2VerifierRuntimeSearchV1 {
  readonly _tag: "DeclarativeV2VerifierRuntimeSearchV1";
}

export interface DeclarativeV2VerifierRuntimeOrderV1 {
  readonly _tag: "DeclarativeV2VerifierRuntimeOrderV1";
}

export interface DeclarativeV2VerifierRuntimeSha256V1 {
  readonly _tag: "DeclarativeV2VerifierRuntimeSha256V1";
}

export interface DeclarativeV2VerifierRuntimeCursorV1 {
  readonly _tag: "DeclarativeV2VerifierRuntimeCursorV1";
}

export interface DeclarativeV2VerifierRuntimeUsageV1 {
  readonly calls: bigint;
  readonly inputBytes: bigint;
  readonly outputBytes: bigint;
  readonly stringBytes: bigint;
  readonly canonicalBytes: bigint;
  readonly hashBytes: bigint;
  readonly graphNodes: bigint;
  readonly frontierEntries: bigint;
  readonly transitions: bigint;
  readonly consumedBytes: bigint;
}

export interface DeclarativeV2VerifierRuntimeReceiptV1 {
  readonly delta: DeclarativeV2VerifierRuntimeUsageV1;
  readonly aggregate: DeclarativeV2VerifierRuntimeUsageV1;
}

export interface DeclarativeV2VerifierRuntimePendingV1 {
  readonly status: "pending";
  readonly receipt: DeclarativeV2VerifierRuntimeReceiptV1;
}

export interface DeclarativeV2VerifierRuntimeTextCompleteV1 {
  readonly status: "complete";
  readonly text: DeclarativeV2VerifierRuntimeTextHandleV1;
  readonly receipt: DeclarativeV2VerifierRuntimeReceiptV1;
}

export interface DeclarativeV2VerifierRuntimeComparisonCompleteV1 {
  readonly status: "complete";
  readonly order: -1 | 0 | 1;
  readonly receipt: DeclarativeV2VerifierRuntimeReceiptV1;
}

export interface DeclarativeV2VerifierRuntimeSearchCompleteV1 {
  readonly status: "complete";
  readonly found: boolean;
  readonly byteOffset: number | null;
  readonly receipt: DeclarativeV2VerifierRuntimeReceiptV1;
}

export interface DeclarativeV2VerifierRuntimeOrderCompleteV1 {
  readonly status: "complete";
  readonly count: number;
  readonly receipt: DeclarativeV2VerifierRuntimeReceiptV1;
}

export interface DeclarativeV2VerifierRuntimeHashCompleteV1 {
  readonly status: "complete";
  readonly digest: Uint8Array;
  readonly receipt: DeclarativeV2VerifierRuntimeReceiptV1;
}

export interface DeclarativeV2VerifierRuntimeCursorCompleteV1 {
  readonly status: "complete";
  readonly byte: number | null;
  readonly byteOffset: number;
  readonly receipt: DeclarativeV2VerifierRuntimeReceiptV1;
}

type RuntimeStepV1<T> = Result.Result<
  DeclarativeV2VerifierRuntimePendingV1 | T,
  DeclarativeV2VerifierRuntimeArenaV1Error
>;

interface MutableRuntimeUsageV1 {
  calls: bigint;
  inputBytes: bigint;
  outputBytes: bigint;
  stringBytes: bigint;
  canonicalBytes: bigint;
  hashBytes: bigint;
  graphNodes: bigint;
  frontierEntries: bigint;
  transitions: bigint;
  consumedBytes: bigint;
}

interface RuntimeArenaStateV1 {
  readonly buffer: ArrayBuffer;
  readonly bytes: Uint8Array;
  readonly regions: ReadonlyArray<DeclarativeV2VerifierArenaRegionV2>;
  readonly required: DeclarativeV2VerifierBudgetFrameV2;
  readonly usage: MutableRuntimeUsageV1;
  stringCursor: number;
  outputCursor: number;
  orderAllocated: boolean;
  revoked: boolean;
}

interface RuntimeTextStateV1 {
  readonly arena: RuntimeArenaStateV1;
  readonly offset: number;
  readonly byteLength: number;
}

interface RuntimeTextWriterStateV1 {
  readonly arena: RuntimeArenaStateV1;
  readonly offset: number;
  readonly maximumByteLength: number;
  byteLength: number;
  utf8State: number;
  utf8CodePoint: number;
  utf8Minimum: number;
  terminal: "open" | "complete" | "failed";
}

interface RuntimeScalarCursorV1 {
  byteOffset: number;
  pendingLowSurrogate: number;
}

interface RuntimeComparisonStateV1 {
  readonly arena: RuntimeArenaStateV1;
  readonly left: RuntimeTextStateV1;
  readonly right: RuntimeTextStateV1;
  readonly leftCursor: RuntimeScalarCursorV1;
  readonly rightCursor: RuntimeScalarCursorV1;
  terminal: "open" | "complete" | "failed";
  order: -1 | 0 | 1;
}

interface RuntimeSearchStateV1 {
  readonly arena: RuntimeArenaStateV1;
  readonly haystack: RuntimeTextStateV1;
  readonly needle: RuntimeTextStateV1;
  candidate: number;
  needleOffset: number;
  terminal: "open" | "complete" | "failed";
  foundOffset: number | null;
}

interface RuntimeOrderStateV1 {
  readonly arena: RuntimeArenaStateV1;
  readonly records: DataView;
  readonly count: number;
  appended: number;
  outer: number;
  inner: number;
  currentComparison: DeclarativeV2VerifierRuntimeComparisonV1 | undefined;
  terminal: "open" | "complete" | "failed";
}

interface RuntimeSha256StateV1 {
  readonly arena: RuntimeArenaStateV1;
  readonly hash: Uint32Array;
  readonly block: Uint8Array;
  readonly schedule: Uint32Array;
  blockLength: number;
  totalBytes: bigint;
  round: number;
  scheduleCursor: number;
  working: Uint32Array | undefined;
  pendingFinalize: boolean;
  finalBlockSubmitted: boolean;
  lengthCursor: number;
  terminal: "open" | "finishing" | "complete" | "failed";
}

interface RuntimeCursorStateV1 {
  readonly arena: RuntimeArenaStateV1;
  readonly text: RuntimeTextStateV1;
  offset: number;
  terminal: "open" | "complete" | "failed";
}

const OWNED_ARENAS = new WeakMap<
  object,
  RuntimeArenaStateV1
>();
const OWNED_TEXTS = new WeakMap<object, RuntimeTextStateV1>();
const OWNED_TEXT_WRITERS = new WeakMap<object, RuntimeTextWriterStateV1>();
const OWNED_COMPARISONS = new WeakMap<object, RuntimeComparisonStateV1>();
const OWNED_SEARCHES = new WeakMap<object, RuntimeSearchStateV1>();
const OWNED_ORDERS = new WeakMap<object, RuntimeOrderStateV1>();
const OWNED_HASHES = new WeakMap<object, RuntimeSha256StateV1>();
const OWNED_CURSORS = new WeakMap<object, RuntimeCursorStateV1>();

function arenaError(
  operation: DeclarativeV2VerifierRuntimeArenaV1Operation,
  reason: DeclarativeV2VerifierRuntimeArenaV1ErrorReason,
  evidence?: Readonly<{
    readonly dimension?: DeclarativeV2VerifierRuntimeArenaV1Error["dimension"];
    readonly observed?: bigint;
    readonly maximum?: bigint;
  }>,
): DeclarativeV2VerifierRuntimeArenaV1Error {
  return new DeclarativeV2VerifierRuntimeArenaV1Error({
    operation,
    reason,
    ...(evidence?.dimension === undefined
      ? {}
      : { dimension: evidence.dimension }),
    ...(evidence?.observed === undefined
      ? {}
      : { observed: evidence.observed }),
    ...(evidence?.maximum === undefined
      ? {}
      : { maximum: evidence.maximum }),
  });
}

function makeHandle<T extends { readonly _tag: string }>(
  tag: T["_tag"],
): T {
  return Object.freeze({ _tag: tag }) as T;
}

function zeroRuntimeUsage(): MutableRuntimeUsageV1 {
  return {
    calls: 0n,
    inputBytes: 0n,
    outputBytes: 0n,
    stringBytes: 0n,
    canonicalBytes: 0n,
    hashBytes: 0n,
    graphNodes: 0n,
    frontierEntries: 0n,
    transitions: 0n,
    consumedBytes: 0n,
  };
}

function frozenRuntimeUsage(
  usage: Readonly<MutableRuntimeUsageV1>,
): DeclarativeV2VerifierRuntimeUsageV1 {
  return Object.freeze({ ...usage });
}

function subtractUsage(
  next: Readonly<MutableRuntimeUsageV1>,
  before: Readonly<MutableRuntimeUsageV1>,
): DeclarativeV2VerifierRuntimeUsageV1 {
  return Object.freeze({
    calls: next.calls - before.calls,
    inputBytes: next.inputBytes - before.inputBytes,
    outputBytes: next.outputBytes - before.outputBytes,
    stringBytes: next.stringBytes - before.stringBytes,
    canonicalBytes: next.canonicalBytes - before.canonicalBytes,
    hashBytes: next.hashBytes - before.hashBytes,
    graphNodes: next.graphNodes - before.graphNodes,
    frontierEntries: next.frontierEntries - before.frontierEntries,
    transitions: next.transitions - before.transitions,
    consumedBytes: next.consumedBytes - before.consumedBytes,
  });
}

function receipt(
  arena: RuntimeArenaStateV1,
  before: Readonly<MutableRuntimeUsageV1>,
): DeclarativeV2VerifierRuntimeReceiptV1 {
  return Object.freeze({
    delta: subtractUsage(arena.usage, before),
    aggregate: frozenRuntimeUsage(arena.usage),
  });
}

function captureBefore(
  usage: Readonly<MutableRuntimeUsageV1>,
): MutableRuntimeUsageV1 {
  return { ...usage };
}

function regionByName(
  arena: RuntimeArenaStateV1,
  name: string,
): DeclarativeV2VerifierArenaRegionV2 | undefined {
  for (let index = 0; index < arena.regions.length; index += 1) {
    const candidate = arena.regions[index];
    if (candidate?.name === name) return candidate;
  }
  return undefined;
}

function captureAllowance(
  rawAllowance: unknown,
  operation: DeclarativeV2VerifierRuntimeArenaV1Operation,
): Result.Result<number, DeclarativeV2VerifierRuntimeArenaV1Error> {
  if (
    typeof rawAllowance !== "number" ||
    !Number.isSafeInteger(rawAllowance) ||
    rawAllowance < 0 ||
    rawAllowance > MAXIMUM_TRANSITIONS_PER_CALL
  ) {
    return Result.fail(arenaError(operation, "invalidAllowance", {
      dimension: "transitions",
      ...(typeof rawAllowance === "number" &&
          Number.isFinite(rawAllowance) &&
          rawAllowance >= 0
        ? { observed: BigInt(Math.trunc(rawAllowance)) }
        : {}),
      maximum: BigInt(MAXIMUM_TRANSITIONS_PER_CALL),
    }));
  }
  return Result.succeed(rawAllowance);
}

function charge(
  arena: RuntimeArenaStateV1,
  operation: DeclarativeV2VerifierRuntimeArenaV1Operation,
  dimension:
    | "calls"
    | "inputBytes"
    | "outputBytes"
    | "stringBytes"
    | "canonicalBytes"
    | "hashBytes"
    | "graphNodes"
    | "frontierEntries",
  amount: bigint,
): DeclarativeV2VerifierRuntimeArenaV1Error | undefined {
  const budgetDimension = dimension === "inputBytes"
    ? "objectBodyBytes"
    : dimension;
  const maximum = arena.required[budgetDimension];
  const observed = arena.usage[dimension] + amount;
  if (observed > maximum) {
    return arenaError(operation, "budgetExceeded", {
      dimension: budgetDimension,
      observed,
      maximum,
    });
  }
  arena.usage[dimension] = observed;
  return undefined;
}

function beginCall(
  arena: RuntimeArenaStateV1,
  operation: DeclarativeV2VerifierRuntimeArenaV1Operation,
  rawAllowance: unknown,
): Result.Result<
  Readonly<{
    readonly allowance: number;
    readonly before: MutableRuntimeUsageV1;
  }>,
  DeclarativeV2VerifierRuntimeArenaV1Error
> {
  if (arena.revoked) return Result.fail(arenaError(operation, "closed"));
  return Result.gen(function*() {
    const allowance = yield* captureAllowance(rawAllowance, operation);
    const before = captureBefore(arena.usage);
    const charged = charge(arena, operation, "calls", 1n);
    if (charged !== undefined) return yield* Result.fail(charged);
    return Object.freeze({ allowance, before });
  });
}

function pending(
  arena: RuntimeArenaStateV1,
  before: Readonly<MutableRuntimeUsageV1>,
): DeclarativeV2VerifierRuntimePendingV1 {
  return Object.freeze({
    status: "pending",
    receipt: receipt(arena, before),
  });
}

function transition(arena: RuntimeArenaStateV1): void {
  arena.usage.transitions += 1n;
}

function arenaState(
  rawArena: unknown,
  operation: DeclarativeV2VerifierRuntimeArenaV1Operation,
): Result.Result<
  RuntimeArenaStateV1,
  DeclarativeV2VerifierRuntimeArenaV1Error
> {
  const state = rawArena !== null &&
      typeof rawArena === "object"
    ? OWNED_ARENAS.get(rawArena)
    : undefined;
  return state === undefined || state.revoked
    ? Result.fail(arenaError(operation, "staleHandle"))
    : Result.succeed(state);
}

function textState(
  rawText: unknown,
  operation: DeclarativeV2VerifierRuntimeArenaV1Operation,
): Result.Result<
  RuntimeTextStateV1,
  DeclarativeV2VerifierRuntimeArenaV1Error
> {
  const state = rawText !== null && typeof rawText === "object"
    ? OWNED_TEXTS.get(rawText)
    : undefined;
  return state === undefined || state.arena.revoked
    ? Result.fail(arenaError(operation, "staleHandle"))
    : Result.succeed(state);
}

function sameArena(
  operation: DeclarativeV2VerifierRuntimeArenaV1Operation,
  left: RuntimeArenaStateV1,
  right: RuntimeArenaStateV1,
): Result.Result<void, DeclarativeV2VerifierRuntimeArenaV1Error> {
  return left === right
    ? Result.succeed(undefined)
    : Result.fail(arenaError(operation, "staleHandle"));
}

export function createDeclarativeV2VerifierRuntimeArenaV1(
  plan: DeclarativeV2VerifierArenaPlanV2,
): Result.Result<
  DeclarativeV2VerifierRuntimeArenaHandleV1,
  DeclarativeV2VerifierRuntimeArenaV1Error
> {
  if (
    !Number.isSafeInteger(plan.requiredBytes) ||
    plan.requiredBytes < 0 ||
    plan.requiredBytes > MAX_U32
  ) {
    return Result.fail(arenaError(
      "createArena",
      "addressabilityExceeded",
    ));
  }
  let buffer: ArrayBuffer;
  try {
    buffer = new ArrayBuffer(plan.requiredBytes);
  } catch {
    return Result.fail(arenaError(
      "createArena",
      "addressabilityExceeded",
    ));
  }
  const state: RuntimeArenaStateV1 = {
    buffer,
    bytes: new Uint8Array(buffer),
    regions: plan.regions,
    required: plan.usage,
    usage: zeroRuntimeUsage(),
    stringCursor: 0,
    outputCursor: 0,
    orderAllocated: false,
    revoked: false,
  };
  const handle =
    makeHandle<DeclarativeV2VerifierRuntimeArenaHandleV1>(
      "DeclarativeV2VerifierRuntimeArenaHandleV1",
    );
  OWNED_ARENAS.set(handle, state);
  return Result.succeed(handle);
}

export function declarativeV2VerifierRuntimeArenaRegionV1(
  rawArena: unknown,
  name: string,
): Result.Result<
  Uint8Array,
  DeclarativeV2VerifierRuntimeArenaV1Error
> {
  const arena = arenaState(rawArena, "createArena");
  if (Result.isFailure(arena)) return Result.fail(arena.failure);
  const found = regionByName(arena.success, name);
  if (found === undefined) {
    return Result.fail(arenaError("createArena", "invalidInput"));
  }
  return Result.succeed(new Uint8Array(
    arena.success.buffer,
    found.offset,
    found.byteLength,
  ));
}

export function beginDeclarativeV2VerifierRuntimeTextV1(
  rawArena: unknown,
  rawMaximumByteLength: unknown,
): Result.Result<
  DeclarativeV2VerifierRuntimeTextWriterV1,
  DeclarativeV2VerifierRuntimeArenaV1Error
> {
  const arena = arenaState(rawArena, "beginText");
  if (Result.isFailure(arena)) return Result.fail(arena.failure);
  if (
    typeof rawMaximumByteLength !== "number" ||
    !Number.isSafeInteger(rawMaximumByteLength) ||
    rawMaximumByteLength < 0
  ) {
    return Result.fail(arenaError("beginText", "invalidInput"));
  }
  const stringRegion = regionByName(
    arena.success,
    "stringBytesStorage",
  );
  if (
    stringRegion === undefined ||
    arena.success.stringCursor + rawMaximumByteLength >
      stringRegion.byteLength
  ) {
    return Result.fail(arenaError("beginText", "budgetExceeded", {
      dimension: "stringBytes",
      observed: BigInt(arena.success.stringCursor + rawMaximumByteLength),
      maximum: BigInt(stringRegion?.byteLength ?? 0),
    }));
  }
  const writer =
    makeHandle<DeclarativeV2VerifierRuntimeTextWriterV1>(
      "DeclarativeV2VerifierRuntimeTextWriterV1",
    );
  OWNED_TEXT_WRITERS.set(writer, {
    arena: arena.success,
    offset: stringRegion.offset + arena.success.stringCursor,
    maximumByteLength: rawMaximumByteLength,
    byteLength: 0,
    utf8State: 0,
    utf8CodePoint: 0,
    utf8Minimum: 0,
    terminal: "open",
  });
  arena.success.stringCursor += rawMaximumByteLength;
  return Result.succeed(writer);
}

function failTextWriter(
  state: RuntimeTextWriterStateV1,
  error: DeclarativeV2VerifierRuntimeArenaV1Error,
): Result.Result<never, DeclarativeV2VerifierRuntimeArenaV1Error> {
  state.terminal = "failed";
  return Result.fail(error);
}

function advanceUtf8(
  state: RuntimeTextWriterStateV1,
  byte: number,
): boolean {
  if (state.utf8State === 0) {
    if (byte <= 0x7f) return true;
    if (byte >= 0xc2 && byte <= 0xdf) {
      state.utf8State = 1;
      state.utf8CodePoint = byte & 0x1f;
      state.utf8Minimum = 0x80;
      return true;
    }
    if (byte >= 0xe0 && byte <= 0xef) {
      state.utf8State = 2;
      state.utf8CodePoint = byte & 0x0f;
      state.utf8Minimum = 0x800;
      return true;
    }
    if (byte >= 0xf0 && byte <= 0xf4) {
      state.utf8State = 3;
      state.utf8CodePoint = byte & 0x07;
      state.utf8Minimum = 0x1_0000;
      return true;
    }
    return false;
  }
  if (byte < 0x80 || byte > 0xbf) return false;
  state.utf8CodePoint = (state.utf8CodePoint << 6) | (byte & 0x3f);
  state.utf8State -= 1;
  if (state.utf8State !== 0) return true;
  const codePoint = state.utf8CodePoint;
  return codePoint >= state.utf8Minimum &&
    codePoint <= 0x10ffff &&
    !(codePoint >= 0xd800 && codePoint <= 0xdfff);
}

export function stepDeclarativeV2VerifierRuntimeTextV1(
  rawWriter: unknown,
  rawBytes: unknown,
  rawAllowance: unknown,
): RuntimeStepV1<DeclarativeV2VerifierRuntimeTextCompleteV1> {
  const state = rawWriter !== null && typeof rawWriter === "object"
    ? OWNED_TEXT_WRITERS.get(rawWriter)
    : undefined;
  if (state === undefined || state.arena.revoked) {
    return Result.fail(arenaError("writeText", "staleHandle"));
  }
  if (state.terminal !== "open") {
    return Result.fail(arenaError("writeText", "closed"));
  }
  let visible: Uint8Array;
  try {
    if (!isUint8Array(rawBytes) || TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) {
      return failTextWriter(
        state,
        arenaError("writeText", "invalidInput"),
      );
    }
    const byteLength = Reflect.apply(
      TYPED_ARRAY_BYTE_LENGTH_GETTER,
      rawBytes,
      [],
    ) as number;
    visible = Reflect.apply(
      UINT8_ARRAY_SUBARRAY,
      rawBytes,
      [0, byteLength],
    ) as Uint8Array;
  } catch {
    return failTextWriter(
      state,
      arenaError("writeText", "invalidInput"),
    );
  }
  const call = beginCall(state.arena, "writeText", rawAllowance);
  if (Result.isFailure(call)) return failTextWriter(state, call.failure);
  let consumed = 0;
  while (
    consumed < visible.byteLength &&
    consumed < call.success.allowance
  ) {
    const nextLength = state.byteLength + 1;
    if (nextLength > state.maximumByteLength) {
      return failTextWriter(
        state,
        arenaError("writeText", "budgetExceeded", {
          dimension: "stringBytes",
          observed: BigInt(nextLength),
          maximum: BigInt(state.maximumByteLength),
        }),
      );
    }
    const inputFailure = charge(state.arena, "writeText", "inputBytes", 1n);
    if (inputFailure !== undefined) {
      return failTextWriter(state, inputFailure);
    }
    const stringFailure = charge(
      state.arena,
      "writeText",
      "stringBytes",
      1n,
    );
    if (stringFailure !== undefined) {
      return failTextWriter(state, stringFailure);
    }
    const byte = visible[consumed]!;
    if (!advanceUtf8(state, byte)) {
      return failTextWriter(
        state,
        arenaError("writeText", "invalidUtf8"),
      );
    }
    state.arena.bytes[state.offset + state.byteLength] = byte;
    state.byteLength = nextLength;
    consumed += 1;
    state.arena.usage.consumedBytes += 1n;
    transition(state.arena);
  }
  return Result.succeed(pending(state.arena, call.success.before));
}

export function finishDeclarativeV2VerifierRuntimeTextV1(
  rawWriter: unknown,
  rawAllowance: unknown,
): RuntimeStepV1<DeclarativeV2VerifierRuntimeTextCompleteV1> {
  const state = rawWriter !== null && typeof rawWriter === "object"
    ? OWNED_TEXT_WRITERS.get(rawWriter)
    : undefined;
  if (state === undefined || state.arena.revoked) {
    return Result.fail(arenaError("finishText", "staleHandle"));
  }
  if (state.terminal !== "open") {
    return Result.fail(arenaError("finishText", "closed"));
  }
  const call = beginCall(state.arena, "finishText", rawAllowance);
  if (Result.isFailure(call)) return failTextWriter(state, call.failure);
  if (call.success.allowance === 0) {
    return Result.succeed(pending(state.arena, call.success.before));
  }
  transition(state.arena);
  if (state.utf8State !== 0) {
    return failTextWriter(
      state,
      arenaError("finishText", "incompleteUtf8"),
    );
  }
  state.terminal = "complete";
  const text = makeHandle<DeclarativeV2VerifierRuntimeTextHandleV1>(
    "DeclarativeV2VerifierRuntimeTextHandleV1",
  );
  OWNED_TEXTS.set(text, {
    arena: state.arena,
    offset: state.offset,
    byteLength: state.byteLength,
  });
  return Result.succeed(Object.freeze({
    status: "complete",
    text,
    receipt: receipt(state.arena, call.success.before),
  }));
}

function readScalar(
  text: RuntimeTextStateV1,
  cursor: RuntimeScalarCursorV1,
): number | null {
  if (cursor.pendingLowSurrogate !== 0) {
    const unit = cursor.pendingLowSurrogate;
    cursor.pendingLowSurrogate = 0;
    return unit;
  }
  if (cursor.byteOffset >= text.byteLength) return null;
  const first = text.arena.bytes[text.offset + cursor.byteOffset]!;
  cursor.byteOffset += 1;
  if (first <= 0x7f) return first;
  const continuationCount = first <= 0xdf ? 1 : first <= 0xef ? 2 : 3;
  let codePoint = first & (continuationCount === 1
    ? 0x1f
    : continuationCount === 2
    ? 0x0f
    : 0x07);
  for (let index = 0; index < continuationCount; index += 1) {
    const byte =
      text.arena.bytes[text.offset + cursor.byteOffset]!;
    cursor.byteOffset += 1;
    codePoint = (codePoint << 6) | (byte & 0x3f);
  }
  if (codePoint <= 0xffff) return codePoint;
  const adjusted = codePoint - 0x1_0000;
  cursor.pendingLowSurrogate = 0xdc00 | (adjusted & 0x3ff);
  return 0xd800 | (adjusted >>> 10);
}

export function createDeclarativeV2VerifierRuntimeComparisonV1(
  rawLeft: unknown,
  rawRight: unknown,
): Result.Result<
  DeclarativeV2VerifierRuntimeComparisonV1,
  DeclarativeV2VerifierRuntimeArenaV1Error
> {
  return Result.gen(function*() {
    const left = yield* textState(rawLeft, "createComparison");
    const right = yield* textState(rawRight, "createComparison");
    yield* sameArena("createComparison", left.arena, right.arena);
    const handle =
      makeHandle<DeclarativeV2VerifierRuntimeComparisonV1>(
        "DeclarativeV2VerifierRuntimeComparisonV1",
      );
    OWNED_COMPARISONS.set(handle, {
      arena: left.arena,
      left,
      right,
      leftCursor: { byteOffset: 0, pendingLowSurrogate: 0 },
      rightCursor: { byteOffset: 0, pendingLowSurrogate: 0 },
      terminal: "open",
      order: 0,
    });
    return handle;
  });
}

export function stepDeclarativeV2VerifierRuntimeComparisonV1(
  rawComparison: unknown,
  rawAllowance: unknown,
): RuntimeStepV1<DeclarativeV2VerifierRuntimeComparisonCompleteV1> {
  const state = rawComparison !== null && typeof rawComparison === "object"
    ? OWNED_COMPARISONS.get(rawComparison)
    : undefined;
  if (state === undefined || state.arena.revoked) {
    return Result.fail(arenaError("compareText", "staleHandle"));
  }
  if (state.terminal !== "open") {
    return Result.fail(arenaError("compareText", "closed"));
  }
  const call = beginCall(state.arena, "compareText", rawAllowance);
  if (Result.isFailure(call)) {
    state.terminal = "failed";
    return Result.fail(call.failure);
  }
  for (
    let used = 0;
    used < call.success.allowance;
    used += 1
  ) {
    const left = readScalar(state.left, state.leftCursor);
    const right = readScalar(state.right, state.rightCursor);
    transition(state.arena);
    if (left === null || right === null || left !== right) {
      state.order = left === right
        ? 0
        : left === null
        ? -1
        : right === null
        ? 1
        : left < right
        ? -1
        : 1;
      state.terminal = "complete";
      return Result.succeed(Object.freeze({
        status: "complete",
        order: state.order,
        receipt: receipt(state.arena, call.success.before),
      }));
    }
  }
  return Result.succeed(pending(state.arena, call.success.before));
}

export function createDeclarativeV2VerifierRuntimeSearchV1(
  rawHaystack: unknown,
  rawNeedle: unknown,
): Result.Result<
  DeclarativeV2VerifierRuntimeSearchV1,
  DeclarativeV2VerifierRuntimeArenaV1Error
> {
  return Result.gen(function*() {
    const haystack = yield* textState(rawHaystack, "createSearch");
    const needle = yield* textState(rawNeedle, "createSearch");
    yield* sameArena("createSearch", haystack.arena, needle.arena);
    const handle = makeHandle<DeclarativeV2VerifierRuntimeSearchV1>(
      "DeclarativeV2VerifierRuntimeSearchV1",
    );
    OWNED_SEARCHES.set(handle, {
      arena: haystack.arena,
      haystack,
      needle,
      candidate: 0,
      needleOffset: 0,
      terminal: "open",
      foundOffset: null,
    });
    return handle;
  });
}

export function stepDeclarativeV2VerifierRuntimeSearchV1(
  rawSearch: unknown,
  rawAllowance: unknown,
): RuntimeStepV1<DeclarativeV2VerifierRuntimeSearchCompleteV1> {
  const state = rawSearch !== null && typeof rawSearch === "object"
    ? OWNED_SEARCHES.get(rawSearch)
    : undefined;
  if (state === undefined || state.arena.revoked) {
    return Result.fail(arenaError("searchText", "staleHandle"));
  }
  if (state.terminal !== "open") {
    return Result.fail(arenaError("searchText", "closed"));
  }
  const call = beginCall(state.arena, "searchText", rawAllowance);
  if (Result.isFailure(call)) {
    state.terminal = "failed";
    return Result.fail(call.failure);
  }
  for (
    let used = 0;
    used < call.success.allowance;
    used += 1
  ) {
    if (state.needle.byteLength === 0) {
      state.foundOffset = state.candidate;
      state.terminal = "complete";
    } else if (
      state.candidate + state.needle.byteLength >
        state.haystack.byteLength
    ) {
      state.terminal = "complete";
    } else {
      const haystackByte = state.arena.bytes[
        state.haystack.offset + state.candidate + state.needleOffset
      ]!;
      const needleByte = state.arena.bytes[
        state.needle.offset + state.needleOffset
      ]!;
      if (haystackByte === needleByte) {
        state.needleOffset += 1;
        if (state.needleOffset === state.needle.byteLength) {
          state.foundOffset = state.candidate;
          state.terminal = "complete";
        }
      } else {
        state.candidate += 1;
        state.needleOffset = 0;
      }
    }
    transition(state.arena);
    if (state.terminal === "complete") {
      return Result.succeed(Object.freeze({
        status: "complete",
        found: state.foundOffset !== null,
        byteOffset: state.foundOffset,
        receipt: receipt(state.arena, call.success.before),
      }));
    }
  }
  return Result.succeed(pending(state.arena, call.success.before));
}

export function createDeclarativeV2VerifierRuntimeOrderV1(
  rawArena: unknown,
  rawCount: unknown,
): Result.Result<
  DeclarativeV2VerifierRuntimeOrderV1,
  DeclarativeV2VerifierRuntimeArenaV1Error
> {
  const arena = arenaState(rawArena, "createOrder");
  if (Result.isFailure(arena)) return Result.fail(arena.failure);
  if (
    typeof rawCount !== "number" ||
    !Number.isSafeInteger(rawCount) ||
    rawCount < 0
  ) {
    return Result.fail(arenaError("createOrder", "invalidInput"));
  }
  const count = rawCount;
  if (
    !Number.isSafeInteger(count) ||
    BigInt(count) > arena.success.required.graphNodes
  ) {
    return Result.fail(arenaError("createOrder", "budgetExceeded", {
      dimension: "graphNodes",
      observed: BigInt(count),
      maximum: arena.success.required.graphNodes,
    }));
  }
  const graphRegion = regionByName(arena.success, "graphNodeRecord");
  if (graphRegion === undefined || count * 16 > graphRegion.byteLength) {
    return Result.fail(arenaError("createOrder", "addressabilityExceeded"));
  }
  if (arena.success.orderAllocated) {
    return Result.fail(arenaError("createOrder", "closed"));
  }
  const records = new DataView(
    arena.success.buffer,
    graphRegion.offset,
    count * 16,
  );
  arena.success.orderAllocated = true;
  const handle = makeHandle<DeclarativeV2VerifierRuntimeOrderV1>(
    "DeclarativeV2VerifierRuntimeOrderV1",
  );
  OWNED_ORDERS.set(handle, {
    arena: arena.success,
    records,
    count,
    appended: 0,
    outer: 1,
    inner: 1,
    currentComparison: undefined,
    terminal: "open",
  });
  return Result.succeed(handle);
}

export function appendDeclarativeV2VerifierRuntimeOrderTextV1(
  rawOrder: unknown,
  rawText: unknown,
): Result.Result<void, DeclarativeV2VerifierRuntimeArenaV1Error> {
  const state = rawOrder !== null && typeof rawOrder === "object"
    ? OWNED_ORDERS.get(rawOrder)
    : undefined;
  if (state === undefined || state.arena.revoked) {
    return Result.fail(arenaError("createOrder", "staleHandle"));
  }
  if (state.terminal !== "open") {
    return Result.fail(arenaError("createOrder", "closed"));
  }
  if (state.appended >= state.count || state.outer !== 1) {
    state.terminal = "failed";
    return Result.fail(arenaError("createOrder", "closed"));
  }
  const prepared = Result.gen(function*() {
    const captured = yield* textState(rawText, "createOrder");
    yield* sameArena(
      "createOrder",
      state.arena,
      captured.arena,
    );
    return captured;
  });
  if (Result.isFailure(prepared)) {
    state.terminal = "failed";
    return Result.fail(prepared.failure);
  }
  const record = state.appended * 16;
  state.records.setUint32(record, prepared.success.offset, false);
  state.records.setUint32(record + 4, prepared.success.byteLength, false);
  state.records.setUint32(record + 8, state.appended, false);
  state.records.setUint32(record + 12, 0, false);
  state.appended += 1;
  return Result.succeed(undefined);
}

export function stepDeclarativeV2VerifierRuntimeOrderV1(
  rawOrder: unknown,
  rawAllowance: unknown,
): RuntimeStepV1<DeclarativeV2VerifierRuntimeOrderCompleteV1> {
  const state = rawOrder !== null && typeof rawOrder === "object"
    ? OWNED_ORDERS.get(rawOrder)
    : undefined;
  if (state === undefined || state.arena.revoked) {
    return Result.fail(arenaError("order", "staleHandle"));
  }
  if (state.terminal !== "open") {
    return Result.fail(arenaError("order", "closed"));
  }
  const call = beginCall(state.arena, "order", rawAllowance);
  if (Result.isFailure(call)) {
    state.terminal = "failed";
    return Result.fail(call.failure);
  }
  if (state.appended !== state.count) {
    state.terminal = "failed";
    return Result.fail(arenaError("order", "invalidInput"));
  }
  if (state.count < 2) {
    state.terminal = "complete";
    return Result.succeed(Object.freeze({
      status: "complete",
      count: state.count,
      receipt: receipt(state.arena, call.success.before),
    }));
  }
  let used = 0;
  while (used < call.success.allowance) {
    if (state.currentComparison === undefined) {
      const leftRecord = (state.inner - 1) * 16;
      const rightRecord = state.inner * 16;
      const left: RuntimeTextStateV1 = {
        arena: state.arena,
        offset: state.records.getUint32(leftRecord, false),
        byteLength: state.records.getUint32(leftRecord + 4, false),
      };
      const right: RuntimeTextStateV1 = {
        arena: state.arena,
        offset: state.records.getUint32(rightRecord, false),
        byteLength: state.records.getUint32(rightRecord + 4, false),
      };
      const leftHandle =
        makeHandle<DeclarativeV2VerifierRuntimeTextHandleV1>(
          "DeclarativeV2VerifierRuntimeTextHandleV1",
        );
      const rightHandle =
        makeHandle<DeclarativeV2VerifierRuntimeTextHandleV1>(
          "DeclarativeV2VerifierRuntimeTextHandleV1",
        );
      OWNED_TEXTS.set(leftHandle, left);
      OWNED_TEXTS.set(rightHandle, right);
      const comparison = createDeclarativeV2VerifierRuntimeComparisonV1(
        leftHandle,
        rightHandle,
      );
      if (Result.isFailure(comparison)) {
        state.terminal = "failed";
        return Result.fail(comparison.failure);
      }
      state.currentComparison = comparison.success;
    }
    const compared = stepDeclarativeV2VerifierRuntimeComparisonV1(
      state.currentComparison,
      1,
    );
    used += 1;
    if (Result.isFailure(compared)) {
      state.terminal = "failed";
      return Result.fail(compared.failure);
    }
    if (compared.success.status === "pending") continue;
    if (compared.success.order > 0) {
      const leftRecord = (state.inner - 1) * 16;
      const rightRecord = state.inner * 16;
      for (let byte = 0; byte < 16; byte += 4) {
        const left = state.records.getUint32(leftRecord + byte, false);
        state.records.setUint32(
          leftRecord + byte,
          state.records.getUint32(rightRecord + byte, false),
          false,
        );
        state.records.setUint32(rightRecord + byte, left, false);
      }
    }
    state.currentComparison = undefined;
    if (compared.success.order > 0 && state.inner > 1) {
      state.inner -= 1;
    } else {
      state.outer += 1;
      state.inner = state.outer;
    }
    if (state.outer >= state.count) {
      state.terminal = "complete";
      return Result.succeed(Object.freeze({
        status: "complete",
        count: state.count,
        receipt: receipt(state.arena, call.success.before),
      }));
    }
  }
  return Result.succeed(pending(state.arena, call.success.before));
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

function beginShaBlock(state: RuntimeSha256StateV1): void {
  state.scheduleCursor = 0;
  state.round = 0;
  state.working = new Uint32Array(8);
  for (let index = 0; index < 8; index += 1) {
    state.working[index] = state.hash[index]!;
  }
}

function stepShaBlock(state: RuntimeSha256StateV1): void {
  if (state.scheduleCursor < 16) {
    const offset = state.scheduleCursor * 4;
    state.schedule[state.scheduleCursor] = (
      (state.block[offset]! << 24) |
      (state.block[offset + 1]! << 16) |
      (state.block[offset + 2]! << 8) |
      state.block[offset + 3]!
    ) >>> 0;
    state.scheduleCursor += 1;
    return;
  }
  if (state.scheduleCursor < 64) {
    const index = state.scheduleCursor;
    const w15 = state.schedule[index - 15]!;
    const w2 = state.schedule[index - 2]!;
    const s0 = rotateRight(w15, 7) ^
      rotateRight(w15, 18) ^
      (w15 >>> 3);
    const s1 = rotateRight(w2, 17) ^
      rotateRight(w2, 19) ^
      (w2 >>> 10);
    state.schedule[index] = (
      state.schedule[index - 16]! +
      s0 +
      state.schedule[index - 7]! +
      s1
    ) >>> 0;
    state.scheduleCursor += 1;
    return;
  }
  if (state.working === undefined) {
    throw new Error("SHA-256 block is missing working state.");
  }
  if (state.round < 64) {
    const [a, b, c, d, e, f, g, h] = state.working;
    const sum1 = rotateRight(e!, 6) ^
      rotateRight(e!, 11) ^
      rotateRight(e!, 25);
    const choice = (e! & f!) ^ (~e! & g!);
    const temporary1 = (
      h! +
      sum1 +
      choice +
      SHA256_ROUND_CONSTANTS[state.round]! +
      state.schedule[state.round]!
    ) >>> 0;
    const sum0 = rotateRight(a!, 2) ^
      rotateRight(a!, 13) ^
      rotateRight(a!, 22);
    const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
    const temporary2 = (sum0 + majority) >>> 0;
    state.working[7] = g!;
    state.working[6] = f!;
    state.working[5] = e!;
    state.working[4] = (d! + temporary1) >>> 0;
    state.working[3] = c!;
    state.working[2] = b!;
    state.working[1] = a!;
    state.working[0] = (temporary1 + temporary2) >>> 0;
    state.round += 1;
    return;
  }
  for (let index = 0; index < 8; index += 1) {
    state.hash[index] = (state.hash[index]! + state.working[index]!) >>> 0;
  }
  state.block.fill(0);
  state.blockLength = 0;
  state.working = undefined;
}

export function createDeclarativeV2VerifierRuntimeSha256V1(
  rawArena: unknown,
): Result.Result<
  DeclarativeV2VerifierRuntimeSha256V1,
  DeclarativeV2VerifierRuntimeArenaV1Error
> {
  const arena = arenaState(rawArena, "createHash");
  if (Result.isFailure(arena)) return Result.fail(arena.failure);
  const handle = makeHandle<DeclarativeV2VerifierRuntimeSha256V1>(
    "DeclarativeV2VerifierRuntimeSha256V1",
  );
  OWNED_HASHES.set(handle, {
    arena: arena.success,
    hash: new Uint32Array(SHA256_INITIAL),
    block: new Uint8Array(SHA256_BLOCK_BYTES),
    schedule: new Uint32Array(SHA256_BLOCK_BYTES),
    blockLength: 0,
    totalBytes: 0n,
    round: 0,
    scheduleCursor: 0,
    working: undefined,
    pendingFinalize: false,
    finalBlockSubmitted: false,
    lengthCursor: 0,
    terminal: "open",
  });
  return Result.succeed(handle);
}

export function stepDeclarativeV2VerifierRuntimeSha256V1(
  rawHash: unknown,
  rawBytes: unknown,
  rawAllowance: unknown,
): RuntimeStepV1<DeclarativeV2VerifierRuntimeHashCompleteV1> {
  const state = rawHash !== null && typeof rawHash === "object"
    ? OWNED_HASHES.get(rawHash)
    : undefined;
  if (state === undefined || state.arena.revoked) {
    return Result.fail(arenaError("hash", "staleHandle"));
  }
  if (state.terminal !== "open") {
    return Result.fail(arenaError("hash", "closed"));
  }
  let visible: Uint8Array;
  try {
    if (!isUint8Array(rawBytes) || TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) {
      state.terminal = "failed";
      return Result.fail(arenaError("hash", "invalidInput"));
    }
    const byteLength = Reflect.apply(
      TYPED_ARRAY_BYTE_LENGTH_GETTER,
      rawBytes,
      [],
    ) as number;
    visible = Reflect.apply(
      UINT8_ARRAY_SUBARRAY,
      rawBytes,
      [0, byteLength],
    ) as Uint8Array;
  } catch {
    state.terminal = "failed";
    return Result.fail(arenaError("hash", "invalidInput"));
  }
  const call = beginCall(state.arena, "hash", rawAllowance);
  if (Result.isFailure(call)) {
    state.terminal = "failed";
    return Result.fail(call.failure);
  }
  let consumed = 0;
  let used = 0;
  while (
    consumed < visible.byteLength &&
    used < call.success.allowance
  ) {
    if (state.working !== undefined) {
      stepShaBlock(state);
    } else {
      const failure = charge(state.arena, "hash", "hashBytes", 1n);
      if (failure !== undefined) {
        state.terminal = "failed";
        return Result.fail(failure);
      }
      state.block[state.blockLength] = visible[consumed]!;
      state.blockLength += 1;
      state.totalBytes += 1n;
      state.arena.usage.consumedBytes += 1n;
      consumed += 1;
      if (state.blockLength === SHA256_BLOCK_BYTES) beginShaBlock(state);
    }
    used += 1;
    transition(state.arena);
  }
  return Result.succeed(pending(state.arena, call.success.before));
}

function hashDigest(state: RuntimeSha256StateV1): Uint8Array {
  const digest = new Uint8Array(SHA256_DIGEST_BYTES);
  for (let index = 0; index < 8; index += 1) {
    const word = state.hash[index]!;
    const offset = index * 4;
    digest[offset] = word >>> 24;
    digest[offset + 1] = word >>> 16;
    digest[offset + 2] = word >>> 8;
    digest[offset + 3] = word;
  }
  return digest;
}

export function finishDeclarativeV2VerifierRuntimeSha256V1(
  rawHash: unknown,
  rawAllowance: unknown,
): RuntimeStepV1<DeclarativeV2VerifierRuntimeHashCompleteV1> {
  const state = rawHash !== null && typeof rawHash === "object"
    ? OWNED_HASHES.get(rawHash)
    : undefined;
  if (state === undefined || state.arena.revoked) {
    return Result.fail(arenaError("finishHash", "staleHandle"));
  }
  if (state.terminal === "complete" || state.terminal === "failed") {
    return Result.fail(arenaError("finishHash", "closed"));
  }
  const call = beginCall(state.arena, "finishHash", rawAllowance);
  if (Result.isFailure(call)) {
    state.terminal = "failed";
    return Result.fail(call.failure);
  }
  let used = 0;
  state.terminal = "finishing";
  while (used < call.success.allowance) {
    if (state.working !== undefined) {
      stepShaBlock(state);
      used += 1;
      transition(state.arena);
      if (
        state.working === undefined &&
        state.finalBlockSubmitted
      ) {
        state.terminal = "complete";
        return Result.succeed(Object.freeze({
          status: "complete",
          digest: hashDigest(state),
          receipt: receipt(state.arena, call.success.before),
        }));
      }
      continue;
    }
    if (!state.pendingFinalize) {
      state.block[state.blockLength] = 0x80;
      state.blockLength += 1;
      state.pendingFinalize = true;
      used += 1;
      transition(state.arena);
      if (state.blockLength === SHA256_BLOCK_BYTES) beginShaBlock(state);
      continue;
    }
    if (
      state.lengthCursor === 0 &&
      state.blockLength >
        SHA256_BLOCK_BYTES - SHA256_LENGTH_BYTES
    ) {
      state.block[state.blockLength] = 0;
      state.blockLength += 1;
      used += 1;
      transition(state.arena);
      if (state.blockLength === SHA256_BLOCK_BYTES) beginShaBlock(state);
      continue;
    }
    if (
      state.lengthCursor === 0 &&
      state.blockLength <
        SHA256_BLOCK_BYTES - SHA256_LENGTH_BYTES
    ) {
      state.block[state.blockLength] = 0;
      state.blockLength += 1;
      used += 1;
      transition(state.arena);
      continue;
    }
    if (state.lengthCursor < SHA256_LENGTH_BYTES) {
      const bitLength = state.totalBytes * 8n;
      const shift = BigInt((SHA256_LENGTH_BYTES - 1 - state.lengthCursor) * 8);
      state.block[state.blockLength] =
        Number((bitLength >> shift) & 0xffn);
      state.blockLength += 1;
      state.lengthCursor += 1;
      used += 1;
      transition(state.arena);
      if (state.blockLength === SHA256_BLOCK_BYTES) {
        state.finalBlockSubmitted = true;
        beginShaBlock(state);
      }
      continue;
    }
    if (state.blockLength === SHA256_BLOCK_BYTES) {
      state.finalBlockSubmitted = true;
      beginShaBlock(state);
      continue;
    }
    if (state.blockLength === 0) {
      state.terminal = "complete";
      return Result.succeed(Object.freeze({
        status: "complete",
        digest: hashDigest(state),
        receipt: receipt(state.arena, call.success.before),
      }));
    }
    throw new Error(
      `SHA-256 final block has an invalid length ${state.blockLength}/${state.lengthCursor}.`,
    );
  }
  return Result.succeed(pending(state.arena, call.success.before));
}

export function createDeclarativeV2VerifierRuntimeCursorV1(
  rawText: unknown,
): Result.Result<
  DeclarativeV2VerifierRuntimeCursorV1,
  DeclarativeV2VerifierRuntimeArenaV1Error
> {
  const text = textState(rawText, "createCursor");
  if (Result.isFailure(text)) return Result.fail(text.failure);
  const handle = makeHandle<DeclarativeV2VerifierRuntimeCursorV1>(
    "DeclarativeV2VerifierRuntimeCursorV1",
  );
  OWNED_CURSORS.set(handle, {
    arena: text.success.arena,
    text: text.success,
    offset: 0,
    terminal: "open",
  });
  return Result.succeed(handle);
}

export function stepDeclarativeV2VerifierRuntimeCursorV1(
  rawCursor: unknown,
  rawAllowance: unknown,
): RuntimeStepV1<DeclarativeV2VerifierRuntimeCursorCompleteV1> {
  const state = rawCursor !== null && typeof rawCursor === "object"
    ? OWNED_CURSORS.get(rawCursor)
    : undefined;
  if (state === undefined || state.arena.revoked) {
    return Result.fail(arenaError("readCursor", "staleHandle"));
  }
  if (state.terminal !== "open") {
    return Result.fail(arenaError("readCursor", "closed"));
  }
  const call = beginCall(state.arena, "readCursor", rawAllowance);
  if (Result.isFailure(call)) {
    state.terminal = "failed";
    return Result.fail(call.failure);
  }
  if (call.success.allowance === 0) {
    return Result.succeed(pending(state.arena, call.success.before));
  }
  const byteOffset = state.offset;
  const byte = byteOffset < state.text.byteLength
    ? state.arena.bytes[state.text.offset + byteOffset]!
    : null;
  if (byte === null) state.terminal = "complete";
  else state.offset += 1;
  transition(state.arena);
  return Result.succeed(Object.freeze({
    status: "complete",
    byte,
    byteOffset,
    receipt: receipt(state.arena, call.success.before),
  }));
}

export function revokeDeclarativeV2VerifierRuntimeArenaV1(
  rawArena: unknown,
): Result.Result<void, DeclarativeV2VerifierRuntimeArenaV1Error> {
  const state = rawArena !== null && typeof rawArena === "object"
    ? OWNED_ARENAS.get(rawArena)
    : undefined;
  if (state === undefined || state.revoked) {
    return Result.fail(arenaError("revoke", "staleHandle"));
  }
  state.revoked = true;
  state.bytes.fill(0);
  return Result.succeed(undefined);
}

export const DECLARATIVE_V2_VERIFIER_RUNTIME_ARENA_V1_TEST_ONLY =
  Object.freeze({
    copyText(
      rawText: unknown,
      maximumIterations: number,
    ): Result.Result<Uint8Array, DeclarativeV2VerifierRuntimeArenaV1Error> {
      const text = textState(rawText, "createCursor");
      if (Result.isFailure(text)) return Result.fail(text.failure);
      if (
        !Number.isSafeInteger(maximumIterations) ||
        maximumIterations < text.success.byteLength + 1
      ) {
        return Result.fail(arenaError("readCursor", "invalidInput"));
      }
      const output = new Uint8Array(text.success.byteLength);
      for (let index = 0; index < output.byteLength; index += 1) {
        output[index] =
          text.success.arena.bytes[text.success.offset + index]!;
      }
      return Result.succeed(output);
    },
    orderedIndexes(
      rawOrder: unknown,
      maximumIterations: number,
    ): Result.Result<Uint32Array, DeclarativeV2VerifierRuntimeArenaV1Error> {
      const state = rawOrder !== null && typeof rawOrder === "object"
        ? OWNED_ORDERS.get(rawOrder)
        : undefined;
      if (
        state === undefined ||
        state.terminal !== "complete" ||
        !Number.isSafeInteger(maximumIterations) ||
        maximumIterations < state.count
      ) {
        return Result.fail(arenaError("order", "invalidInput"));
      }
      const output = new Uint32Array(state.count);
      for (let index = 0; index < output.length; index += 1) {
        output[index] = state.records.getUint32(index * 16 + 8, false);
      }
      return Result.succeed(output);
    },
  });
