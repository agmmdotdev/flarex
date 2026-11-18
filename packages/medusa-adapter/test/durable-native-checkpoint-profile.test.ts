import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createStep, createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk/durable";
import { execution } from "@medusajs/workflows-sdk/testing/native-runtime";
import { decodeDurableNativeCheckpoint } from "../src/workflow/durable-native-storage";

const workflowId = "native-parent-metadata-proof";
const wait = createStep({ name: "native-parent-metadata-wait", async: true, timeout: 60 }, async () => {});
const workflow = createWorkflow<{ id: string }, { id: string }, []>(workflowId, input => { wait(); return new WorkflowResponse(input); });
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("explicit native parent checkpoint event identity", () => {
  it("pins actual parent metadata while leaving generic native checkpoint profiles unchanged", async () => {
    const env = execution();
    const transactionId = randomUUID(), input = { id: "native-parent" };
    await env.module.run(workflow, { transactionId, input, context: { eventGroupId: transactionId } });
    await env.drain();
    const key = `dtrx:${workflowId}:${transactionId}`;
    const actual = await env.storage.get(key);
    if (actual === undefined) throw new Error("Missing genuine native checkpoint");
    const identity = { workflowId, transactionId, expectedInput: input };
    expect(await Effect.runPromise(Effect.result(decodeDurableNativeCheckpoint(encode(actual),
      { ...identity, expectedEventGroupId: transactionId })))).toMatchObject({ _tag: "Success" });
    for (const metadata of [
      undefined,
      {},
      { eventGroupId: "another-parent" },
      { eventGroupId: transactionId, preventReleaseEvents: true },
      { eventGroupId: transactionId, preventReleaseEvents: "false" },
      { eventGroupId: transactionId, parentStepIdempotencyKey: "another-workflow:parent:step:invoke" },
      { eventGroupId: transactionId, cancelingFromParentStep: true },
    ]) {
      // Mutate only the genuine framework checkpoint's metadata in this pure
      // malformed-wire test. No core row/hash or business graph is fabricated.
      const checkpoint = await env.storage.get(key);
      if (checkpoint === undefined) throw new Error("Missing original native checkpoint");
      const malformedWire = { ...checkpoint, flow: { ...checkpoint.flow, metadata } };
      expect(await Effect.runPromise(Effect.result(decodeDurableNativeCheckpoint(encode(malformedWire),
        { ...identity, expectedEventGroupId: transactionId })))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      expect(await Effect.runPromise(Effect.result(decodeDurableNativeCheckpoint(encode(malformedWire), identity))))
        .toMatchObject({ _tag: "Success" });
    }
    actual.flow.metadata = { eventGroupId: transactionId, preventReleaseEvents: false, cancelingFromParentStep: false };
    expect(await Effect.runPromise(Effect.result(decodeDurableNativeCheckpoint(encode(actual),
      { ...identity, expectedEventGroupId: transactionId })))).toMatchObject({ _tag: "Success" });
  });
});
