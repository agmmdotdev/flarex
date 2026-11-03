import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { compilePromotionCoreDefinition } from "../../src/modules/promotion/schema";
import { createCoreNativeWorkflowFixture, type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";

export async function prepareCorePromotionFixture(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  initialCommands: CoreNativeWorkflowSource["initialCommands"]) {
  const definition = await Effect.runPromise(compilePromotionCoreDefinition({ scopeUuid: randomUUID(), epochUuid: randomUUID() }));
  const fixture = await createCoreNativeWorkflowFixture(driver, {
    sources: [{ name: "promotion", definition, initialCommands, rows: [] }],
  });
  close(fixture.close);
  return fixture;
}
