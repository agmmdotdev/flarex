import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { orderedWorkflowIdEvents } from "../src/workflow/events";
import { EventPriority } from "@medusajs/utils/event-bus/utils";

const calls = { calls: () => [], results: () => [] };
const event = (data: Json, group = "group") => ({ contract: "shipping-option.updated", contractRevision: "a".repeat(64),
  producerRevision: "b".repeat(64), internal: false, group,
  message: { name: "shipping-option.updated", data, metadata: { eventGroupId: "group" } },
  subscribers: [{ id: "subscriber", revision: "c".repeat(64) }] });

describe("native workflow ID event shapes", () => {
  it("retains only the explicitly selected native critical priority", async () => {
    const selected = orderedWorkflowIdEvents("shipping-option.updated", () => Effect.succeed(["a"]), { criticalPriority: true });
    const ordinary = orderedWorkflowIdEvents("shipping-option.updated", () => Effect.succeed(["a"]));
    const contract = selected.contracts[0], strict = ordinary.contracts[0];
    if (contract === undefined || strict === undefined) throw new Error("Missing genuine event contract");
    const original = event({ id: "a" });
    const message = { ...original.message, options: { priority: EventPriority.CRITICAL } };
    expect(Result.getOrThrow(contract.decode(message))).toEqual(message);
    expect(Result.isFailure(strict.decode(message))).toBe(true);
    for (const refused of [original.message, { ...message, options: {} },
      { ...message, options: { priority: EventPriority.HIGH } },
      { ...message, options: { priority: String(EventPriority.CRITICAL) } },
      { ...message, options: { priority: EventPriority.CRITICAL, delay: 100 } }])
      expect(Result.isFailure(contract.decode(refused))).toBe(true);
    await Effect.runPromise(selected.validate([{ ...original, message }], calls));
    expect(await Effect.runPromise(Effect.result(selected.validate([{ ...original, group: "foreign", message }], calls))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });
  it("retains strict object IDs by default and admits string IDs only when selected", () => {
    const ordinary = orderedWorkflowIdEvents("shipping-option.updated", () => Effect.succeed(["a"]));
    const selected = orderedWorkflowIdEvents("shipping-option.updated", () => Effect.succeed(["a"]), { dataShape: "string", pendingCancellation: true });
    const object = event({ id: "a" }).message, scalar = event("a").message;
    expect(Result.isSuccess(ordinary.contracts[0]!.decode(object))).toBe(true);
    expect(Result.isFailure(ordinary.contracts[0]!.decode(scalar))).toBe(true);
    expect(Result.isSuccess(selected.contracts[0]!.decode(scalar))).toBe(true);
    expect(Result.isFailure(selected.contracts[0]!.decode(object))).toBe(true);
    expect(selected.contracts[0]!.pendingCancellation).toBe(true);
    expect(ordinary.contracts[0]!.pendingCancellation).toBeUndefined();
  });

  it("correlates native string ID order, count and event group", async () => {
    const selected = orderedWorkflowIdEvents("shipping-option.updated", () => Effect.succeed(["a", "b"]), { dataShape: "string" });
    await Effect.runPromise(selected.validate([event("a"), event("b")], calls));
    for (const messages of [[event("b"), event("a")], [event("a")], [event("a"), event("a")], [event("a", "other"), event("b")]])
      expect(await Effect.runPromise(Effect.result(selected.validate(messages, calls))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });
});
