import { describe, expect, inject, it } from "vitest";
import { Schema } from "effect";
import { ApiKeyModuleService } from "@medusajs/api-key/services";
import { ApiKey } from "@medusajs/api-key/models";
import { apiKeyModuleExports, apiKeyModuleModels, apiKeyStaticResources } from "@medusajs/api-key/static-manifest";
import { SalesChannelModuleService } from "@medusajs/sales-channel/services";
import { LinkService, getModuleService, PublishableApiKeySalesChannel, LinkOperationStore,
  LinkOperationRequestSchema, linkWorkflowModels } from "@medusajs/link-modules";
import { createWorkflow } from "@medusajs/workflows-sdk";
import { executeWorkflow } from "@medusajs/workflows-sdk/native";
import { createApiKeysWorkflow } from "@medusajs/core-flows/api-key/create-api-keys";
import { updateApiKeysWorkflow } from "@medusajs/core-flows/api-key/update-api-keys";
import { revokeApiKeysWorkflow } from "@medusajs/core-flows/api-key/revoke-api-keys";
import { deleteApiKeysWorkflow } from "@medusajs/core-flows/api-key/delete-api-keys";
import { linkSalesChannelsToApiKeyWorkflow } from "@medusajs/core-flows/api-key/link-sales-channels-to-publishable-key";
import { NativeSourceEvidenceSchema } from "./support/native-stock-sales-source-provenance";
import { nativeApiKeySourceTargets } from "./support/native-api-key-source-provenance";

const decodeEvidence = Schema.decodeUnknownSync(NativeSourceEvidenceSchema);
const nativeLinkModule = getModuleService(PublishableApiKeySalesChannel);
const loaded = new Map<string, unknown>([
  ["API Key service", ApiKeyModuleService], ["API Key model", ApiKey], ["API Key static resources", apiKeyStaticResources],
  ["Sales Channel service", SalesChannelModuleService], ["Link root", getModuleService], ["Link row service", LinkService],
  ["Link module service", nativeLinkModule], ["Link operation service", nativeLinkModule.prototype.applyOperation],
  ["Link operation store", LinkOperationStore], ["Link operation contracts", LinkOperationRequestSchema],
  ["Link protocol model selection", linkWorkflowModels], ["Link operation model", linkWorkflowModels[0]],
  ["Link pair-revision model", linkWorkflowModels[1]], ["Native SDK definition", createWorkflow], ["Native SDK execution", executeWorkflow],
  ["Create API Keys workflow", createApiKeysWorkflow], ["Update API Keys workflow", updateApiKeysWorkflow],
  ["Revoke API Keys workflow", revokeApiKeysWorkflow], ["Delete API Keys workflow", deleteApiKeysWorkflow],
  ["Associate Sales Channels workflow", linkSalesChannelsToApiKeyWorkflow],
]);

/** The proof suffix keeps this Source-only lane out of default discovery. */
describe("API Key native Source execution provenance", () => {
  it.each(nativeApiKeySourceTargets)("loads the promoted $name implementation", target => {
    const evidence = decodeEvidence(inject("nativeApiKeySource"));
    expect(evidence.entries).toHaveLength(nativeApiKeySourceTargets.length);
    expect(evidence.entries.filter(entry => entry.name === target.name)).toMatchObject([{
      specifier: target.specifier, entry: target.entry, leaf: target.leaf, external: false,
    }]);
    expect(loaded.get(target.name)).toBeDefined();
    expect(apiKeyModuleExports.service).toBe(ApiKeyModuleService);
    expect(apiKeyStaticResources.moduleService).toBe(ApiKeyModuleService);
    expect(apiKeyModuleModels).toEqual([ApiKey]);
    expect(linkWorkflowModels).toHaveLength(2);
    expect(typeof nativeLinkModule.prototype.applyOperation).toBe("function");
    expect(typeof nativeLinkModule.prototype.compensateOperation).toBe("function");
  });
});
