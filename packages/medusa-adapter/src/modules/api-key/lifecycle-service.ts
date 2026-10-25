import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { nativePreimageSelection } from "../../workflow/preimage";
import { commerceDecoder } from "../../value/decoder";
import { captureApiKeyMetadata } from "./schema";
import { prepareApiKeyModule } from "./module";
import { ApiKeyIds } from "./contracts";
import { ApiKeyPreimageConfig, ApiKeyPreimageInput, ApiKeyRetainedTitles, ApiKeyRevokeData,
  ApiKeyRevokeInput, ApiKeySelector, ApiKeyTitleUpdate, ApiKeyUpdateInput } from "./lifecycle-input";
import { apiKeyLifecycleEventPolicy } from "./lifecycle-receipt";

const decodeListArgs = commerceDecoder(Schema.Tuple([ApiKeySelector, ApiKeyPreimageConfig]), "invalidInput");
const decodeUpdateArgs = commerceDecoder(Schema.Tuple([ApiKeySelector, ApiKeyTitleUpdate]), "invalidInput");
const decodeRevokeArgs = commerceDecoder(Schema.Tuple([ApiKeySelector, ApiKeyRevokeData]), "invalidInput");
const decodeUpsertArgs = commerceDecoder(Schema.Tuple([ApiKeyRetainedTitles]), "invalidInput");
const decodeDeleteArgs = commerceDecoder(Schema.Tuple([ApiKeyIds]), "invalidInput");

/** Retained title restoration is workflow-only. Creation compensation and
 * authentication are absent from this explicitly separate native profile. */
export const makeApiKeyLifecycleCommands = Effect.fn("ApiKeyAdapter.lifecycleCommands")(function* () {
  const metadata = yield* captureApiKeyMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const { module, prepared } = yield* prepareApiKeyModule(metadata.frame, "lifecycle");
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("ApiKey.prepareLifecycle");
    const list = commands.read("apiKeyListPreimages", prepare(commerceDecoder(ApiKeyPreimageInput, "invalidInput")),
      async ({ native, context, capturePreimages }, input) => capturePreimages(await native.listApiKeys(input.filters, input.config, context)));
    const update = commands.write("apiKeyUpdate", prepare(commerceDecoder(ApiKeyUpdateInput, "invalidInput")),
      async ({ native, context, captureOutput }, input) => captureOutput(await native.updateApiKeys(input.selector, input.update, context)));
    const restoreTitles = commands.write("apiKeyRestoreTitles", prepare(commerceDecoder(ApiKeyRetainedTitles, "invalidInput")),
      async ({ native, context, captureStored }, input) => {
        await captureStored(await native.upsertApiKeys(input.map(row => ({ ...row })), context));
        return null;
      });
    const revoke = commands.write("apiKeyRevoke", prepare(commerceDecoder(ApiKeyRevokeInput, "invalidInput")),
      async ({ native, context, captureOutput }, input) => captureOutput(await native.revoke(input.selector, input.revoke, context)));
    const remove = commands.write("apiKeyDelete", prepare(commerceDecoder(ApiKeyIds, "invalidInput")), async ({ native, context }, ids) => {
      await native.deleteApiKeys([...ids], context); return null;
    });
    const event = (action: "updated" | "deleted") => [buildModuleResourceEventName({ prefix: Modules.API_KEY, objectName: "api_key", action })];
    const listApiKeys = yield* defineWorkflowMethod({ command: list, arguments: decodeListArgs,
      encode: ([filters, config]) => ({ filters, config: nativePreimageSelection(config, { table: prepared.readTable, paths: [] }) }),
      output: prepared.contracts.preimages });
    const updateApiKeys = yield* defineWorkflowMethod({ command: update, arguments: decodeUpdateArgs,
      encode: ([selector, update]) => ({ selector, update }), output: prepared.contracts.output, moduleEvents: event("updated") });
    const upsertApiKeys = yield* defineWorkflowMethod({ command: restoreTitles, arguments: decodeUpsertArgs,
      encode: ([rows]) => rows, output: commerceDecoder(Schema.Null, "storedCorruption"), moduleEvents: event("updated") });
    const revokeApiKeys = yield* defineWorkflowMethod({ command: revoke, arguments: decodeRevokeArgs,
      encode: ([selector, revoke]) => ({ selector, revoke }), output: prepared.contracts.output, moduleEvents: event("updated") });
    const deleteApiKeys = yield* defineWorkflowMethod({ command: remove, arguments: decodeDeleteArgs,
      encode: ([ids]) => ids, output: commerceDecoder(Schema.Null, "storedCorruption"), moduleEvents: event("deleted") });
    const workflow = yield* defineWorkflowModule({ name: Modules.API_KEY, source: module.description,
      methods: { listApiKeys, updateApiKeys, upsertApiKeys, revoke: revokeApiKeys, deleteApiKeys }, graph: { aliases: [], reads: [] },
      logical: { ...apiKeyLifecycleEventPolicy(prepared), commands: [list, update, restoreTitles, revoke, remove] } });
    return { update, revoke, delete: remove, workflow, commands: [update, revoke, remove] };
  }));
});
