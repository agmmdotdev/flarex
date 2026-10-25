import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils/portable";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { prepareSalesChannelApiKeyRead } from "../src/modules/sales-channel/api-key-read";
import { workflowMethodDefinition } from "../src/workflow/module";
import { expect, it } from "vitest";
import { Effect, Result } from "effect";
import { createApiKeysWorkflow } from "@medusajs/core-flows/api-key/create-api-keys";
import { updateApiKeysWorkflow } from "@medusajs/core-flows/api-key/update-api-keys";
import { revokeApiKeysWorkflow } from "@medusajs/core-flows/api-key/revoke-api-keys";
import { deleteApiKeysWorkflow } from "@medusajs/core-flows/api-key/delete-api-keys";
import { linkSalesChannelsToApiKeyWorkflow } from "@medusajs/core-flows/api-key/link-sales-channels-to-publishable-key";

it("retains native creation, update and Link inverses while preserving irreversible lifecycle steps", () => {
  for (const [prepared, name] of [
    [Result.getOrThrow(createApiKeysWorkflow.prepare()), "create-api-keys"],
    [Result.getOrThrow(updateApiKeysWorkflow.prepare()), "update-api-keys"],
    [Result.getOrThrow(linkSalesChannelsToApiKeyWorkflow.prepare()), "link-sales-channels-to-api-key"],
  ] as const) {
    const node = prepared.nodes.find(node => node.name === name);
    expect(node?.kind).toBe("step");
    if (node?.kind !== "step") throw new Error("Missing native retained step");
    expect(typeof node.compensate).toBe("function");
    expect(node.compensation).toBe("transactionCovered");
  }
  for (const [prepared, name] of [
    [Result.getOrThrow(revokeApiKeysWorkflow.prepare()), "revoke-api-keys"],
    [Result.getOrThrow(deleteApiKeysWorkflow.prepare()), "delete-api-keys"],
    [Result.getOrThrow(deleteApiKeysWorkflow.prepare()), "remove-deleted-api-key-links"],
  ] as const) {
    const node = prepared.nodes.find(node => node.name === name);
    expect(node?.kind).toBe("step");
    if (node?.kind !== "step") throw new Error("Missing native irreversible step");
    expect(node.compensate).toBeUndefined();
    expect(node.compensation).toBeUndefined();
  }
});


it.each([
  { name: "explicit empty additions", input: { id: "apk-default", add: [] } },
  { name: "empty request", input: { id: "apk-default" } },
  { name: "remove only", input: { id: "apk-default", remove: ["sc-absent"] } },
])("resolves association additions for $name to an exact empty Sales Channel selector", async ({ input }) => {
  const sales = await Effect.runPromise(prepareSalesChannelApiKeyRead());
  const method = workflowMethodDefinition(sales.workflow.methods.listSalesChannels);
  if (method === undefined) throw new Error("Missing genuine Sales Channel argument decoder");
  const prepared = Result.getOrThrow(linkSalesChannelsToApiKeyWorkflow.prepare());

  const reads: unknown[] = [], mutations: unknown[] = [];
  const bindings: Readonly<Record<string, unknown>> = {
    [Modules.SALES_CHANNEL]: { async listSalesChannels(...args: unknown[]) {
      const decoded = Result.getOrThrow(method.input(args));
      reads.push(decoded);
      return [];
    } },
    [ContainerRegistrationKeys.LINK]: { async applyOperation(service: unknown, request: unknown) {
      mutations.push({ service, request });
      return { state: "applied" };
    } },
  };
  const port: WorkflowExecutionPort<unknown> = {
    checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
    context: { eventGroupId: "api-default-witness", container: { resolve<T>(name: string): T {
      if (!Object.hasOwn(bindings, name)) throw new Error("Unexpected native workflow resource");
      // SAFETY: this test-only native container binds the two resources selected
      // by this genuine prepared flow. The real method decoder owns its input.
      return bindings[name] as T;
    } } },
  };
  await Effect.runPromise(executeWorkflow(prepared, input, port));
  expect(reads).toEqual([{ filters: { id: [] }, config: { select: ["id"] } }]);
  expect(mutations).toHaveLength("remove" in input ? 1 : 0);
});
