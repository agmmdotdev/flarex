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

export interface WorkflowResolutionFrame {
  readonly owner: object;
  readonly input: unknown;
  readonly outputs: ReadonlyMap<object, unknown>;
  readonly transforms: Map<object, unknown>;
}
interface TransformResolution { readonly reference: Reference; readonly input: unknown }
type Task =
  | { readonly kind: "visit"; readonly resolution: WorkflowResolution; readonly depth: number }
  | { readonly kind: "select"; readonly property: PropertyKey | undefined }
  | { readonly kind: "transform"; readonly reference: Reference }
  | { readonly kind: "assemble"; readonly resolution: Extract<WorkflowResolution, { readonly kind: "array" | "record" }> };

/** One pure traversal per reached input/result. Its only suspension is an actual
 * transform boundary; the caller retains capture, invocation and cancellation.
 * The explicit stack preserves member order without a runtime per scalar. */
export function* resolveWorkflowValue(resolution: WorkflowResolution, frame: WorkflowResolutionFrame):
  Generator<TransformResolution, Result.Result<unknown, ReturnType<typeof definitionError>>, unknown> {
  const tasks: Task[] = [{ kind: "visit", resolution, depth: 0 }];
  const values: unknown[] = [];
  while (tasks.length !== 0) {
    const task = tasks.pop()!;
    if (task.kind === "select") {
      const value = values.pop();
      if (task.property === undefined) return Result.fail(definitionError("invalidReference", "Missing property key"));
      values.push(value == null ? undefined : Reflect.get(Object(value), task.property));
      continue;
    }
    if (task.kind === "assemble") {
      const members = values.splice(values.length - task.resolution.members.length);
      values.push(task.resolution.kind === "array" ? members
        : Object.fromEntries(task.resolution.keys.map((key, index) => [key, members[index]])));
      continue;
    }
    if (task.kind === "transform") {
      const captured = yield { reference: task.reference, input: values.pop() };
      frame.transforms.set(task.reference, captured);
      values.push(captured);
      continue;
    }
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
      values.push(frame.outputs.get(reference.step));
      continue;
    }
    if (reference.kind === "property") tasks.push({ kind: "select", property: reference.property });
    else {
      if (frame.transforms.has(reference)) { values.push(frame.transforms.get(reference)); continue; }
      if (reference.guards?.some(guard => frame.outputs.get(guard) !== true)) { values.push(undefined); continue; }
      tasks.push({ kind: "transform", reference });
    }
    // Preparation always emits the input mechanics for property/transform refs.
    if (current.input === undefined) throw new Error("Missing prepared reference input");
    tasks.push({ kind: "visit", resolution: current.input, depth: task.depth + 1 });
  }
  return Result.succeed(values[0]);
}
