import { expectTypeOf, it } from "vitest";
import type { ISalesChannelModuleService, SalesChannelDTO } from "@medusajs/types";
import type { SalesChannelModuleService } from "@medusajs/sales-channel/services";
import type { Resolved } from "@medusajs/workflows-sdk";
import type { updateSalesChannelsStep } from "@medusajs/core-flows/sales-channel/update-sales-channels-step";
import type { updateSalesChannelsWorkflow, UpdateSalesChannelsWorkflowOutput } from "@medusajs/core-flows/sales-channel/update-sales-channels";
import type { SalesChannelUpdateWorkflowOutput } from "../src/workflows/sales-channel/update";

it("declares native selector scalar absence through the service, step and workflow", () => {
  const interfaceSelector = (service: ISalesChannelModuleService) => service.updateSalesChannels({}, {});
  const interfaceId = (service: ISalesChannelModuleService) => service.updateSalesChannels("sc_typed", {});
  const implementationSelector = (service: SalesChannelModuleService) => service.updateSalesChannels({}, {});
  const implementationId = (service: SalesChannelModuleService) => service.updateSalesChannels("sc_typed", {});
  expectTypeOf<ReturnType<typeof interfaceSelector>>().toEqualTypeOf<Promise<SalesChannelDTO | undefined>>();
  expectTypeOf<ReturnType<typeof implementationSelector>>().toEqualTypeOf<Promise<SalesChannelDTO | undefined>>();
  expectTypeOf<ReturnType<typeof interfaceId>>().toEqualTypeOf<Promise<SalesChannelDTO>>();
  expectTypeOf<ReturnType<typeof implementationId>>().toEqualTypeOf<Promise<SalesChannelDTO>>();
  expectTypeOf<Resolved<ReturnType<typeof updateSalesChannelsStep>>>().toEqualTypeOf<SalesChannelDTO | undefined>();
  expectTypeOf<UpdateSalesChannelsWorkflowOutput>().toEqualTypeOf<SalesChannelDTO | undefined>();
  expectTypeOf<Resolved<ReturnType<typeof updateSalesChannelsWorkflow.runAsStep>>>()
    .toEqualTypeOf<SalesChannelDTO | undefined>();
  // The bounded adapter still refuses native absence and arrays before settlement.
  expectTypeOf<undefined>().not.toExtend<typeof SalesChannelUpdateWorkflowOutput.Type>();
  expectTypeOf<typeof SalesChannelUpdateWorkflowOutput.Type>().not.toExtend<readonly unknown[]>();
});
