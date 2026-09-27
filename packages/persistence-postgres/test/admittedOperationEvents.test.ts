import { Effect } from "effect";
import { expect, it } from "vitest";
import { captureAtomicCommerceEvents, defineCommerceEventContract,
  prepareAtomicCommerceEvents, validateAdmittedCommerceEventIntents,
  validateAdmittedOperationEventIntents } from "../src/atomicCommerce/events";
import type { CommittedEvent } from "../src/commitEvents/model";

it("binds operation events to the exact selected contract and internal flag", async () => {
  const revision = "a".repeat(64);
  const subscribers = [{ id: "subscriber", revision }];
  const selected = defineCommerceEventContract({ name: "workflow.selected", revision,
    internal: false, decode: () => Effect.succeed({ id: "one" }) });
  const other = defineCommerceEventContract({ name: "workflow.other", revision,
    internal: false, decode: () => Effect.succeed({ id: "one" }) });
  const module = defineCommerceEventContract({ name: "module.selected", revision,
    internal: true, decode: () => Effect.succeed({ id: "one" }) });
  const policy = await Effect.runPromise(Effect.fromResult(captureAtomicCommerceEvents({
    producerRevision: revision, contracts: [selected, other, module], subscribers,
    validate: () => Effect.void,
  })).pipe(Effect.flatMap(prepareAtomicCommerceEvents)));
  const selection = { contracts: [selected], select: () => Effect.succeed(selected) };
  const envelope: CommittedEvent = { contract: "workflow.selected", contractRevision: revision,
    producerRevision: revision, internal: false, group: "test-group", message: { id: "one" }, subscribers };
  await expect(Effect.runPromise(validateAdmittedOperationEventIntents(policy, selection,
    [envelope], "test-group"))).resolves.toBeUndefined();
  await expect(Effect.runPromise(validateAdmittedOperationEventIntents(policy, selection,
    [{ ...envelope, internal: true }], "test-group"))).rejects.toMatchObject({ reason: "unadmittedEvent" });
  await expect(Effect.runPromise(validateAdmittedOperationEventIntents(policy, selection,
    [{ ...envelope, contract: "workflow.other" }], "test-group"))).rejects.toMatchObject({ reason: "unadmittedEvent" });
  await expect(Effect.runPromise(validateAdmittedCommerceEventIntents(policy, selection,
    [envelope], "test-group"))).rejects.toMatchObject({ reason: "invalidAuthority" });
});
