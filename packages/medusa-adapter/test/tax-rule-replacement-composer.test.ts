import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { setTaxRateRulesWorkflow, setTaxRateRulesWorkflowId, type SetTaxRatesRulesWorkflowInput } from "@medusajs/core-flows/tax/set-tax-rate-rules";

const prepared = Result.getOrThrow(setTaxRateRulesWorkflow.prepare());
function step(name: string) {
  const node = prepared.nodes.find(value => value.name === name);
  if (node?.kind !== "step") throw new Error("Missing native Tax replacement step " + name);
  return node;
}
function nativePort(old: string[] = []) {
  const listTaxRateRules = vi.fn(async () => old.map(id => ({ id })));
  const softDeleteTaxRateRules = vi.fn(async () => ({}));
  const restoreTaxRateRules = vi.fn(async () => ({}));
  const deleteTaxRateRules = vi.fn(async () => undefined);
  const createTaxRateRules = vi.fn(async (input: readonly object[]) => input.map((row, index) => ({ ...row, id: `new-${index}` })));
  const service = { listTaxRateRules, softDeleteTaxRateRules, restoreTaxRateRules, deleteTaxRateRules, createTaxRateRules };
  const resolve = vi.fn((name: string) => { if (name !== "tax") throw new Error("Unexpected native dependency " + name); return service; });
  const context: StepExecutionContext = { eventGroupId: "replacement167-group", container: { resolve: <Value>(name: string) => resolve(name) as Value } };
  const port: WorkflowExecutionPort<unknown> = { context, checkpoint: Effect.void, capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) };
  return { ...service, context, resolve, run: (input: SetTaxRatesRulesWorkflowInput) => executeWorkflow(prepared, input, port) };
}

describe("genuine native Tax Rule replacement composer", () => {
  it("retains the genuine root, sequential native steps and both transaction-covered inverses", () => {
    expect(setTaxRateRulesWorkflowId).toBe("set-tax-rate-rules");
    expect(prepared.nodes.filter(node => node.kind === "step").map(node => node.name))
      .toEqual(["list-tax-rate-rule-ids", "delete-tax-rate-rules", "create-tax-rate-rules"]);
    expect(step("list-tax-rate-rule-ids").compensate).toBeUndefined();
    for (const name of ["delete-tax-rate-rules", "create-tax-rate-rules"]) {
      expect(step(name).compensation).toBe("transactionCovered"); expect(step(name).compensate).toBeTypeOf("function");
    }
    expect(prepared.nodes.some(node => node.kind === "step" && node.hook)).toBe(false);
  });
  it.each([{ tax_rate_ids: [], rules: [] }, { tax_rate_ids: [], rules: [{ reference: "product", reference_id: "ignored" }] },
    { tax_rate_ids: [""], rules: [] }])
    ("resolves list and creation for the genuine empty branch: %j", async input => {
      const env = nativePort(); expect(await Effect.runPromise(env.run(input))).toEqual([]);
      expect(env.listTaxRateRules).toHaveBeenCalledExactlyOnceWith({ tax_rate_id: input.tax_rate_ids }, { select: ["id"] });
      expect(env.createTaxRateRules).toHaveBeenCalledExactlyOnceWith([]); expect(env.softDeleteTaxRateRules).not.toHaveBeenCalled();
      expect(env.resolve.mock.calls).toEqual([["tax"], ["tax"]]);
    });
  it("passes all original list identities to deletion and expands templates before raw Rate positions", async () => {
    const old = ["old-a", "old-b"], env = nativePort(old), input = { tax_rate_ids: ["rate-b", "rate-a", "rate-b", ""], rules: [
      { reference: "product", reference_id: "first", created_by: "first-creator" },
      { reference: "product_type", reference_id: "second", created_by: "second-creator" },
    ] }, original = structuredClone(input);
    const output = await Effect.runPromise(env.run(input));
    expect(env.softDeleteTaxRateRules).toHaveBeenCalledExactlyOnceWith(old);
    const expanded = input.rules.flatMap(rule => input.tax_rate_ids.map(tax_rate_id => ({ ...rule, tax_rate_id })));
    expect(env.createTaxRateRules).toHaveBeenCalledExactlyOnceWith(expanded);
    expect(output).toEqual(expanded.map((row, index) => ({ ...row, id: `new-${index}` })));
    const order = [env.listTaxRateRules, env.softDeleteTaxRateRules, env.createTaxRateRules].map(call => call.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((left, right) => (left ?? 0) - (right ?? 0)));
    expect(new Set(order).size).toBe(3); expect(env.resolve.mock.calls).toEqual([["tax"], ["tax"], ["tax"]]); expect(input).toEqual(original);
  });
  it("retains duplicate created aliases and restores exactly the listed old cohort after their physical inverse", async () => {
    const env = nativePort(), create = step("create-tax-rate-rules"), remove = step("delete-tax-rate-rules");
    env.createTaxRateRules.mockResolvedValue([{ id: "shared" }, { id: "shared" }]);
    const response = await create.invoke([{ id: "shared", tax_rate_id: "rate-a" }, { id: "shared", tax_rate_id: "rate-b" }], env.context);
    if (!(response instanceof StepResponse) || create.compensate === undefined || remove.compensate === undefined)
      throw new Error("Missing native retained replacement response");
    expect(response.compensateInput).toEqual(["shared", "shared"]);
    await create.compensate(response.compensateInput, env.context); await remove.compensate(["old-a", "old-b"], env.context);
    expect(env.deleteTaxRateRules).toHaveBeenCalledExactlyOnceWith(["shared", "shared"]);
    expect(env.restoreTaxRateRules).toHaveBeenCalledExactlyOnceWith(["old-a", "old-b"]);
    expect(env.deleteTaxRateRules.mock.invocationCallOrder[0]).toBeLessThan(env.restoreTaxRateRules.mock.invocationCallOrder[0] ?? 0);
  });
  it("skips dependency resolution for empty native retained inverses", async () => {
    const env = nativePort();
    for (const name of ["create-tax-rate-rules", "delete-tax-rate-rules"]) {
      const inverse = step(name).compensate; if (inverse === undefined) throw new Error("Missing native inverse");
      await inverse([], env.context); await inverse(undefined, env.context);
    }
    expect(env.resolve).not.toHaveBeenCalled();
  });
  it("propagates list failure before either native mutation and create failure without invoking covered compensation", async () => {
    const env = nativePort(["old-a"]), failure = new Error("native Tax dependency failure");
    env.listTaxRateRules.mockRejectedValue(failure);
    const input = { tax_rate_ids: ["rate"], rules: [{ reference: "product", reference_id: "prod" }] };
    expect(await Effect.runPromise(Effect.result(env.run(input)))).toMatchObject({ _tag: "Failure", failure });
    expect(env.softDeleteTaxRateRules).not.toHaveBeenCalled(); expect(env.createTaxRateRules).not.toHaveBeenCalled();
    env.listTaxRateRules.mockResolvedValue([{ id: "old-a" }]); env.createTaxRateRules.mockRejectedValue(failure);
    expect(await Effect.runPromise(Effect.result(env.run(input)))).toMatchObject({ _tag: "Failure", failure });
    expect(env.softDeleteTaxRateRules).toHaveBeenCalledTimes(1); expect(env.restoreTaxRateRules).not.toHaveBeenCalled();
    expect(env.deleteTaxRateRules).not.toHaveBeenCalled();
  });
});
