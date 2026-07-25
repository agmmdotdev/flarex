import { isUint8Array } from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { Result } from "effect";
import type { Json } from "flarex-protocol/json";

const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  Uint8Array.prototype,
);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const UINT8_ARRAY_SUBARRAY = Uint8Array.prototype.subarray;
const MAX_RELEVANT_JSON_EXPONENT = 0xffff_ffff + 400;
const MAX_CANONICAL_NUMBER_BYTES = 32;
const OUTPUT_CHUNK_BYTES = 4_096;
const MAXIMUM_TRANSITIONS_PER_CALL = 1_024;
// This fixed scratch covers every binary64 decimal rounding boundary,
// including the longest subnormal cases. A sticky digit records a non-zero
// suffix beyond the retained prefix.
const MAX_NUMBER_CONVERSION_DIGITS = 768;

export interface IncrementalCanonicalJsonLimitsV1 {
  readonly maximumInputBytes: number;
  readonly maximumCanonicalBytes: number;
  readonly maximumStringBytes: number;
  readonly maximumMembers: number;
  readonly maximumDepth: number;
}

const OWNED_LIMITS = new WeakMap<
  object,
  IncrementalCanonicalJsonLimitsV1
>();

export interface IncrementalCanonicalJsonUsageV1 {
  readonly inputBytes: number;
  readonly canonicalBytes: number;
  readonly stringBytes: number;
  readonly members: number;
  readonly depth: number;
  readonly transitions: number;
}

export interface IncrementalCanonicalJsonReceiptV1 {
  readonly delta: IncrementalCanonicalJsonUsageV1;
  readonly aggregate: IncrementalCanonicalJsonUsageV1;
}

export type IncrementalCanonicalJsonIssueReasonV1 =
  | "invalidInput"
  | "invalidBudget"
  | "budgetExceeded"
  | "invalidUtf8"
  | "malformed"
  | "closed";

export interface IncrementalCanonicalJsonIssueV1 {
  readonly reason: IncrementalCanonicalJsonIssueReasonV1;
  readonly dimension?:
    | "inputBytes"
    | "canonicalBytes"
    | "stringBytes"
    | "members"
    | "depth"
    | "transitions";
  readonly observed?: number;
  readonly maximum?: number;
}

export interface IncrementalCanonicalJsonPendingV1 {
  readonly status: "pending";
  readonly consumedInputBytes: number;
  readonly receipt: IncrementalCanonicalJsonReceiptV1;
}

export interface IncrementalCanonicalJsonDecodedV1 {
  readonly status: "complete";
  readonly consumedInputBytes: number;
  readonly canonical: boolean;
  readonly jsonMembership: boolean;
  readonly wellFormedUnicode: boolean;
  readonly rootObjectMemberCount?: number;
  readonly receipt: IncrementalCanonicalJsonReceiptV1;
}

export type IncrementalCanonicalJsonDecodeStepV1 =
  | IncrementalCanonicalJsonPendingV1
  | IncrementalCanonicalJsonDecodedV1;

export interface IncrementalCanonicalJsonDecoderV1 {
  readonly step: (
    input: unknown,
    maximumTransitions: unknown,
  ) => Result.Result<
    IncrementalCanonicalJsonDecodeStepV1,
    IncrementalCanonicalJsonIssueV1
  >;
  readonly finish: (
    maximumTransitions: unknown,
  ) => Result.Result<
    IncrementalCanonicalJsonDecodeStepV1,
    IncrementalCanonicalJsonIssueV1
  >;
}

export interface IncrementalCanonicalJsonEncodedV1 {
  readonly status: "complete";
  readonly bytes: Uint8Array;
  readonly receipt: IncrementalCanonicalJsonReceiptV1;
}

export type IncrementalCanonicalJsonEncodeStepV1 =
  | Omit<IncrementalCanonicalJsonPendingV1, "consumedInputBytes">
  | IncrementalCanonicalJsonEncodedV1;

export interface IncrementalCanonicalJsonEncoderV1 {
  readonly step: (
    maximumTransitions: unknown,
  ) => Result.Result<
    IncrementalCanonicalJsonEncodeStepV1,
    IncrementalCanonicalJsonIssueV1
  >;
  readonly finish: (
    maximumTransitions: unknown,
  ) => Result.Result<
    IncrementalCanonicalJsonEncodeStepV1,
    IncrementalCanonicalJsonIssueV1
  >;
}

export interface IncrementalCanonicalJsonByteSinkV1 {
  readonly _tag: "IncrementalCanonicalJsonByteSinkV1";
}

export interface IncrementalCanonicalJsonByteSinkEncodedV1 {
  readonly status: "complete";
  readonly canonicalByteLength: number;
  readonly receipt: IncrementalCanonicalJsonReceiptV1;
}

export type IncrementalCanonicalJsonByteSinkEncodeStepV1 =
  | Omit<IncrementalCanonicalJsonPendingV1, "consumedInputBytes">
  | IncrementalCanonicalJsonByteSinkEncodedV1;

export interface IncrementalCanonicalJsonByteSinkEncoderV1 {
  readonly step: (
    maximumTransitions: unknown,
  ) => Result.Result<
    IncrementalCanonicalJsonByteSinkEncodeStepV1,
    IncrementalCanonicalJsonIssueV1
  >;
  readonly finish: (
    maximumTransitions: unknown,
  ) => Result.Result<
    IncrementalCanonicalJsonByteSinkEncodeStepV1,
    IncrementalCanonicalJsonIssueV1
  >;
}

export type IncrementalCanonicalJsonEventV1 =
  | { readonly kind: "null" }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "number"; readonly value: number }
  | {
      readonly kind: "stringStart";
      readonly role: "key" | "value";
    }
  | {
      readonly kind: "stringScalar";
      readonly role: "key" | "value";
      readonly value: string;
      readonly codePoint: number;
    }
  | {
      readonly kind: "stringEnd";
      readonly role: "key" | "value";
    }
  | { readonly kind: "arrayStart" }
  | { readonly kind: "arrayEnd" }
  | { readonly kind: "objectStart" }
  | { readonly kind: "objectEnd" }
  | { readonly kind: "end" };

export type IncrementalCanonicalJsonSinkEventV1 =
  | Exclude<IncrementalCanonicalJsonEventV1, { readonly kind: "end" }>
  | {
      readonly kind: "memberFinalize";
      readonly container: "array" | "object";
      readonly key: string;
    }
  | { readonly kind: "arrayLengthFinalize" }
  | {
      readonly kind: "containerSeal";
      readonly container: "array" | "object";
    };

export interface IncrementalCanonicalJsonEventSourceV1 {
  readonly _tag: "IncrementalCanonicalJsonEventSourceV1";
}

export interface IncrementalCanonicalJsonEventSinkV1 {
  readonly _tag: "IncrementalCanonicalJsonEventSinkV1";
}

type EventSourcePullV1 = () => IncrementalCanonicalJsonEventV1;
type EventSinkPushV1 = (event: IncrementalCanonicalJsonSinkEventV1) => void;
type ByteSinkPushV1 = (byte: number, offset: number) => void;

const OWNED_EVENT_SOURCES = new WeakMap<object, EventSourcePullV1>();
const OWNED_EVENT_SINKS = new WeakMap<object, EventSinkPushV1>();
const OWNED_BYTE_SINKS = new WeakMap<object, ByteSinkPushV1>();

export function makeIncrementalCanonicalJsonEventSourceV1(
  pull: EventSourcePullV1,
): IncrementalCanonicalJsonEventSourceV1 {
  const source = Object.freeze({
    _tag: "IncrementalCanonicalJsonEventSourceV1",
  } as const);
  OWNED_EVENT_SOURCES.set(source, pull);
  return source;
}

export function makeIncrementalCanonicalJsonEventSinkV1(
  push: EventSinkPushV1,
): IncrementalCanonicalJsonEventSinkV1 {
  const sink = Object.freeze({
    _tag: "IncrementalCanonicalJsonEventSinkV1",
  } as const);
  OWNED_EVENT_SINKS.set(sink, push);
  return sink;
}

export function makeIncrementalCanonicalJsonByteSinkV1(
  push: ByteSinkPushV1,
): IncrementalCanonicalJsonByteSinkV1 {
  const sink = Object.freeze({
    _tag: "IncrementalCanonicalJsonByteSinkV1",
  } as const);
  OWNED_BYTE_SINKS.set(sink, push);
  return sink;
}

type MutableUsage = {
  inputBytes: number;
  canonicalBytes: number;
  stringBytes: number;
  members: number;
  depth: number;
  transitions: number;
};

type ArrayFrame = {
  readonly kind: "array";
  readonly value: Array<Json>;
  state: "firstValueOrEnd" | "value" | "commaOrEnd";
};

type ObjectFrame = {
  readonly kind: "object";
  readonly value: Record<string, Json>;
  state: "firstKeyOrEnd" | "key" | "colon" | "value" | "commaOrEnd";
  currentKey: string | undefined;
  lastKey: string | undefined;
  uniqueMembers: number;
  readonly keys: Array<string>;
};

type DecoderFrame = ArrayFrame | ObjectFrame;

type ContainerFinalization = {
  readonly frame: DecoderFrame;
  index: number;
  phase: "properties" | "arrayLength" | "preventExtensions" | "end" | "pop";
};

type NumberState =
  | "sign"
  | "zero"
  | "integer"
  | "dot"
  | "fraction"
  | "exponentMark"
  | "exponentSign"
  | "exponent";

type StringState =
  | { readonly kind: "body" }
  | { readonly kind: "escape" }
  | {
      readonly kind: "unicode";
      digits: number;
      codeUnit: number;
      canonicalDigits: boolean;
    }
  | {
      readonly kind: "resolvedUnicode";
      readonly codeUnit: number;
      readonly canonicalDigits: boolean;
    };

type DecoderMode =
  | { readonly kind: "normal" }
  | {
      readonly kind: "string";
      readonly target: "key" | "value";
      state: StringState;
      text: string;
      pendingHighSurrogate: number | undefined;
    }
  | {
      readonly kind: "number";
      state: NumberState;
      text: string;
      length: number;
      negative: boolean;
      integerDigits: number;
      fractionDigits: number;
      exponentNegative: boolean;
      exponentValue: number;
      firstSignificantDigits: string;
      significantDigits: number;
      omittedNonZero: boolean;
    }
  | {
      readonly kind: "literal";
      readonly expected: "true" | "false" | "null";
      index: number;
    };

type PendingScalar = {
  readonly text: string;
  readonly codePoint: number;
  readonly byteLength: number;
};

type KeyComparison = {
  readonly left: string;
  readonly right: string;
  index: number;
  decided: boolean;
};

function issue(
  reason: IncrementalCanonicalJsonIssueReasonV1,
  evidence?: Readonly<{
    readonly dimension?: IncrementalCanonicalJsonIssueV1["dimension"];
    readonly observed?: number;
    readonly maximum?: number;
  }>,
): IncrementalCanonicalJsonIssueV1 {
  return Object.freeze({
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

function captureLimits(
  value: unknown,
): IncrementalCanonicalJsonLimitsV1 | undefined {
  return value !== null && typeof value === "object"
    ? OWNED_LIMITS.get(value)
    : undefined;
}

export function makeIncrementalCanonicalJsonLimitsV1(
  maximumInputBytes: unknown,
  maximumCanonicalBytes: unknown,
  maximumStringBytes: unknown,
  maximumMembers: unknown,
  maximumDepth: unknown,
): Result.Result<
  IncrementalCanonicalJsonLimitsV1,
  IncrementalCanonicalJsonIssueV1
> {
  if (
    !isNonNegativeSafeInteger(maximumInputBytes) ||
    !isNonNegativeSafeInteger(maximumCanonicalBytes) ||
    !isNonNegativeSafeInteger(maximumStringBytes) ||
    !isNonNegativeSafeInteger(maximumMembers) ||
    !isNonNegativeSafeInteger(maximumDepth)
  ) {
    return Result.fail(issue("invalidBudget"));
  }
  const captured = Object.freeze({
    maximumInputBytes,
    maximumCanonicalBytes,
    maximumStringBytes,
    maximumMembers,
    maximumDepth,
  } satisfies IncrementalCanonicalJsonLimitsV1);
  OWNED_LIMITS.set(captured, captured);
  return Result.succeed(captured);
}

function captureAllowance(value: unknown): number | undefined {
  return isNonNegativeSafeInteger(value) &&
      value <= MAXIMUM_TRANSITIONS_PER_CALL
    ? value
    : undefined;
}

function intrinsicByteLength(value: Uint8Array): number | undefined {
  if (TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) return undefined;
  try {
    const observed = Reflect.apply(
      TYPED_ARRAY_BYTE_LENGTH_GETTER,
      value,
      [],
    ) as unknown;
    return typeof observed === "number" ? observed : undefined;
  } catch {
    return undefined;
  }
}

function intrinsicVisibleBytes(
  value: Uint8Array,
  visibleLength: number,
): Uint8Array | undefined {
  try {
    return Reflect.apply(
      UINT8_ARRAY_SUBARRAY,
      value,
      [0, visibleLength],
    ) as Uint8Array;
  } catch {
    return undefined;
  }
}

function frozenUsage(value: MutableUsage): IncrementalCanonicalJsonUsageV1 {
  return Object.freeze({
    inputBytes: value.inputBytes,
    canonicalBytes: value.canonicalBytes,
    stringBytes: value.stringBytes,
    members: value.members,
    depth: value.depth,
    transitions: value.transitions,
  });
}

function subtractUsage(
  after: MutableUsage,
  before: IncrementalCanonicalJsonUsageV1,
): IncrementalCanonicalJsonUsageV1 {
  return Object.freeze({
    inputBytes: after.inputBytes - before.inputBytes,
    canonicalBytes: after.canonicalBytes - before.canonicalBytes,
    stringBytes: after.stringBytes - before.stringBytes,
    members: after.members - before.members,
    depth: Math.max(0, after.depth - before.depth),
    transitions: after.transitions - before.transitions,
  });
}

function receipt(
  value: MutableUsage,
  before: IncrementalCanonicalJsonUsageV1,
): IncrementalCanonicalJsonReceiptV1 {
  return Object.freeze({
    delta: subtractUsage(value, before),
    aggregate: frozenUsage(value),
  });
}

function isJsonWhitespace(value: string): boolean {
  return value === " " || value === "\t" || value === "\n" || value === "\r";
}

function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

function isHex(value: string): boolean {
  return (value >= "0" && value <= "9") ||
    (value >= "a" && value <= "f") ||
    (value >= "A" && value <= "F");
}

function hexValue(value: string): number {
  if (value >= "0" && value <= "9") return value.charCodeAt(0) - 0x30;
  if (value >= "a" && value <= "f") return value.charCodeAt(0) - 0x61 + 10;
  return value.charCodeAt(0) - 0x41 + 10;
}

function utf8Length(value: number): number {
  if (value <= 0x7f) return 1;
  if (value <= 0x7ff) return 2;
  if (value <= 0xffff) return 3;
  return 4;
}

function canonicalStringLength(value: number): number {
  if (value === 0x22 || value === 0x5c) return 2;
  if (
    value === 0x08 ||
    value === 0x09 ||
    value === 0x0a ||
    value === 0x0c ||
    value === 0x0d
  ) {
    return 2;
  }
  if (value <= 0x1f) return 6;
  if (value >= 0xd800 && value <= 0xdfff) return 6;
  return utf8Length(value);
}

function compareCodeUnits(left: string, right: string, index: number): number {
  if (index >= left.length || index >= right.length) {
    return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
  }
  const leftCode = left.charCodeAt(index);
  const rightCode = right.charCodeAt(index);
  return leftCode === rightCode ? 0 : leftCode < rightCode ? -1 : 1;
}

function numberStateAccepting(state: NumberState): boolean {
  return state === "zero" ||
    state === "integer" ||
    state === "fraction" ||
    state === "exponent";
}

function numberMayConsume(value: string): boolean {
  return isDigit(value) ||
    value === "-" ||
    value === "+" ||
    value === "." ||
    value === "e" ||
    value === "E";
}

function recordSignificantDigit(
  mode: Extract<DecoderMode, { readonly kind: "number" }>,
  value: string,
): void {
  if (
    mode.firstSignificantDigits.length < MAX_NUMBER_CONVERSION_DIGITS
  ) {
    mode.firstSignificantDigits += value;
  } else if (value !== "0") {
    mode.omittedNonZero = true;
  }
  mode.significantDigits += 1;
}

function advanceNumberState(
  mode: Extract<DecoderMode, { readonly kind: "number" }>,
  value: string,
): boolean {
  switch (mode.state) {
    case "sign":
      if (value === "0") {
        mode.state = "zero";
        mode.integerDigits += 1;
        return true;
      }
      if (value >= "1" && value <= "9") {
        mode.state = "integer";
        mode.integerDigits += 1;
        if (value !== "0") {
          recordSignificantDigit(mode, value);
        }
        return true;
      }
      return false;
    case "zero":
      if (value === ".") {
        mode.state = "dot";
        return true;
      }
      if (value === "e" || value === "E") {
        mode.state = "exponentMark";
        return true;
      }
      return false;
    case "integer":
      if (isDigit(value)) {
        mode.integerDigits += 1;
        recordSignificantDigit(mode, value);
        return true;
      }
      if (value === ".") {
        mode.state = "dot";
        return true;
      }
      if (value === "e" || value === "E") {
        mode.state = "exponentMark";
        return true;
      }
      return false;
    case "dot":
      if (!isDigit(value)) return false;
      mode.state = "fraction";
      mode.fractionDigits += 1;
      if (mode.firstSignificantDigits.length > 0 || value !== "0") {
        recordSignificantDigit(mode, value);
      }
      return true;
    case "fraction":
      if (isDigit(value)) {
        mode.fractionDigits += 1;
        if (mode.firstSignificantDigits.length > 0 || value !== "0") {
          recordSignificantDigit(mode, value);
        }
        return true;
      }
      if (value === "e" || value === "E") {
        mode.state = "exponentMark";
        return true;
      }
      return false;
    case "exponentMark":
      if (value === "+" || value === "-") {
        mode.state = "exponentSign";
        mode.exponentNegative = value === "-";
        return true;
      }
      if (isDigit(value)) {
        mode.state = "exponent";
        mode.exponentValue = Number(value);
        return true;
      }
      return false;
    case "exponentSign":
      if (!isDigit(value)) return false;
      mode.state = "exponent";
      mode.exponentValue = Number(value);
      return true;
    case "exponent":
      if (!isDigit(value)) return false;
      mode.exponentValue = Math.min(
        MAX_RELEVANT_JSON_EXPONENT,
        mode.exponentValue * 10 + Number(value),
      );
      return true;
  }
}

export function createIncrementalCanonicalJsonDecoderV1(
  rawLimits: unknown,
  rawSink: unknown,
): Result.Result<
  IncrementalCanonicalJsonDecoderV1,
  IncrementalCanonicalJsonIssueV1
> {
  const limits = captureLimits(rawLimits);
  const sink = rawSink !== null && typeof rawSink === "object"
    ? OWNED_EVENT_SINKS.get(rawSink)
    : undefined;
  if (
    limits === undefined ||
    limits.maximumInputBytes > 0xffff_ffff ||
    limits.maximumCanonicalBytes > 0xffff_ffff ||
    limits.maximumStringBytes > 0xffff_ffff ||
    limits.maximumMembers > 0xffff_ffff ||
    limits.maximumDepth > 0xffff_ffff
  ) {
    return Result.fail(issue("invalidBudget"));
  }
  if (sink === undefined) return Result.fail(issue("invalidInput"));

  const frames: Array<DecoderFrame | undefined> = [];

  const usage: MutableUsage = {
    inputBytes: 0,
    canonicalBytes: 0,
    stringBytes: 0,
    members: 0,
    depth: 0,
    transitions: 0,
  };
  let frameCount = 0;
  let rootStarted = false;
  let rootComplete = false;
  let rootValue: Json = null;
  let rootObjectMemberCount: number | undefined;
  let mode: DecoderMode = { kind: "normal" };
  let pendingScalar: PendingScalar | undefined;
  let pendingSinkEvent: IncrementalCanonicalJsonSinkEventV1 | undefined;
  let pendingCanonicalBytes = 0;
  let pendingValue: Json | undefined;
  let hasPendingValue = false;
  let pendingContainer: "array" | "object" | undefined;
  let containerFinalization: ContainerFinalization | undefined;
  let keyComparison: KeyComparison | undefined;
  let pendingKeyFrame: ObjectFrame | undefined;
  let pendingKey: string | undefined;
  let canonical = true;
  let jsonMembership = true;
  let wellFormedUnicode = true;
  let finishRequested = false;
  let completed = false;
  let terminalIssue: IncrementalCanonicalJsonIssueV1 | undefined;
  let utf8Expected = 0;
  let utf8CodePoint = 0;
  let utf8Minimum = 0;
  let utf8SecondMinimum = 0x80;
  let utf8SecondMaximum = 0xbf;
  let utf8Seen = 0;
  let utf8ByteLength = 0;

  const fail = (
    value: IncrementalCanonicalJsonIssueV1,
  ): Result.Result<never, IncrementalCanonicalJsonIssueV1> => {
    terminalIssue = value;
    return Result.fail(value);
  };

  const charge = (
    dimension: Exclude<
      IncrementalCanonicalJsonIssueV1["dimension"],
      undefined
    >,
    maximum: number,
    amount = 1,
  ): IncrementalCanonicalJsonIssueV1 | undefined => {
    const observed = dimension === "depth"
      ? frameCount + amount
      : usage[dimension] + amount;
    if (observed > maximum) {
      return issue("budgetExceeded", { dimension, observed, maximum });
    }
    if (dimension === "depth") {
      usage.depth = Math.max(usage.depth, observed);
    } else {
      usage[dimension] = observed;
    }
    return undefined;
  };

  const chargeCanonical = (
    amount: number,
  ): IncrementalCanonicalJsonIssueV1 | undefined => {
    if (amount === 0) return undefined;
    const observed = usage.canonicalBytes + amount;
    if (observed > limits.maximumCanonicalBytes) {
      return issue("budgetExceeded", {
        dimension: "canonicalBytes",
        observed,
        maximum: limits.maximumCanonicalBytes,
      });
    }
    pendingCanonicalBytes += amount;
    return undefined;
  };

  const activeFrame = (): DecoderFrame | undefined =>
    frameCount === 0 ? undefined : frames[frameCount - 1];

  const valueExpected = (): boolean => {
    if (frameCount === 0) return !rootStarted;
    const frame = activeFrame();
    return frame?.kind === "array"
      ? frame.state === "firstValueOrEnd" || frame.state === "value"
      : frame?.state === "value";
  };

  const keyExpected = (): boolean => {
    const frame = activeFrame();
    return frame?.kind === "object" &&
      (frame.state === "firstKeyOrEnd" || frame.state === "key");
  };

  const queueSinkEvent = (
    event: IncrementalCanonicalJsonSinkEventV1,
  ): void => {
    if (pendingSinkEvent !== undefined) {
      throw new Error("incremental canonical JSON sink event overlap");
    }
    pendingSinkEvent = Object.freeze(event);
  };

  const queueValue = (
    value: Json,
    event?: Exclude<
      IncrementalCanonicalJsonEventV1,
      { readonly kind: "end" }
    >,
  ): void => {
    pendingValue = value;
    hasPendingValue = true;
    if (event !== undefined) queueSinkEvent(event);
  };

  const attachPendingValue = (): IncrementalCanonicalJsonIssueV1 | undefined => {
    if (!hasPendingValue) return undefined;
    const value = pendingValue as Json;
    pendingValue = undefined;
    hasPendingValue = false;
    if (frameCount === 0) {
      if (rootStarted) return issue("malformed");
      rootStarted = true;
      rootComplete = true;
      rootValue = value;
      return undefined;
    }
    const frame = activeFrame();
    if (frame?.kind === "array") {
      if (
        frame.state !== "firstValueOrEnd" &&
        frame.state !== "value"
      ) {
        return issue("malformed");
      }
      const charged = charge("members", limits.maximumMembers);
      if (charged !== undefined) return charged;
      frame.value.push(value);
      frame.state = "commaOrEnd";
      return undefined;
    }
    if (frame?.kind === "object") {
      if (frame.state !== "value" || frame.currentKey === undefined) {
        return issue("malformed");
      }
      const charged = charge("members", limits.maximumMembers);
      if (charged !== undefined) return charged;
      const isNewMember = !Object.hasOwn(frame.value, frame.currentKey);
      Object.defineProperty(frame.value, frame.currentKey, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
      if (isNewMember) frame.uniqueMembers += 1;
      if (isNewMember) frame.keys.push(frame.currentKey);
      frame.currentKey = undefined;
      frame.state = "commaOrEnd";
      return undefined;
    }
    return issue("malformed");
  };

  const pushContainer = (
    kind: "array" | "object",
  ): IncrementalCanonicalJsonIssueV1 | undefined => {
    if (!valueExpected()) return issue("malformed");
    const depthFailure = charge("depth", limits.maximumDepth);
    if (depthFailure !== undefined) return depthFailure;
    if (kind === "array") {
      const value: Array<Json> = [];
      queueValue(value, { kind: "arrayStart" });
      const attached = attachPendingValue();
      if (attached !== undefined) return attached;
      frames[frameCount] = {
        kind,
        value,
        state: "firstValueOrEnd",
      };
    } else {
      const value: Record<string, Json> = {};
      queueValue(value, { kind: "objectStart" });
      const attached = attachPendingValue();
      if (attached !== undefined) return attached;
      frames[frameCount] = {
        kind,
        value,
        state: "firstKeyOrEnd",
        currentKey: undefined,
        lastKey: undefined,
        uniqueMembers: 0,
        keys: [],
      };
    }
    frameCount += 1;
    if (frameCount === 1) rootComplete = false;
    return undefined;
  };

  const closeContainer = (
    expected: "array" | "object",
  ): IncrementalCanonicalJsonIssueV1 | undefined => {
    const frame = activeFrame();
    if (frame?.kind !== expected) return issue("malformed");
    if (
      (frame.kind === "array" &&
        frame.state !== "firstValueOrEnd" &&
        frame.state !== "commaOrEnd") ||
      (frame.kind === "object" &&
        frame.state !== "firstKeyOrEnd" &&
        frame.state !== "commaOrEnd")
    ) {
      return issue("malformed");
    }
    containerFinalization = {
      frame,
      index: 0,
      phase: "properties",
    };
    return undefined;
  };

  const finalizeContainerTransition = ():
    | IncrementalCanonicalJsonIssueV1
    | undefined => {
    const finalization = containerFinalization;
    if (finalization === undefined) return undefined;
    const frame = finalization.frame;
    switch (finalization.phase) {
      case "properties": {
        const propertyCount = frame.kind === "array"
          ? frame.value.length
          : frame.keys.length;
        if (finalization.index >= propertyCount) {
          finalization.phase = frame.kind === "array"
            ? "arrayLength"
            : "preventExtensions";
          return undefined;
        }
        const key = frame.kind === "array"
          ? String(finalization.index)
          : frame.keys[finalization.index]!;
        const descriptor = Object.getOwnPropertyDescriptor(frame.value, key);
        if (descriptor === undefined || !("value" in descriptor)) {
          return issue("malformed");
        }
        Object.defineProperty(frame.value, key, {
          configurable: false,
          enumerable: true,
          value: descriptor.value,
          writable: false,
        });
        queueSinkEvent({
          kind: "memberFinalize",
          container: frame.kind,
          key,
        });
        finalization.index += 1;
        return undefined;
      }
      case "arrayLength":
        if (frame.kind !== "array") return issue("malformed");
        Object.defineProperty(frame.value, "length", { writable: false });
        queueSinkEvent({ kind: "arrayLengthFinalize" });
        finalization.phase = "preventExtensions";
        return undefined;
      case "preventExtensions":
        Object.preventExtensions(frame.value);
        queueSinkEvent({ kind: "containerSeal", container: frame.kind });
        finalization.phase = "end";
        return undefined;
      case "end":
        queueSinkEvent({
          kind: frame.kind === "array" ? "arrayEnd" : "objectEnd",
        });
        finalization.phase = "pop";
        return undefined;
      case "pop":
        if (activeFrame() !== frame) return issue("malformed");
        frames[frameCount - 1] = undefined;
        frameCount -= 1;
        if (frameCount === 0) {
          rootComplete = true;
          if (frame.kind === "object") {
            rootObjectMemberCount = frame.uniqueMembers;
          }
        }
        containerFinalization = undefined;
        return undefined;
    }
  };

  const completeString = (
    stringMode: Extract<DecoderMode, { readonly kind: "string" }>,
  ): IncrementalCanonicalJsonIssueV1 | undefined => {
    mode = { kind: "normal" };
    queueSinkEvent({ kind: "stringEnd", role: stringMode.target });
    if (stringMode.target === "value") {
      if (stringMode.pendingHighSurrogate !== undefined) {
        return issue("malformed");
      }
      queueValue(stringMode.text);
      return undefined;
    }
    if (stringMode.pendingHighSurrogate !== undefined) {
      return issue("malformed");
    }
    const frame = activeFrame();
    if (
      frame?.kind !== "object" ||
      (frame.state !== "firstKeyOrEnd" && frame.state !== "key")
    ) {
      return issue("malformed");
    }
    if (frame.lastKey === undefined) {
      frame.lastKey = stringMode.text;
      frame.currentKey = stringMode.text;
      frame.state = "colon";
      return undefined;
    }
    pendingKeyFrame = frame;
    pendingKey = stringMode.text;
    keyComparison = {
      left: frame.lastKey,
      right: stringMode.text,
      index: 0,
      decided: false,
    };
    return undefined;
  };

  const appendStringText = (
    stringMode: Extract<DecoderMode, { readonly kind: "string" }>,
    value: string,
    codePoint: number,
  ): IncrementalCanonicalJsonIssueV1 | undefined => {
    const amount = utf8Length(codePoint);
    const charged = charge(
      "stringBytes",
      limits.maximumStringBytes,
      amount,
    );
    if (charged !== undefined) return charged;
    stringMode.text += value;
    queueSinkEvent({
      kind: "stringScalar",
      role: stringMode.target,
      value,
      codePoint,
    });
    return undefined;
  };

  const finalizeNumber = (
    numberMode: Extract<DecoderMode, { readonly kind: "number" }>,
  ): IncrementalCanonicalJsonIssueV1 | undefined => {
    if (!numberStateAccepting(numberMode.state)) return issue("malformed");
    let value: number;
    let spelling: string;
    if (numberMode.length <= MAX_CANONICAL_NUMBER_BYTES) {
      value = Number(numberMode.text);
      spelling = Number.isFinite(value) ? JSON.stringify(value) : "null";
      if (!Number.isFinite(value)) {
        jsonMembership = false;
        value = 0;
      }
      if (numberMode.text !== spelling) canonical = false;
    } else {
      canonical = false;
      const explicitExponent = numberMode.exponentNegative
        ? -numberMode.exponentValue
        : numberMode.exponentValue;
      if (numberMode.significantDigits === 0) {
        value = numberMode.negative ? -0 : 0;
      } else {
        const sticky = numberMode.omittedNonZero ? "1" : "";
        const coefficient = `${numberMode.firstSignificantDigits}${sticky}`;
        const scale = explicitExponent - numberMode.fractionDigits +
          numberMode.significantDigits - coefficient.length;
        value = Number(
          `${numberMode.negative ? "-" : ""}${coefficient}e${scale}`,
        );
      }
      spelling = Number.isFinite(value) ? JSON.stringify(value) : "null";
      if (!Number.isFinite(value)) {
        jsonMembership = false;
        value = 0;
      }
    }
    const charged = chargeCanonical(spelling.length);
    if (charged !== undefined) return charged;
    mode = { kind: "normal" };
    queueValue(value, { kind: "number", value });
    return undefined;
  };

  const processKeyComparison = (): IncrementalCanonicalJsonIssueV1 | undefined => {
    if (
      keyComparison === undefined ||
      pendingKeyFrame === undefined ||
      pendingKey === undefined
    ) {
      return undefined;
    }
    const comparison = compareCodeUnits(
      keyComparison.left,
      keyComparison.right,
      keyComparison.index,
    );
    if (comparison === 0) {
      if (
        keyComparison.index < keyComparison.left.length &&
        keyComparison.index < keyComparison.right.length
      ) {
        keyComparison.index += 1;
        return undefined;
      }
      canonical = false;
      keyComparison.decided = true;
    } else {
      if (comparison >= 0) canonical = false;
      keyComparison.decided = true;
    }
    if (!keyComparison.decided) return undefined;
    pendingKeyFrame.lastKey = pendingKey;
    pendingKeyFrame.currentKey = pendingKey;
    pendingKeyFrame.state = "colon";
    keyComparison = undefined;
    pendingKeyFrame = undefined;
    pendingKey = undefined;
    return undefined;
  };

  const processNormalScalar = (
    scalar: PendingScalar,
  ): IncrementalCanonicalJsonIssueV1 | undefined => {
    const value = scalar.text;
    if (rootComplete && frameCount === 0) {
      if (isJsonWhitespace(value)) {
        canonical = false;
        return undefined;
      }
      return issue("malformed");
    }
    if (isJsonWhitespace(value)) {
      canonical = false;
      return undefined;
    }
    const frame = activeFrame();
    if (value === "{") {
      if (!valueExpected()) return issue("malformed");
      pendingContainer = "object";
      return chargeCanonical(1);
    }
    if (value === "[") {
      if (!valueExpected()) return issue("malformed");
      pendingContainer = "array";
      return chargeCanonical(1);
    }
    if (value === "}") {
      const closed = closeContainer("object");
      if (closed !== undefined) return closed;
      return chargeCanonical(1);
    }
    if (value === "]") {
      const closed = closeContainer("array");
      if (closed !== undefined) return closed;
      return chargeCanonical(1);
    }
    if (value === ",") {
      if (frame?.kind === "array" && frame.state === "commaOrEnd") {
        frame.state = "value";
      } else if (
        frame?.kind === "object" &&
        frame.state === "commaOrEnd"
      ) {
        frame.state = "key";
      } else {
        return issue("malformed");
      }
      return chargeCanonical(1);
    }
    if (value === ":") {
      if (frame?.kind !== "object" || frame.state !== "colon") {
        return issue("malformed");
      }
      frame.state = "value";
      return chargeCanonical(1);
    }
    if (value === "\"") {
      if (!valueExpected() && !keyExpected()) return issue("malformed");
      mode = {
        kind: "string",
        target: keyExpected() ? "key" : "value",
        state: { kind: "body" },
        text: "",
        pendingHighSurrogate: undefined,
      };
      queueSinkEvent({
        kind: "stringStart",
        role: keyExpected() ? "key" : "value",
      });
      return chargeCanonical(1);
    }
    if (!valueExpected()) return issue("malformed");
    if (value === "t" || value === "f" || value === "n") {
      mode = {
        kind: "literal",
        expected: value === "t" ? "true" : value === "f" ? "false" : "null",
        index: 1,
      };
      return chargeCanonical(1);
    }
    if (value === "-" || isDigit(value)) {
      const numberMode: Extract<DecoderMode, { readonly kind: "number" }> = {
        kind: "number",
        state: value === "-" ? "sign" : value === "0" ? "zero" : "integer",
        text: value,
        length: 1,
        negative: value === "-",
        integerDigits: isDigit(value) ? 1 : 0,
        fractionDigits: 0,
        exponentNegative: false,
        exponentValue: 0,
        firstSignificantDigits: value >= "1" && value <= "9" ? value : "",
        significantDigits: value >= "1" && value <= "9" ? 1 : 0,
        omittedNonZero: false,
      };
      mode = numberMode;
      return undefined;
    }
    return issue("malformed");
  };

  const processStringScalar = (
    stringMode: Extract<DecoderMode, { readonly kind: "string" }>,
    scalar: PendingScalar,
  ): IncrementalCanonicalJsonIssueV1 | undefined => {
    const value = scalar.text;
    switch (stringMode.state.kind) {
      case "body":
        if (value === "\"") {
          if (stringMode.pendingHighSurrogate !== undefined) {
            const high = stringMode.pendingHighSurrogate;
            stringMode.pendingHighSurrogate = undefined;
            wellFormedUnicode = false;
            pendingScalar = scalar;
            const appended = appendStringText(
              stringMode,
              String.fromCharCode(high),
              high,
            );
            if (appended !== undefined) return appended;
            return chargeCanonical(6);
          }
          const charged = chargeCanonical(1);
          if (charged !== undefined) return charged;
          return completeString(stringMode);
        }
        if (value === "\\") {
          stringMode.state = { kind: "escape" };
          return undefined;
        }
        if (scalar.codePoint <= 0x1f) return issue("malformed");
        if (stringMode.pendingHighSurrogate !== undefined) {
          const high = stringMode.pendingHighSurrogate;
          stringMode.pendingHighSurrogate = undefined;
          wellFormedUnicode = false;
          pendingScalar = scalar;
          const appended = appendStringText(
            stringMode,
            String.fromCharCode(high),
            high,
          );
          if (appended !== undefined) return appended;
          return chargeCanonical(6);
        }
        {
          const appended = appendStringText(
            stringMode,
            value,
            scalar.codePoint,
          );
          if (appended !== undefined) return appended;
          return chargeCanonical(canonicalStringLength(scalar.codePoint));
        }
      case "escape": {
        const decoded = value === "\""
          ? "\""
          : value === "\\"
          ? "\\"
          : value === "/"
          ? "/"
          : value === "b"
          ? "\b"
          : value === "f"
          ? "\f"
          : value === "n"
          ? "\n"
          : value === "r"
          ? "\r"
          : value === "t"
          ? "\t"
          : undefined;
        if (decoded !== undefined) {
          if (stringMode.pendingHighSurrogate !== undefined) {
            const high = stringMode.pendingHighSurrogate;
            stringMode.pendingHighSurrogate = undefined;
            wellFormedUnicode = false;
            pendingScalar = scalar;
            const appended = appendStringText(
              stringMode,
              String.fromCharCode(high),
              high,
            );
            if (appended !== undefined) return appended;
            return chargeCanonical(6);
          }
          if (value === "/") canonical = false;
          const codePoint = decoded.codePointAt(0)!;
          const appended = appendStringText(
            stringMode,
            decoded,
            codePoint,
          );
          if (appended !== undefined) return appended;
          stringMode.state = { kind: "body" };
          return chargeCanonical(canonicalStringLength(codePoint));
        }
        if (value !== "u") return issue("malformed");
        stringMode.state = {
          kind: "unicode",
          digits: 0,
          codeUnit: 0,
          canonicalDigits: true,
        };
        return undefined;
      }
      case "unicode": {
        if (value.length !== 1 || !isHex(value)) return issue("malformed");
        stringMode.state.codeUnit =
          stringMode.state.codeUnit * 16 + hexValue(value);
        stringMode.state.canonicalDigits &&=
          !(value >= "A" && value <= "F");
        stringMode.state.digits += 1;
        if (stringMode.state.digits < 4) return undefined;
        stringMode.state = {
          kind: "resolvedUnicode",
          codeUnit: stringMode.state.codeUnit,
          canonicalDigits: stringMode.state.canonicalDigits,
        };
        return undefined;
      }
      case "resolvedUnicode": {
        const codeUnit = stringMode.state.codeUnit;
        const canonicalDigits = stringMode.state.canonicalDigits;
        if (
          stringMode.pendingHighSurrogate !== undefined &&
          !(codeUnit >= 0xdc00 && codeUnit <= 0xdfff)
        ) {
          const high = stringMode.pendingHighSurrogate;
          stringMode.pendingHighSurrogate = undefined;
          wellFormedUnicode = false;
          const appended = appendStringText(
            stringMode,
            String.fromCharCode(high),
            high,
          );
          if (appended !== undefined) return appended;
          return chargeCanonical(6);
        }
        if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
          stringMode.pendingHighSurrogate = codeUnit;
          canonical = false;
          stringMode.state = { kind: "body" };
          return undefined;
        }
        if (
          codeUnit >= 0xdc00 &&
          codeUnit <= 0xdfff &&
          stringMode.pendingHighSurrogate !== undefined
        ) {
          const high = stringMode.pendingHighSurrogate;
          stringMode.pendingHighSurrogate = undefined;
          const codePoint = 0x10000 +
            ((high - 0xd800) << 10) +
            (codeUnit - 0xdc00);
          const appended = appendStringText(
            stringMode,
            String.fromCodePoint(codePoint),
            codePoint,
          );
          if (appended !== undefined) return appended;
          canonical = false;
          stringMode.state = { kind: "body" };
          return chargeCanonical(4);
        }
        const decoded = String.fromCharCode(codeUnit);
        if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
          wellFormedUnicode = false;
        }
        const appended = appendStringText(stringMode, decoded, codeUnit);
        if (appended !== undefined) return appended;
        const shortEscaped =
          codeUnit === 0x08 ||
          codeUnit === 0x09 ||
          codeUnit === 0x0a ||
          codeUnit === 0x0c ||
          codeUnit === 0x0d;
        if (
          codeUnit > 0x1f && !(codeUnit >= 0xd800 && codeUnit <= 0xdfff)
        ) {
          canonical = false;
        } else if (codeUnit >= 0xd800 && codeUnit <= 0xdfff) {
          canonical = false;
        } else if (shortEscaped || !canonicalDigits) {
          canonical = false;
        }
        stringMode.state = { kind: "body" };
        return chargeCanonical(canonicalStringLength(codeUnit));
      }
    }
  };

  const processScalar = (
    scalar: PendingScalar,
  ): IncrementalCanonicalJsonIssueV1 | undefined => {
    if (mode.kind === "normal") return processNormalScalar(scalar);
    if (mode.kind === "string") return processStringScalar(mode, scalar);
    if (mode.kind === "literal") {
      if (scalar.text !== mode.expected[mode.index]) return issue("malformed");
      mode.index += 1;
      const charged = chargeCanonical(1);
      if (charged !== undefined) return charged;
      if (mode.index === mode.expected.length) {
        const expected = mode.expected;
        mode = { kind: "normal" };
        queueValue(
          expected === "true" ? true : expected === "false" ? false : null,
          expected === "true"
            ? { kind: "boolean", value: true }
            : expected === "false"
            ? { kind: "boolean", value: false }
            : { kind: "null" },
        );
      }
      return undefined;
    }
    if (numberMayConsume(scalar.text)) {
      if (!advanceNumberState(mode, scalar.text)) return issue("malformed");
      mode.length += 1;
      if (mode.length <= MAX_CANONICAL_NUMBER_BYTES) {
        mode.text += scalar.text;
      }
      return undefined;
    }
    const finalized = finalizeNumber(mode);
    if (finalized !== undefined) return finalized;
    pendingScalar = scalar;
    return undefined;
  };

  const processUtf8Byte = (
    value: number,
  ): IncrementalCanonicalJsonIssueV1 | undefined => {
    if (utf8Expected === 0) {
      if (value <= 0x7f) {
        pendingScalar = {
          text: String.fromCharCode(value),
          codePoint: value,
          byteLength: 1,
        };
        return undefined;
      }
      if (value >= 0xc2 && value <= 0xdf) {
        utf8Expected = 1;
        utf8CodePoint = value & 0x1f;
        utf8Minimum = 0x80;
      } else if (value >= 0xe0 && value <= 0xef) {
        utf8Expected = 2;
        utf8CodePoint = value & 0x0f;
        utf8Minimum = 0x800;
        utf8SecondMinimum = value === 0xe0 ? 0xa0 : 0x80;
        utf8SecondMaximum = value === 0xed ? 0x9f : 0xbf;
      } else if (value >= 0xf0 && value <= 0xf4) {
        utf8Expected = 3;
        utf8CodePoint = value & 0x07;
        utf8Minimum = 0x10000;
        utf8SecondMinimum = value === 0xf0 ? 0x90 : 0x80;
        utf8SecondMaximum = value === 0xf4 ? 0x8f : 0xbf;
      } else {
        return issue("invalidUtf8");
      }
      utf8Seen = 0;
      utf8ByteLength = utf8Expected + 1;
      return undefined;
    }
    const minimum = utf8Seen === 0 ? utf8SecondMinimum : 0x80;
    const maximum = utf8Seen === 0 ? utf8SecondMaximum : 0xbf;
    if (value < minimum || value > maximum) return issue("invalidUtf8");
    utf8CodePoint = (utf8CodePoint << 6) | (value & 0x3f);
    utf8Expected -= 1;
    utf8Seen += 1;
    if (utf8Expected !== 0) return undefined;
    if (
      utf8CodePoint < utf8Minimum ||
      utf8CodePoint > 0x10ffff ||
      (utf8CodePoint >= 0xd800 && utf8CodePoint <= 0xdfff)
    ) {
      return issue("invalidUtf8");
    }
    pendingScalar = {
      text: String.fromCodePoint(utf8CodePoint),
      codePoint: utf8CodePoint,
      byteLength: utf8ByteLength,
    };
    utf8SecondMinimum = 0x80;
    utf8SecondMaximum = 0xbf;
    return undefined;
  };

  const transition = (
    input: Uint8Array | undefined,
    inputIndex: number,
  ): Readonly<{
    readonly inputIndex: number;
    readonly failure?: IncrementalCanonicalJsonIssueV1;
  }> => {
    usage.transitions += 1;
    if (pendingSinkEvent !== undefined) {
      const event = pendingSinkEvent;
      pendingSinkEvent = undefined;
      try {
        sink(event);
      } catch (defect) {
        terminalIssue = issue("closed");
        throw defect;
      }
      return { inputIndex };
    }
    if (pendingCanonicalBytes > 0) {
      usage.canonicalBytes += 1;
      pendingCanonicalBytes -= 1;
      return { inputIndex };
    }
    if (containerFinalization !== undefined) {
      const failure = finalizeContainerTransition();
      return {
        inputIndex,
        ...(failure === undefined ? {} : { failure }),
      };
    }
    if (keyComparison !== undefined) {
      return {
        inputIndex,
        ...(processKeyComparison() === undefined
          ? {}
          : { failure: issue("malformed") }),
      };
    }
    if (hasPendingValue) {
      const failure = attachPendingValue();
      return {
        inputIndex,
        ...(failure === undefined ? {} : { failure }),
      };
    }
    if (pendingContainer !== undefined) {
      const container = pendingContainer;
      pendingContainer = undefined;
      const failure = pushContainer(container);
      return {
        inputIndex,
        ...(failure === undefined ? {} : { failure }),
      };
    }
    if (
      mode.kind === "string" &&
      mode.state.kind === "resolvedUnicode"
    ) {
      const failure = processStringScalar(mode, {
        text: "",
        codePoint: 0,
        byteLength: 0,
      });
      return {
        inputIndex,
        ...(failure === undefined ? {} : { failure }),
      };
    }
    if (pendingScalar !== undefined) {
      const scalar = pendingScalar;
      pendingScalar = undefined;
      const failure = processScalar(scalar);
      return {
        inputIndex,
        ...(failure === undefined ? {} : { failure }),
      };
    }
    if (input !== undefined && inputIndex < input.byteLength) {
      const inputFailure = charge(
        "inputBytes",
        limits.maximumInputBytes,
      );
      if (inputFailure !== undefined) {
        return { inputIndex, failure: inputFailure };
      }
      const failure = processUtf8Byte(input[inputIndex]!);
      return {
        inputIndex: inputIndex + 1,
        ...(failure === undefined ? {} : { failure }),
      };
    }
    if (!finishRequested) return { inputIndex };
    if (utf8Expected !== 0) return { inputIndex, failure: issue("invalidUtf8") };
    if (mode.kind === "number") {
      const failure = finalizeNumber(mode);
      return {
        inputIndex,
        ...(failure === undefined ? {} : { failure }),
      };
    }
    if (mode.kind !== "normal") {
      return { inputIndex, failure: issue("malformed") };
    }
    if (!rootStarted || !rootComplete || frameCount !== 0) {
      return { inputIndex, failure: issue("malformed") };
    }
    completed = true;
    return { inputIndex };
  };

  const run = (
    input: Uint8Array | undefined,
    maximumTransitions: number,
    finishing: boolean,
  ): Result.Result<
    IncrementalCanonicalJsonDecodeStepV1,
    IncrementalCanonicalJsonIssueV1
  > => {
    if (terminalIssue !== undefined) return Result.fail(terminalIssue);
    if (completed) return Result.fail(issue("closed"));
    if (finishing) finishRequested = true;
    const before = frozenUsage(usage);
    let inputIndex = 0;
    let remaining = maximumTransitions;
    while (remaining > 0 && !completed) {
      const beforeIndex = inputIndex;
      const result = transition(input, inputIndex);
      inputIndex = result.inputIndex;
      remaining -= 1;
      if (result.failure !== undefined) return fail(result.failure);
      if (
        !finishing &&
        input !== undefined &&
        inputIndex >= input.byteLength &&
        pendingScalar === undefined &&
        pendingCanonicalBytes === 0 &&
        !hasPendingValue &&
        pendingSinkEvent === undefined &&
        pendingContainer === undefined &&
        containerFinalization === undefined &&
        keyComparison === undefined
      ) {
        break;
      }
      if (
        inputIndex === beforeIndex &&
        input !== undefined &&
        inputIndex >= input.byteLength &&
        !finishing &&
        pendingScalar === undefined &&
        pendingCanonicalBytes === 0 &&
        !hasPendingValue &&
        pendingSinkEvent === undefined &&
        pendingContainer === undefined &&
        containerFinalization === undefined &&
        keyComparison === undefined
      ) {
        break;
      }
    }
    const currentReceipt = receipt(usage, before);
    if (completed) {
      return Result.succeed(Object.freeze({
        status: "complete",
        consumedInputBytes: inputIndex,
        canonical,
        jsonMembership,
        wellFormedUnicode,
        ...(rootObjectMemberCount === undefined
          ? {}
          : { rootObjectMemberCount }),
        receipt: currentReceipt,
      }));
    }
    return Result.succeed(Object.freeze({
      status: "pending",
      consumedInputBytes: inputIndex,
      receipt: currentReceipt,
    }));
  };

  const step = (
    input: unknown,
    rawAllowance: unknown,
  ): Result.Result<
    IncrementalCanonicalJsonDecodeStepV1,
    IncrementalCanonicalJsonIssueV1
  > => {
    if (terminalIssue !== undefined) return Result.fail(terminalIssue);
    if (completed || finishRequested) return Result.fail(issue("closed"));
    const allowance = captureAllowance(rawAllowance);
    if (allowance === undefined) return fail(issue("invalidInput"));
    if (!isUint8Array(input)) return fail(issue("invalidInput"));
    const visibleLength = intrinsicByteLength(input);
    if (visibleLength === undefined) return fail(issue("invalidInput"));
    const bytes = intrinsicVisibleBytes(input, visibleLength);
    if (bytes === undefined) return fail(issue("invalidInput"));
    return run(bytes, allowance, false);
  };

  const finish = (
    rawAllowance: unknown,
  ): Result.Result<
    IncrementalCanonicalJsonDecodeStepV1,
    IncrementalCanonicalJsonIssueV1
  > => {
    if (terminalIssue !== undefined) return Result.fail(terminalIssue);
    if (completed) return Result.fail(issue("closed"));
    const allowance = captureAllowance(rawAllowance);
    if (allowance === undefined) return fail(issue("invalidInput"));
    return run(undefined, allowance, true);
  };

  return Result.succeed(Object.freeze({ step, finish }));
}

type EncoderContainerFrame =
  | {
      readonly kind: "array";
      state: "valueOrEnd" | "inValue";
      memberCount: number;
    }
  | {
      readonly kind: "object";
      state: "keyOrEnd" | "key" | "value" | "inValue";
      lastKey: string | undefined;
      currentKey: string | undefined;
      memberCount: number;
    };

type EncoderStringState = {
  readonly role: "key" | "value";
};

type EncoderPendingCompletion =
  | "value"
  | "key"
  | "container"
  | undefined;

type EncoderKeyComparison = {
  readonly frame: Extract<EncoderContainerFrame, { readonly kind: "object" }>;
  readonly left: string;
  readonly right: string;
  index: number;
};

function utf8Bytes(value: number): ReadonlyArray<number> {
  if (value <= 0x7f) return [value];
  if (value <= 0x7ff) {
    return [
      0xc0 | (value >> 6),
      0x80 | (value & 0x3f),
    ];
  }
  if (value <= 0xffff) {
    return [
      0xe0 | (value >> 12),
      0x80 | ((value >> 6) & 0x3f),
      0x80 | (value & 0x3f),
    ];
  }
  return [
    0xf0 | (value >> 18),
    0x80 | ((value >> 12) & 0x3f),
    0x80 | ((value >> 6) & 0x3f),
    0x80 | (value & 0x3f),
  ];
}

function asciiBytes(value: string): ReadonlyArray<number> {
  const output: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    output.push(value.charCodeAt(index));
  }
  return output;
}

function escapedStringBytes(
  value: string,
  index: number,
): Readonly<{
  readonly bytes: ReadonlyArray<number>;
  readonly consumedCodeUnits: number;
  readonly stringBytes: number;
  readonly validUnicode: boolean;
}> {
  const first = value.charCodeAt(index);
  if (first === 0x22) {
    return {
      bytes: [0x5c, 0x22],
      consumedCodeUnits: 1,
      stringBytes: 1,
      validUnicode: true,
    };
  }
  if (first === 0x5c) {
    return {
      bytes: [0x5c, 0x5c],
      consumedCodeUnits: 1,
      stringBytes: 1,
      validUnicode: true,
    };
  }
  const short = first === 0x08
    ? 0x62
    : first === 0x09
    ? 0x74
    : first === 0x0a
    ? 0x6e
    : first === 0x0c
    ? 0x66
    : first === 0x0d
    ? 0x72
    : undefined;
  if (short !== undefined) {
    return {
      bytes: [0x5c, short],
      consumedCodeUnits: 1,
      stringBytes: 1,
      validUnicode: true,
    };
  }
  if (first <= 0x1f || (first >= 0xd800 && first <= 0xdfff)) {
    if (
      first >= 0xd800 &&
      first <= 0xdbff &&
      index + 1 < value.length
    ) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        const codePoint = 0x10000 +
          ((first - 0xd800) << 10) +
          (second - 0xdc00);
        return {
          bytes: utf8Bytes(codePoint),
          consumedCodeUnits: 2,
          stringBytes: 4,
          validUnicode: true,
        };
      }
    }
    const hex = first.toString(16).padStart(4, "0");
    return {
      bytes: asciiBytes(`\\u${hex}`),
      consumedCodeUnits: 1,
      stringBytes: 3,
      validUnicode: !(first >= 0xd800 && first <= 0xdfff),
    };
  }
  return {
    bytes: utf8Bytes(first),
    consumedCodeUnits: 1,
    stringBytes: utf8Length(first),
    validUnicode: true,
  };
}

function captureEvent(
  value: unknown,
): IncrementalCanonicalJsonEventV1 | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const keys = Object.getOwnPropertyNames(value);
  if (Object.getOwnPropertySymbols(value).length !== 0) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const kindDescriptor = descriptors.kind;
  if (
    kindDescriptor === undefined ||
    !("value" in kindDescriptor) ||
    typeof kindDescriptor.value !== "string"
  ) {
    return undefined;
  }
  const ownValue = (
    key: string,
  ): unknown => {
    const descriptor = descriptors[key];
    return descriptor !== undefined && "value" in descriptor
      ? descriptor.value
      : undefined;
  };
  const exactKeys = (...expected: ReadonlyArray<string>): boolean =>
    keys.length === expected.length &&
    expected.every((key) => keys.includes(key));
  switch (kindDescriptor.value) {
    case "null":
    case "arrayStart":
    case "arrayEnd":
    case "objectStart":
    case "objectEnd":
    case "end":
      return exactKeys("kind")
        ? Object.freeze({ kind: kindDescriptor.value })
        : undefined;
    case "boolean": {
      const booleanValue = ownValue("value");
      return exactKeys("kind", "value") && typeof booleanValue === "boolean"
        ? Object.freeze({ kind: "boolean", value: booleanValue })
        : undefined;
    }
    case "number": {
      const numberValue = ownValue("value");
      return exactKeys("kind", "value") &&
          typeof numberValue === "number" &&
          Number.isFinite(numberValue)
        ? Object.freeze({ kind: "number", value: numberValue })
        : undefined;
    }
    case "stringStart":
    case "stringEnd": {
      const role = ownValue("role");
      return exactKeys("kind", "role") &&
          (role === "key" || role === "value")
        ? Object.freeze({ kind: kindDescriptor.value, role })
        : undefined;
    }
    case "stringScalar": {
      const role = ownValue("role");
      const text = ownValue("value");
      const codePoint = ownValue("codePoint");
      if (
        !exactKeys("kind", "role", "value", "codePoint") ||
        (role !== "key" && role !== "value") ||
        typeof text !== "string" ||
        typeof codePoint !== "number" ||
        !Number.isInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
        String.fromCodePoint(codePoint) !== text
      ) {
        return undefined;
      }
      return Object.freeze({
        kind: "stringScalar",
        role,
        value: text,
        codePoint,
      });
    }
    default:
      return undefined;
  }
}

type EncoderCompleteV1 =
  | IncrementalCanonicalJsonEncodedV1
  | IncrementalCanonicalJsonByteSinkEncodedV1;

interface IncrementalCanonicalJsonEncoderMachineV1<
  Complete extends EncoderCompleteV1,
> {
  readonly step: (
    maximumTransitions: unknown,
  ) => Result.Result<
    Omit<IncrementalCanonicalJsonPendingV1, "consumedInputBytes"> | Complete,
    IncrementalCanonicalJsonIssueV1
  >;
  readonly finish: (
    maximumTransitions: unknown,
  ) => Result.Result<
    Omit<IncrementalCanonicalJsonPendingV1, "consumedInputBytes"> | Complete,
    IncrementalCanonicalJsonIssueV1
  >;
}

interface EncoderOutputTargetV1<Complete extends EncoderCompleteV1> {
  readonly write: (
    byte: number,
    offset: number,
    maximumCanonicalBytes: number,
  ) => IncrementalCanonicalJsonIssueV1 | undefined;
  readonly finishTransition: (
    outputLength: number,
  ) => Readonly<{
    readonly complete: boolean;
    readonly failure?: IncrementalCanonicalJsonIssueV1;
  }>;
  readonly complete: (
    outputLength: number,
    value: IncrementalCanonicalJsonReceiptV1,
  ) => Complete;
}

function createContiguousEncoderOutputTargetV1(): EncoderOutputTargetV1<
  IncrementalCanonicalJsonEncodedV1
> {
  const outputChunks: Array<Uint8Array | undefined> = [];
  let exactOutput: Uint8Array | undefined;
  let copyIndex = 0;
  let copying = false;
  return {
    write: (byte, offset, maximumCanonicalBytes) => {
      const chunkIndex = Math.floor(offset / OUTPUT_CHUNK_BYTES);
      const chunkOffset = offset % OUTPUT_CHUNK_BYTES;
      let chunk = outputChunks[chunkIndex];
      if (chunk === undefined) {
        const chunkStart = chunkIndex * OUTPUT_CHUNK_BYTES;
        const chunkLength = Math.min(
          OUTPUT_CHUNK_BYTES,
          maximumCanonicalBytes - chunkStart,
        );
        try {
          chunk = new Uint8Array(chunkLength);
        } catch {
          return issue("invalidBudget");
        }
        outputChunks[chunkIndex] = chunk;
      }
      chunk[chunkOffset] = byte;
      return undefined;
    },
    finishTransition: (outputLength) => {
      if (!copying) {
        try {
          exactOutput = new Uint8Array(outputLength);
        } catch {
          return { complete: false, failure: issue("invalidBudget") };
        }
        copying = true;
        return { complete: false };
      }
      if (exactOutput === undefined) {
        return { complete: false, failure: issue("malformed") };
      }
      if (copyIndex < outputLength) {
        const chunkIndex = Math.floor(copyIndex / OUTPUT_CHUNK_BYTES);
        const chunkOffset = copyIndex % OUTPUT_CHUNK_BYTES;
        const chunk = outputChunks[chunkIndex];
        if (chunk === undefined) {
          return { complete: false, failure: issue("malformed") };
        }
        exactOutput[copyIndex] = chunk[chunkOffset]!;
        copyIndex += 1;
        return { complete: false };
      }
      return { complete: true };
    },
    complete: (_outputLength, value) => Object.freeze({
      status: "complete",
      bytes: exactOutput!,
      receipt: value,
    }),
  };
}

function createByteSinkEncoderOutputTargetV1(
  sink: ByteSinkPushV1,
): EncoderOutputTargetV1<IncrementalCanonicalJsonByteSinkEncodedV1> {
  return {
    write: (byte, offset) => {
      sink(byte, offset);
      return undefined;
    },
    finishTransition: () => ({ complete: true }),
    complete: (outputLength, value) => Object.freeze({
      status: "complete",
      canonicalByteLength: outputLength,
      receipt: value,
    }),
  };
}

function createIncrementalCanonicalJsonEncoderMachineV1<
  Complete extends EncoderCompleteV1,
>(
  rawSource: unknown,
  rawLimits: unknown,
  outputTarget: EncoderOutputTargetV1<Complete>,
): Result.Result<
  IncrementalCanonicalJsonEncoderMachineV1<Complete>,
  IncrementalCanonicalJsonIssueV1
> {
  const limits = captureLimits(rawLimits);
  const source = rawSource !== null && typeof rawSource === "object"
    ? OWNED_EVENT_SOURCES.get(rawSource)
    : undefined;
  if (
    limits === undefined ||
    limits.maximumCanonicalBytes > 0xffff_ffff ||
    limits.maximumStringBytes > 0xffff_ffff ||
    limits.maximumMembers > 0xffff_ffff ||
    limits.maximumDepth > 0xffff_ffff
  ) {
    return Result.fail(issue("invalidBudget"));
  }
  if (source === undefined) return Result.fail(issue("invalidInput"));
  const frames: Array<EncoderContainerFrame | undefined> = [];
  let frameCount = 0;
  let rootState: "empty" | "inValue" | "complete" = "empty";
  let stringState: EncoderStringState | undefined;
  let pendingEvent: IncrementalCanonicalJsonEventV1 | undefined;
  let pendingBytes: ReadonlyArray<number> = [];
  let pendingByteIndex = 0;
  let pendingCompletion: EncoderPendingCompletion;
  let keyComparison: EncoderKeyComparison | undefined;
  let sourceEnded = false;
  let outputLength = 0;
  let completed = false;
  let terminalIssue: IncrementalCanonicalJsonIssueV1 | undefined;
  const usage: MutableUsage = {
    inputBytes: 0,
    canonicalBytes: 0,
    stringBytes: 0,
    members: 0,
    depth: 0,
    transitions: 0,
  };

  const fail = (
    value: IncrementalCanonicalJsonIssueV1,
  ): Result.Result<never, IncrementalCanonicalJsonIssueV1> => {
    terminalIssue = value;
    return Result.fail(value);
  };

  const pushFrame = (
    frame: EncoderContainerFrame,
  ): IncrementalCanonicalJsonIssueV1 | undefined => {
    const observed = frameCount + 1;
    if (observed > limits.maximumDepth) {
      return issue("budgetExceeded", {
        dimension: "depth",
        observed,
        maximum: limits.maximumDepth,
      });
    }
    frames[frameCount] = frame;
    frameCount += 1;
    usage.depth = Math.max(usage.depth, observed);
    return undefined;
  };

  const pop = (): void => {
    frames[frameCount - 1] = undefined;
    frameCount -= 1;
  };

  const write = (byte: number): IncrementalCanonicalJsonIssueV1 | undefined => {
    const observed = outputLength + 1;
    if (observed > limits.maximumCanonicalBytes) {
      return issue("budgetExceeded", {
        dimension: "canonicalBytes",
        observed,
        maximum: limits.maximumCanonicalBytes,
      });
    }
    let targetFailure: IncrementalCanonicalJsonIssueV1 | undefined;
    try {
      targetFailure = outputTarget.write(
        byte,
        outputLength,
        limits.maximumCanonicalBytes,
      );
    } catch (defect) {
      terminalIssue = issue("closed");
      throw defect;
    }
    if (targetFailure !== undefined) return targetFailure;
    outputLength = observed;
    usage.canonicalBytes = observed;
    return undefined;
  };

  const chargeMember = (): IncrementalCanonicalJsonIssueV1 | undefined => {
    const observed = usage.members + 1;
    if (observed > limits.maximumMembers) {
      return issue("budgetExceeded", {
        dimension: "members",
        observed,
        maximum: limits.maximumMembers,
      });
    }
    usage.members = observed;
    return undefined;
  };

  const activeFrame = (): EncoderContainerFrame | undefined =>
    frameCount === 0 ? undefined : frames[frameCount - 1];

  const beginValue = (): Readonly<{
    readonly prefix: ReadonlyArray<number>;
    readonly failure?: IncrementalCanonicalJsonIssueV1;
  }> => {
    const frame = activeFrame();
    if (frame === undefined) {
      if (rootState !== "empty") {
        return { prefix: [], failure: issue("invalidInput") };
      }
      rootState = "inValue";
      return { prefix: [] };
    }
    if (frame.kind === "array") {
      if (frame.state !== "valueOrEnd") {
        return { prefix: [], failure: issue("invalidInput") };
      }
      const charged = chargeMember();
      if (charged !== undefined) return { prefix: [], failure: charged };
      const prefix = frame.memberCount === 0 ? [] : [0x2c];
      frame.memberCount += 1;
      frame.state = "inValue";
      return { prefix };
    }
    if (frame.state !== "value") {
      return { prefix: [], failure: issue("invalidInput") };
    }
    frame.state = "inValue";
    return { prefix: [0x3a] };
  };

  const completeValue = (): IncrementalCanonicalJsonIssueV1 | undefined => {
    const frame = activeFrame();
    if (frame === undefined) {
      if (rootState !== "inValue") return issue("invalidInput");
      rootState = "complete";
      return undefined;
    }
    if (frame.state !== "inValue") return issue("invalidInput");
    frame.state = frame.kind === "array" ? "valueOrEnd" : "keyOrEnd";
    return undefined;
  };

  const queueBytes = (
    bytes: ReadonlyArray<number>,
    completion?: Exclude<EncoderPendingCompletion, undefined>,
  ): IncrementalCanonicalJsonIssueV1 | undefined => {
    if (
      pendingByteIndex < pendingBytes.length ||
      pendingCompletion !== undefined
    ) {
      return issue("malformed");
    }
    pendingBytes = bytes;
    pendingByteIndex = 0;
    pendingCompletion = completion;
    return undefined;
  };

  const finishPendingBytes = (): IncrementalCanonicalJsonIssueV1 | undefined => {
    if (pendingByteIndex < pendingBytes.length) return undefined;
    pendingBytes = [];
    pendingByteIndex = 0;
    const completion = pendingCompletion;
    pendingCompletion = undefined;
    if (completion === undefined) return undefined;
    if (completion === "value" || completion === "container") {
      return completeValue();
    }
    const frame = activeFrame();
    if (
      completion !== "key" ||
      frame?.kind !== "object" ||
      frame.state !== "key" ||
      frame.currentKey === undefined
    ) {
      return issue("malformed");
    }
    if (frame.lastKey === undefined) {
      frame.lastKey = frame.currentKey;
      frame.state = "value";
      return undefined;
    }
    keyComparison = {
      frame,
      left: frame.lastKey,
      right: frame.currentKey,
      index: 0,
    };
    return undefined;
  };

  const comparePendingKey = (): IncrementalCanonicalJsonIssueV1 | undefined => {
    const comparison = keyComparison;
    if (comparison === undefined) return undefined;
    const result = compareCodeUnits(
      comparison.left,
      comparison.right,
      comparison.index,
    );
    if (
      result === 0 &&
      comparison.index < comparison.left.length &&
      comparison.index < comparison.right.length
    ) {
      comparison.index += 1;
      return undefined;
    }
    if (result >= 0) return issue("invalidInput");
    comparison.frame.lastKey = comparison.right;
    comparison.frame.state = "value";
    keyComparison = undefined;
    return undefined;
  };

  const processEvent = (
    event: IncrementalCanonicalJsonEventV1,
  ): IncrementalCanonicalJsonIssueV1 | undefined => {
    if (sourceEnded) return issue("closed");
    switch (event.kind) {
      case "end":
        if (
          rootState !== "complete" ||
          frameCount !== 0 ||
          stringState !== undefined
        ) {
          return issue("invalidInput");
        }
        sourceEnded = true;
        return undefined;
      case "null": {
        const started = beginValue();
        if (started.failure !== undefined) return started.failure;
        return queueBytes([...started.prefix, ...asciiBytes("null")], "value");
      }
      case "boolean": {
        const started = beginValue();
        if (started.failure !== undefined) return started.failure;
        return queueBytes(
          [...started.prefix, ...asciiBytes(event.value ? "true" : "false")],
          "value",
        );
      }
      case "number": {
        const started = beginValue();
        if (started.failure !== undefined) return started.failure;
        const spelling = JSON.stringify(event.value);
        if (spelling.length > MAX_CANONICAL_NUMBER_BYTES) {
          return issue("malformed");
        }
        return queueBytes([...started.prefix, ...asciiBytes(spelling)], "value");
      }
      case "arrayStart":
      case "objectStart": {
        const started = beginValue();
        if (started.failure !== undefined) return started.failure;
        const pushed = pushFrame(
          event.kind === "arrayStart"
            ? { kind: "array", state: "valueOrEnd", memberCount: 0 }
            : {
                kind: "object",
                state: "keyOrEnd",
                lastKey: undefined,
                currentKey: undefined,
                memberCount: 0,
              },
        );
        if (pushed !== undefined) return pushed;
        return queueBytes([
          ...started.prefix,
          event.kind === "arrayStart" ? 0x5b : 0x7b,
        ]);
      }
      case "arrayEnd":
      case "objectEnd": {
        const frame = activeFrame();
        if (
          frame === undefined ||
          (event.kind === "arrayEnd" &&
            (frame.kind !== "array" || frame.state !== "valueOrEnd")) ||
          (event.kind === "objectEnd" &&
            (frame.kind !== "object" || frame.state !== "keyOrEnd"))
        ) {
          return issue("invalidInput");
        }
        pop();
        return queueBytes(
          [event.kind === "arrayEnd" ? 0x5d : 0x7d],
          "container",
        );
      }
      case "stringStart": {
        if (stringState !== undefined) return issue("invalidInput");
        if (event.role === "value") {
          const started = beginValue();
          if (started.failure !== undefined) return started.failure;
          stringState = { role: event.role };
          return queueBytes([...started.prefix, 0x22]);
        } else {
          const frame = activeFrame();
          if (frame?.kind !== "object" || frame.state !== "keyOrEnd") {
            return issue("invalidInput");
          }
          const charged = chargeMember();
          if (charged !== undefined) return charged;
          const prefix = frame.memberCount === 0 ? [] : [0x2c];
          frame.memberCount += 1;
          frame.state = "key";
          frame.currentKey = "";
          stringState = { role: event.role };
          return queueBytes([...prefix, 0x22]);
        }
      }
      case "stringScalar": {
        const current = stringState;
        if (current === undefined || current.role !== event.role) {
          return issue("invalidInput");
        }
        const encoded = escapedStringBytes(event.value, 0);
        if (
          !encoded.validUnicode ||
          encoded.consumedCodeUnits !== event.value.length
        ) {
          return issue("invalidInput");
        }
        const observed = usage.stringBytes + encoded.stringBytes;
        if (observed > limits.maximumStringBytes) {
          return issue("budgetExceeded", {
            dimension: "stringBytes",
            observed,
            maximum: limits.maximumStringBytes,
          });
        }
        usage.stringBytes = observed;
        if (event.role === "key") {
          const frame = activeFrame();
          if (frame?.kind !== "object" || frame.state !== "key") {
            return issue("malformed");
          }
          frame.currentKey = `${frame.currentKey ?? ""}${event.value}`;
        }
        return queueBytes(encoded.bytes);
      }
      case "stringEnd": {
        const current = stringState;
        if (current === undefined || current.role !== event.role) {
          return issue("invalidInput");
        }
        stringState = undefined;
        return queueBytes(
          [0x22],
          event.role === "key" ? "key" : "value",
        );
      }
    }
  };

  const transition = (): IncrementalCanonicalJsonIssueV1 | undefined => {
    usage.transitions += 1;
    if (pendingByteIndex < pendingBytes.length) {
      const failure = write(pendingBytes[pendingByteIndex]!);
      if (failure !== undefined) return failure;
      pendingByteIndex += 1;
      return undefined;
    }
    if (pendingCompletion !== undefined) {
      return finishPendingBytes();
    }
    if (keyComparison !== undefined) {
      return comparePendingKey();
    }
    if (sourceEnded) {
      const settled = outputTarget.finishTransition(outputLength);
      if (settled.failure !== undefined) return settled.failure;
      completed = settled.complete;
      return undefined;
    }
    if (pendingEvent !== undefined) {
      const event = pendingEvent;
      pendingEvent = undefined;
      return processEvent(event);
    }
    try {
      const pulled = source();
      const captured = captureEvent(pulled);
      if (captured === undefined) return issue("invalidInput");
      pendingEvent = captured;
    } catch (defect) {
      terminalIssue = issue("closed");
      throw defect;
    }
    return undefined;
  };

  const run = (
    rawAllowance: unknown,
  ): Result.Result<
    Omit<IncrementalCanonicalJsonPendingV1, "consumedInputBytes"> | Complete,
    IncrementalCanonicalJsonIssueV1
  > => {
    if (terminalIssue !== undefined) return Result.fail(terminalIssue);
    if (completed) return Result.fail(issue("closed"));
    const allowance = captureAllowance(rawAllowance);
    if (allowance === undefined) return fail(issue("invalidInput"));
    const before = frozenUsage(usage);
    let remaining = allowance;
    while (remaining > 0 && !completed) {
      const failure = transition();
      remaining -= 1;
      if (failure !== undefined) return fail(failure);
    }
    const currentReceipt = receipt(usage, before);
    if (completed) {
      return Result.succeed(outputTarget.complete(outputLength, currentReceipt));
    }
    return Result.succeed(Object.freeze({
      status: "pending",
      receipt: currentReceipt,
    }));
  };

  const step = (
    rawAllowance: unknown,
  ): Result.Result<
    Omit<IncrementalCanonicalJsonPendingV1, "consumedInputBytes"> | Complete,
    IncrementalCanonicalJsonIssueV1
  > => run(rawAllowance);

  const finish = (
    rawAllowance: unknown,
  ): Result.Result<
    Omit<IncrementalCanonicalJsonPendingV1, "consumedInputBytes"> | Complete,
    IncrementalCanonicalJsonIssueV1
  > => run(rawAllowance);

  return Result.succeed(Object.freeze({ step, finish }));
}

export function createIncrementalCanonicalJsonEncoderV1(
  rawSource: unknown,
  rawLimits: unknown,
): Result.Result<
  IncrementalCanonicalJsonEncoderV1,
  IncrementalCanonicalJsonIssueV1
> {
  return createIncrementalCanonicalJsonEncoderMachineV1(
    rawSource,
    rawLimits,
    createContiguousEncoderOutputTargetV1(),
  );
}

export function createIncrementalCanonicalJsonByteSinkEncoderV1(
  rawSource: unknown,
  rawSink: unknown,
  rawLimits: unknown,
): Result.Result<
  IncrementalCanonicalJsonByteSinkEncoderV1,
  IncrementalCanonicalJsonIssueV1
> {
  const sink = rawSink !== null && typeof rawSink === "object"
    ? OWNED_BYTE_SINKS.get(rawSink)
    : undefined;
  if (sink === undefined) return Result.fail(issue("invalidInput"));
  return createIncrementalCanonicalJsonEncoderMachineV1(
    rawSource,
    rawLimits,
    createByteSinkEncoderOutputTargetV1(sink),
  );
}
