import { Effect } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError } from "../../../persistence-postgres/src/frameworks/commerceTransaction/model";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";

/** Arrange an authorized native hard delete independently of read visibility.
 * The actual Product service, native receipts and shared publisher decide it. */
export async function privatePayloadReverseDelete(fixture: PrivatePayloadSaveFixture, productId: string) {
  const runtime = fixture.productRuntime, logicalStorage = fixture.productHostInput.logicalStorage;
  if (logicalStorage === undefined) throw new Error("Missing native logical Product selection");
  const revision = "4".repeat(64), name = runtime.metadata.product.deletedEvent;
  const contract = defineCommerceEventContract({ name, revision, internal: true, decode: runtime.logicalPolicy.capture });
  const participant = defineAtomicCommerceParticipant("product");
  const command = runtime.commands.delete;
  const root = defineAtomicCommerceCommand("privateReverseProductDelete", (ctx, args) => ctx.call(participant, command, args));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.productHostInput,
    identityAndAccessPolicy: { profile: "private-reverse-product-delete" },
    participants: [{ participant, logicalStorage, commands: [command], validateLogicalCall: runtime.logicalPolicy.validateLogicalCall,
      events: { contracts: [contract], select: event => isJsonObject(event) && event.name === name ? Effect.succeed(contract) : Effect.fail(commerceError("unadmittedEvent")) } }],
    commands: [root], events: { producerRevision: revision, contracts: [contract], subscribers: [{ id: "private-reverse-product-delete", revision }],
      validate: events => events.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return Effect.runPromise(host.run(host.newRequestKey(), root, productId).pipe(Effect.result, Effect.ensuring(host.close)));
}
