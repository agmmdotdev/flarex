import { Effect } from "effect";
import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { makeCmsHost } from "../../../src/frameworks/cmsTransaction/host";
import { cmsError, type CmsTransactionError } from "../../../src/frameworks/cmsTransaction/model";
import type { IndexedPayloadFixture } from "./payloadIndexedFixture";
import type { PayloadVisibilityTarget } from "./payloadVisibilityScenario";

/** Persistence-only construction stays outside the shared native behavior vectors. */
export function fullProofPayloadVisibilityTarget(tested: IndexedPayloadFixture): PayloadVisibilityTarget<CmsTransactionError> {
  return { collection: "items", commands: inspectPayloadRuntimeForTest(tested.runtime).commands, host: tested.host,
    openHost: extra => makeCmsHost({ ...tested.input, commands: [...tested.input.commands, ...extra] }),
    inventory: Effect.tryPromise({ try: tested.inventory, catch: cause => cmsError("resourceFailure", cause) }) };
}
