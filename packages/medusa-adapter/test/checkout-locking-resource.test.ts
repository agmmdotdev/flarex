import { Result } from "effect";
import { expect, it } from "vitest";
import { prepareWorkflowLocking } from "../src/workflow/locking";
import { composedWorkflowResourceDefinition } from "../src/workflow/composed-resource";

function bind(voidResult?: "null") {
  const resource = Result.getOrThrow(prepareWorkflowLocking([], voidResult)), definition = composedWorkflowResourceDefinition(resource);
  if (definition === undefined) throw new Error("Missing authentic locking resource");
  const service = definition.bind(async () => { throw new Error("Unexpected command invocation"); });
  const method: unknown = Object.getOwnPropertyDescriptor(service, "execute")?.value;
  if (typeof method !== "function") throw new Error("Missing native execute binding");
  return { identity: definition.identity, run: (callback: () => Promise<unknown>): Promise<unknown> => Reflect.apply(method, service, [[], callback]) };
}

it("selects a canonical void result only for the explicit native checkout callback ABI", async () => {
  const native = bind("null"), ordinary = bind();
  expect(native.identity).toEqual({ profile: "inventory-scope-exclusion", voidResult: "null" });
  expect(ordinary.identity).toEqual({ profile: "inventory-scope-exclusion" });
  expect(await native.run(async () => undefined)).toBeNull();
  expect(await ordinary.run(async () => undefined)).toBeUndefined();
  for (const value of [null, false, 0, "", [], { retained: true }]) expect(await native.run(async () => value)).toBe(value);
  const failure = new Error("Native reservation inverse failed");
  await expect(native.run(async () => { throw failure; })).rejects.toBe(failure);
});
