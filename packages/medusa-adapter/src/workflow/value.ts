import { Effect, Result, Schema } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { capturePrivateIntermediateJsonData, commerceError, defaultCommerceResources, type CommerceTransactionError, type Json, type PrivateIntermediateJsonPath } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../value/input";
import { commerceDecoder } from "../value/decoder";

/** Native intermediate values may own undefined object members and dense array
 * slots. This is a transport value contract, never a persisted JSON widening. */
export type WorkflowIntermediateValue = string | number | boolean | null | undefined
  | readonly WorkflowIntermediateValue[] | { readonly [key: string]: WorkflowIntermediateValue };
export type WorkflowInputPresence = "preserveOwnUndefined";

const captureIntermediate = (input: unknown) => capturePrivateIntermediateJsonData({ value: input },
  { bytes: defaultCommerceResources.commandBytes, nodes: defaultCommerceResources.valueNodes, depth: 16 }, commerceError);

/** Method/Query inputs retain dense positional undefined values until their
 * native argument decoder normalizes them. Object undefined stays omitted by
 * default; a trusted method profile may preserve all issued object paths.
 * The shared capture owner bounds descriptors and the complete sidecar first. */
export function captureWorkflowInput(input: unknown, inputPresence?: WorkflowInputPresence) {
  return Result.gen(function* () {
    if (inputPresence !== undefined && inputPresence !== "preserveOwnUndefined")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const snapshot = yield* captureIntermediate(input);
    const envelope = yield* captureCommerceInput({ payload: snapshot.value, undefinedPaths: snapshot.undefinedPaths });
    if (!isNonArrayRecord(envelope)) return yield* Result.fail(commerceError("storedCorruption"));
    return yield* restoreWorkflowValue(envelope.payload, inputPresence === "preserveOwnUndefined"
      ? snapshot.undefinedPaths : snapshot.undefinedPaths.filter(path => typeof path.at(-1) === "number"));
  });
}

/** The method encoder's native intermediate is charged as a complete JSON
 * envelope before it crosses the ordinary command input boundary. */
export function captureWorkflowCommandInput(value: WorkflowIntermediateValue) {
  return Result.gen(function* () {
    const snapshot = yield* captureIntermediate(value);
    return yield* captureCommerceInput({ payload: snapshot.value, undefinedPaths: snapshot.undefinedPaths });
  });
}

const decodeCommandEnvelope = commerceDecoder(Schema.Struct({
  payload: Schema.Struct({ value: Schema.optionalKey(Schema.Json) }),
  undefinedPaths: Schema.Array(Schema.Array(Schema.Union([
    Schema.String,
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  ])).check(Schema.isLengthBetween(1, 16))).check(Schema.isMaxLength(defaultCommerceResources.valueNodes)),
}), "invalidInput");

/** Serialized paths carry representation only. Capture foreign descriptors and
 * charge the entire envelope first, then verify every target on a detached tree
 * before invoking the command's authoritative argument decoder. */
export function decodeWorkflowCommandInput<Input>(input: unknown,
  decode: (value: unknown) => Result.Result<Input, CommerceTransactionError>) {
  return Result.gen(function* () {
    const snapshot = yield* capturePrivateIntermediateJsonData(input,
      { bytes: defaultCommerceResources.commandBytes, nodes: defaultCommerceResources.valueNodes, depth: 16 }, commerceError);
    if (snapshot.undefinedPaths.length !== 0) return yield* Result.fail(commerceError("invalidInput"));
    const envelope = yield* decodeCommandEnvelope(snapshot.value);
    if (envelope.undefinedPaths.some(path => path[0] !== "value")) return yield* Result.fail(commerceError("invalidInput"));
    if (!Object.hasOwn(envelope.payload, "value") && !envelope.undefinedPaths.some(path => path.length === 1))
      return yield* Result.fail(commerceError("invalidInput"));
    const restored = yield* restoreWorkflowValue(envelope.payload, envelope.undefinedPaths)
      .pipe(Result.mapError(cause => commerceError("invalidInput", cause)));
    // Restored missing members also consume the native source's node/depth and
    // sidecar budgets; a small serialized envelope cannot manufacture an
    // unbounded intermediate value through its path metadata.
    yield* captureIntermediate(restored);
    return yield* decode(restored);
  });
}

/** Captured and decoded payloads are plain JSON trees: null, scalars, dense
 * arrays and string-keyed data records. One owned copy thaws them; an own
 * `__proto__` member stays data and never selects the copy's prototype. A
 * subtree the payload holds twice becomes two copies, as its wire form decodes. */
const thawWorkflowJson = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map(thawWorkflowJson);
  const owned: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const member = thawWorkflowJson(Object.getOwnPropertyDescriptor(value, key)?.value);
    if (key === "__proto__") Object.defineProperty(owned, key, { value: member, enumerable: true, writable: true, configurable: true });
    else owned[key] = member;
  }
  return owned;
};

/** Capture-issued or checked transport paths target only this detached payload.
 * No path data confers source identity or authority. */
function restoreWorkflowValue(payload: Json | undefined, undefinedPaths: readonly PrivateIntermediateJsonPath[]): Result.Result<unknown, CommerceTransactionError> {
  const owned = thawWorkflowJson(payload);
  for (const path of undefinedPaths) {
    let parent = owned;
    for (const key of path.slice(0, -1)) {
      if (typeof parent !== "object" || parent === null ||
        (typeof key === "number" ? !Array.isArray(parent) : !isNonArrayRecord(parent)) || !Object.hasOwn(parent, key))
        return Result.fail(commerceError("storedCorruption"));
      parent = Object.getOwnPropertyDescriptor(parent, key)?.value;
    }
    const key = path.at(-1);
    if (key === undefined || typeof parent !== "object" || parent === null || (typeof key === "number"
      ? !Array.isArray(parent) || !Number.isSafeInteger(key) || key < 0 || key >= parent.length ||
        !Object.hasOwn(parent, key) || Object.getOwnPropertyDescriptor(parent, key)?.value !== null
      : !isNonArrayRecord(parent) || Object.hasOwn(parent, key))) return Result.fail(commerceError("storedCorruption"));
    Object.defineProperty(parent, key, { value: undefined, enumerable: true, writable: true, configurable: true });
  }
  if (!isNonArrayRecord(owned)) return Result.fail(commerceError("storedCorruption"));
  return Result.succeed(owned.value);
}

/** Presented workflow roots issued by `captureWorkflowValue`, with the envelope
 * the context already validated and measured for them. Membership is identity
 * of an object this module froze itself, never a structural resemblance, and
 * conveys value facts only: every use is still charged by its own context. */
const issuedWorkflowValues = new WeakMap<object, Json>();

/** Deep-frozen presentation of one captured payload. A subtree holding no
 * undefined slot is the capture owner's issued node itself, so a later capture
 * recognizes it by identity. Only containers on the way to an undefined slot are
 * rebuilt, with the member order `restoreWorkflowValue` gives its thawed copy. */
function issueWorkflowJson(node: Json | undefined, undefinedPaths: readonly PrivateIntermediateJsonPath[], depth: number): Result.Result<unknown, CommerceTransactionError> {
  if (undefinedPaths.length === 0) return Result.succeed(node);
  return Result.gen(function* () {
    if (typeof node !== "object" || node === null) return yield* Result.fail(commerceError("storedCorruption"));
    const slots = new Set<string | number>();
    const nested = new Map<string | number, PrivateIntermediateJsonPath[]>();
    for (const path of undefinedPaths) {
      const key = path[depth];
      if (key === undefined || (typeof key === "number" ? !Array.isArray(node) : !isNonArrayRecord(node)))
        return yield* Result.fail(commerceError("storedCorruption"));
      if (path.length !== depth + 1) {
        if (!Object.hasOwn(node, key)) return yield* Result.fail(commerceError("storedCorruption"));
        const paths = nested.get(key);
        if (paths === undefined) nested.set(key, [path]);
        else paths.push(path);
      } else if (slots.has(key) || (typeof key === "number"
        ? !Number.isSafeInteger(key) || key < 0 || !Object.hasOwn(node, key) || Object.getOwnPropertyDescriptor(node, key)?.value !== null
        : Object.hasOwn(node, key))) return yield* Result.fail(commerceError("storedCorruption"));
      else slots.add(key);
    }
    // One member cannot be both an undefined slot and the parent of one.
    for (const key of slots) if (nested.has(key)) return yield* Result.fail(commerceError("storedCorruption"));
    if (Array.isArray(node)) {
      const members: unknown[] = [];
      for (const [index, member] of node.entries())
        members.push(slots.has(index) ? undefined : yield* issueWorkflowJson(member, nested.get(index) ?? [], depth + 1));
      return Object.freeze(members);
    }
    const entries: [string, unknown][] = [];
    for (const key of Object.keys(node))
      entries.push([key, yield* issueWorkflowJson(Object.getOwnPropertyDescriptor(node, key)?.value, nested.get(key) ?? [], depth + 1)]);
    for (const key of slots) entries.push([String(key), undefined]);
    return Object.freeze(Object.fromEntries(entries));
  });
}

/** The staged SDK retains own undefined properties and positional results.
 * Budget the shared owner's JSON envelope, then issue a deep-frozen value that
 * stays with trusted workflow state. Capturing that exact root again charges
 * its retained envelope without another walk; anything else, including a
 * presented copy or a frozen look-alike, is captured completely. */
export const captureWorkflowValue = Effect.fnUntraced(function* (ctx: AtomicCommerceContext, value: unknown) {
  const issued = typeof value === "object" && value !== null ? issuedWorkflowValues.get(value) : undefined;
  if (issued !== undefined) {
    yield* ctx.capture(issued);
    return value;
  }
  let undefinedPaths: readonly PrivateIntermediateJsonPath[] = [];
  const captured = yield* ctx.capture(value, input =>
    captureIntermediate(input)
      .pipe(Result.map(snapshot => {
        undefinedPaths = snapshot.undefinedPaths;
        return { payload: snapshot.value, undefinedPaths };
      })));
  if (!isNonArrayRecord(captured)) return yield* ctx.refuse(commerceError("storedCorruption"));
  const presented = yield* issueWorkflowJson(captured.payload, undefinedPaths, 0).pipe(
    Result.flatMap(payload => isNonArrayRecord(payload) ? Result.succeed(payload.value) : Result.fail(commerceError("storedCorruption"))),
    Result.match({ onFailure: ctx.refuse, onSuccess: Effect.succeed }));
  if (typeof presented === "object" && presented !== null) issuedWorkflowValues.set(presented, captured);
  return presented;
});

/** The only crossing from issued workflow state to Medusa or application
 * callbacks: one fresh mutable copy per presentation. Whatever a callback
 * returns, this copy included, is foreign again and is captured completely. */
export const presentWorkflowValue = (value: unknown): unknown => thawWorkflowJson(value);
