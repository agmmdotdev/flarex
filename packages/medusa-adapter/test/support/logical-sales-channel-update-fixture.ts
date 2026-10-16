import { createHash } from "node:crypto";
import { Effect } from "effect";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { prepareSalesChannelUpdateWorkflow } from "../../src/workflows/sales-channel/update";
import { prepareLogicalSalesChannelCreation } from "./logical-sales-channel-creation-fixture";

/** Reuse creation's genuine source, initialization, read host and execution.
 * Seed cleanup invokes the existing native module delete command, not SQL. */
export async function prepareLogicalSalesChannelUpdate(
  driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  shared?: Parameters<typeof prepareLogicalSalesChannelCreation>[2],
) {
  const creation = await prepareLogicalSalesChannelCreation(driver, registerCleanup, shared);
  const participant = defineAtomicCommerceParticipant("sales_channel");
  const policy = creation.sales.runtime.logicalEventPolicy();
  const deletedName = buildModuleResourceEventName({ prefix: Modules.SALES_CHANNEL,
    objectName: "sales_channel", action: "deleted" });
  const revision = createHash("sha256").update("native-sales-channel-update-cleanup-111").digest("hex");
  const deleted = defineCommerceEventContract({ name: deletedName, revision, internal: true, decode: policy.capture });
  const removeChannels = defineAtomicCommerceCommand("removeUpdateWorkflowSalesChannels", (ctx, input) =>
    ctx.call(participant, creation.sales.runtime.delete, input));
  const cleanupHost = await Effect.runPromise(creation.execution.prepare({
    identityAndAccessPolicy: { profile: "native-sales-channel-update-cleanup" },
    participants: [{ participant, logicalStorage: creation.sales.hostInput.logicalStorage,
      commands: [creation.sales.runtime.delete], validateLogicalCall: policy.validateLogicalCall,
      events: { contracts: [deleted], select: message => isJsonObject(message) && message.name === deletedName
        ? Effect.succeed(deleted) : Effect.fail(commerceError("unadmittedEvent")) } }],
    commands: [removeChannels], events: { producerRevision: revision, contracts: [deleted],
      subscribers: [{ id: "native-sales-channel-update-cleanup", revision: "c".repeat(64) }],
      validate: events => events.some(event => !event.internal || event.contract !== deletedName)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  registerCleanup(() => Effect.runPromise(cleanupHost.close));
  const options: Parameters<typeof prepareSalesChannelUpdateWorkflow>[0] = {
    execution: creation.execution,
    modules: { sales_channel: { module: creation.sales.runtime.updateWorkflow, logicalStorage: creation.sales.hostInput.logicalStorage } },
    revision: createHash("sha256").update("native-sales-channel-update-111").digest("hex"),
    subscribers: [{ id: "native-sales-channel-update", revision: "d".repeat(64) }],
  };
  const prepareUpdate = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareSalesChannelUpdateWorkflow({ ...options, revision }));
    registerCleanup(() => Effect.runPromise(host.close));
    return host;
  };
  const seed = async (prefix: string, count = 1) => {
    const host = await creation.prepare();
    const entries = Array.from({ length: count }, (_, index) => ({ id: prefix + "-" + index,
      name: prefix, description: "Original " + index, is_disabled: false,
      metadata: { keep: "row-" + index, drop: "old", nested: { before: index } } }));
    for (let offset = 0; offset < entries.length; offset += 4)
      await Effect.runPromise(host.run(host.newRequestKey(), { salesChannelsData: entries.slice(offset, offset + 4) }));
    return entries.map(row => row.id);
  };
  const remove = (ids: readonly string[]) => ids.length === 0 ? Effect.void : cleanupHost.run(
    cleanupHost.newRequestKey(), removeChannels, [...ids]).pipe(Effect.asVoid);
  return { ...creation, prepareUpdate, seed, remove };
}
