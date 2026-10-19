import { Result } from "effect";
import { definitionError, type Reference } from "./model";
import { referenceOf } from "./references";

/** Immutable mechanics compiled from the SDK's captured definition graph. These
 * contain no execution input, outputs, accepted values or transform results. */
export type WorkflowResolution =
  | { readonly kind: "constant"; readonly value: unknown }
  | { readonly kind: "reference"; readonly reference: Reference; readonly input: WorkflowResolution | undefined }
  | { readonly kind: "array"; readonly members: readonly WorkflowResolution[] }
  | { readonly kind: "record"; readonly keys: readonly string[]; readonly members: readonly WorkflowResolution[] };

/** Definition capture already owns descriptor safety, bounds and reference
 * authenticity. Compilation never evaluates a callback or rejects a deferred
 * reference: only the reached execution path may do that. */
export function prepareWorkflowResolution(inputs: readonly unknown[], result: unknown) {
  const compiled = new Map<object, WorkflowResolution>();
  function compile(value: unknown): WorkflowResolution {
    if (typeof value !== "object" || value === null) return Object.freeze({ kind: "constant", value });
    const existing = compiled.get(value);
    if (existing !== undefined) return existing;
    const reference = referenceOf(value);
    let resolution: WorkflowResolution;
    if (reference !== undefined) resolution = Object.freeze({ kind: "reference", reference,
      input: reference.kind === "property" || reference.kind === "transform" ? compile(reference.input) : undefined });
    else if (Array.isArray(value)) resolution = Object.freeze({ kind: "array", members: Object.freeze(value.map(compile)) });
    else {
      const entries = Object.entries(value);
      resolution = Object.freeze({ kind: "record", keys: Object.freeze(entries.map(([key]) => key)),
        members: Object.freeze(entries.map(([, member]) => compile(member))) });
    }
    compiled.set(value, resolution);
    return resolution;
  }
  return Object.freeze({ inputs: Object.freeze(inputs.map(compile)), result: compile(result) });
}

/** A reached transformer may return authentic WorkflowData from its closure.
 * Snapshot only own data descriptors before interpreting that new structure;
 * the execution port still owns final value capture and resource charging. */
export function prepareTransformResolution(value: unknown): Result.Result<WorkflowResolution, ReturnType<typeof definitionError>> {
  const compiled = new Map<object, WorkflowResolution>();
  const active = new Set<object>();
  let visited = 0;
  function compile(value: unknown, depth: number): Result.Result<WorkflowResolution, ReturnType<typeof definitionError>> {
    if (++visited > 4096 || depth > 64) return Result.fail(definitionError("invalidReference", "Transform resolution bounds exceeded"));
    if (typeof value !== "object" || value === null) return Result.succeed({ kind: "constant", value });
    if (active.has(value)) return Result.fail(definitionError("invalidReference", "Cyclic transform result"));
    const previous = compiled.get(value);
    if (previous !== undefined) return Result.succeed(previous);
    active.add(value);
    const result = Result.gen(function* () {
      const reference = referenceOf(value);
      if (reference !== undefined) return { kind: "reference", reference,
        input: reference.kind === "property" || reference.kind === "transform" ? yield* compile(reference.input, depth + 1) : undefined } satisfies WorkflowResolution;
      const array = Array.isArray(value);
      const prototype = Object.getPrototypeOf(value);
      if (prototype === Date.prototype) {
        // Native resolve-value serializes transform results before downstream
        // invocation. Admit only a bare intrinsic Date; custom serialization,
        // subclasses and ordinary/final JSON remain outside this boundary.
        if (Reflect.ownKeys(value).length !== 0)
          return yield* Result.fail(definitionError("invalidReference", "Transform Dates require intrinsic data"));
        const snapshot = yield* Result.try({ try: () => Date.prototype.toISOString.call(value),
          catch: () => definitionError("invalidReference", "Transform Dates require a valid intrinsic Date") });
        return { kind: "constant", value: snapshot } satisfies WorkflowResolution;
      }
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
        return yield* Result.fail(definitionError("invalidReference", "Transform results require plain data records"));
      const keys = Reflect.ownKeys(value);
      if (keys.length > 4097) return yield* Result.fail(definitionError("invalidReference", "Transform resolution bounds exceeded"));
      const entries: Array<readonly [string, unknown]> = [];
      const length = array ? Object.getOwnPropertyDescriptor(value, "length")?.value : undefined;
      for (const key of keys) {
        if (array && key === "length") continue;
        const property = Object.getOwnPropertyDescriptor(value, key);
        if (typeof key !== "string" || property === undefined || !("value" in property) || !property.enumerable ||
          array && (key !== String(entries.length) || typeof length !== "number" || Number(key) >= length))
          return yield* Result.fail(definitionError("invalidReference", "Transform results require own data properties"));
        entries.push([key, property.value]);
      }
      if (array && (typeof length !== "number" || entries.length !== length))
        return yield* Result.fail(definitionError("invalidReference", "Sparse transform results are unsupported"));
      const members: WorkflowResolution[] = [];
      for (const [, member] of entries) members.push(yield* compile(member, depth + 1));
      return array ? { kind: "array", members } satisfies WorkflowResolution
        : { kind: "record", keys: entries.map(([key]) => key), members } satisfies WorkflowResolution;
    });
    active.delete(value);
    return Result.map(result, resolution => { compiled.set(value, resolution); return resolution; });
  }
  return compile(value, 0);
}

export interface WorkflowResolutionFrame {
  readonly owner: object;
  readonly input: unknown;
  readonly outputs: ReadonlyMap<object, unknown>;
  /** Only actual captured StepResponse/child/hook results issue this provenance.
   * A literal undefined, skipped branch or caller-supplied marker cannot. */
  readonly undefinedStepOutputs: ReadonlySet<object>;
  readonly transforms: Map<object, unknown>;
}
// Traversal-private absence provenance; it never reaches callbacks or capture.
// Native serialization omits an undefined StepResponse object member while
// preserving its direct undefined result and positional array member.
const undefinedStepResult = Symbol("MedusaWorkflow.undefinedStepResult");
const resultValue = (value: unknown) => value === undefinedStepResult ? undefined : value;
interface TransformResolution { readonly reference: Reference; readonly input: unknown; readonly depth: number }
/** Private traversal outcome. Only resolving an issued callback reference can
 * propagate its undefined-result provenance through another staged reference. */
export interface WorkflowResolvedValue { readonly value: unknown; readonly undefinedStepResult: boolean }
type Task =
  | { readonly kind: "visit"; readonly resolution: WorkflowResolution; readonly depth: number }
  | { readonly kind: "select"; readonly property: PropertyKey | undefined }
  | { readonly kind: "transform"; readonly reference: Reference; readonly depth: number }
  | { readonly kind: "assemble"; readonly resolution: Extract<WorkflowResolution, { readonly kind: "array" | "record" }> };

/** One pure traversal per reached input/result. Its only suspension is an actual
 * transform boundary; the caller retains capture, invocation and cancellation.
 * The explicit stack preserves member order without a runtime per scalar. */
export function* resolveWorkflowValue(resolution: WorkflowResolution, frame: WorkflowResolutionFrame, depth = 0):
  Generator<TransformResolution, Result.Result<WorkflowResolvedValue, ReturnType<typeof definitionError>>, WorkflowResolvedValue> {
  const tasks: Task[] = [{ kind: "visit", resolution, depth }];
  const values: unknown[] = [];
  let visited = 0;
  while (tasks.length !== 0) {
    const task = tasks.pop()!;
    if (task.kind === "select") {
      const value = values.pop();
      if (task.property === undefined) return Result.fail(definitionError("invalidReference", "Missing property key"));
      values.push(value === undefinedStepResult ? undefinedStepResult : value == null ? undefined : Reflect.get(Object(value), task.property));
      continue;
    }
    if (task.kind === "assemble") {
      const members = values.splice(values.length - task.resolution.members.length);
      values.push(task.resolution.kind === "array" ? members.map(resultValue)
        : Object.fromEntries(task.resolution.keys.flatMap((key, index) => members[index] === undefinedStepResult ? [] : [[key, members[index]]])));
      continue;
    }
    if (task.kind === "transform") {
      const captured = yield { reference: task.reference, input: resultValue(values.pop()), depth: task.depth };
      const value = captured.value === undefined && captured.undefinedStepResult ? undefinedStepResult : captured.value;
      frame.transforms.set(task.reference, value);
      values.push(value);
      continue;
    }
    // Shared source objects compile to a DAG. Charge every expanded visit,
    // including aliases, before allocating the resolved tree for final capture.
    // This counter survives transform suspension within this traversal.
    if (++visited > 4096) return Result.fail(definitionError("invalidReference", "Resolution traversal bounds exceeded"));
    if (task.depth > 64) return Result.fail(definitionError("invalidReference", "Reference depth exceeded"));
    const current = task.resolution;
    if (current.kind === "constant") { values.push(current.value); continue; }
    if (current.kind === "array" || current.kind === "record") {
      tasks.push({ kind: "assemble", resolution: current });
      for (let index = current.members.length - 1; index >= 0; index--) {
        tasks.push({ kind: "visit", resolution: current.members[index]!, depth: task.depth + 1 });
      }
      continue;
    }
    const reference = current.reference;
    if (reference.owner !== frame.owner) return Result.fail(definitionError("invalidReference", "Foreign workflow reference"));
    if (reference.kind === "input") { values.push(frame.input); continue; }
    if (reference.kind === "step") {
      if (reference.step === undefined || !frame.outputs.has(reference.step)) return Result.fail(definitionError("invalidReference", "Step has not completed"));
      const output = frame.outputs.get(reference.step);
      values.push(output === undefined && frame.undefinedStepOutputs.has(reference.step) ? undefinedStepResult : output);
      continue;
    }
    if (reference.kind === "property") tasks.push({ kind: "select", property: reference.property });
    else {
      if (frame.transforms.has(reference)) { values.push(frame.transforms.get(reference)); continue; }
      if (reference.guards?.some(guard => frame.outputs.get(guard) !== true)) { values.push(undefined); continue; }
      tasks.push({ kind: "transform", reference, depth: task.depth });
    }
    // Preparation always emits the input mechanics for property/transform refs.
    if (current.input === undefined) throw new Error("Missing prepared reference input");
    tasks.push({ kind: "visit", resolution: current.input, depth: task.depth + 1 });
  }
  return Result.succeed({ value: resultValue(values[0]), undefinedStepResult: values[0] === undefinedStepResult });
}
