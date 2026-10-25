import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { captureApiKeyMetadata } from "./schema";
import { prepareApiKeyModule } from "./module";
import { ApiKeyCreateRows, ApiKeyIds, decodeApiKeyCreation, decodeApiKeyIds } from "./contracts";
import { apiKeyCreationEventPolicy } from "./events";

const decodeCreationArguments = commerceDecoder(Schema.Tuple([ApiKeyCreateRows]), "invalidInput");
const decodeInverseArguments = commerceDecoder(Schema.Tuple([ApiKeyIds]), "invalidInput");

export const makeApiKeyCreationCommands = Effect.fn("ApiKeyAdapter.creationCommands")(function* () {
  const metadata = yield* captureApiKeyMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const { prepared, module } = yield* prepareApiKeyModule(metadata.frame, "creation");
    const commands = commerceServiceCommands(module.use);
    const prepare = commerceCommandPreparation("ApiKey.prepareCreation");
    const create = commands.write("apiKeyCreate", prepare(decodeApiKeyCreation), async ({ native, context, captureOutput }, rows) =>
      captureOutput(await native.createApiKeys(rows.map(row => ({ ...row })), context)));
    // This capability stays inside the trusted native workflow participant.
    // The returned direct command surface exposes creation only.
    const revertCreation = commands.write("apiKeyRevertCreation", prepare(decodeApiKeyIds), async ({ native, context }, ids) => {
      await native.revertCreatedApiKeys([...ids], context); return null;
    });
    const createApiKeys = yield* defineWorkflowMethod({ command: create,
      arguments: decodeCreationArguments, encode: ([rows]) => rows,
      output: prepared.contracts.output,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.API_KEY, objectName: "api_key", action: "created" })] });
    const revertCreatedApiKeys = yield* defineWorkflowMethod({ command: revertCreation,
      arguments: decodeInverseArguments, encode: ([ids]) => ids,
      output: commerceDecoder(Schema.Null, "storedCorruption"),
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.API_KEY, objectName: "api_key", action: "deleted" })] });
    const workflow = yield* defineWorkflowModule({ name: Modules.API_KEY, source: module.description,
      methods: { createApiKeys, revertCreatedApiKeys }, graph: { aliases: [], reads: [] },
      logical: { ...apiKeyCreationEventPolicy(prepared.contracts), commands: [create, revertCreation] } });
    return { create, commands: [create], workflow };
  }));
});
