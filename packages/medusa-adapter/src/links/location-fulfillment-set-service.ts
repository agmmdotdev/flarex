import { Effect, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { LocationFulfillmentSet } from "@medusajs/link-modules";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureLocationFulfillmentSetLinkMetadata } from "./location-fulfillment-set-schema";
import { prepareLinkService } from "./service";
import { prepareLinkWorkflowService, linkWorkflowServiceDefinition } from "./workflow-service";
import { linkLogicalEventPolicy } from "./events";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { defineWorkflowModule } from "../workflow/module";
import { commerceDecoder } from "../value/decoder";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Pair = Schema.Struct({ stock_location: Schema.Struct({ stock_location_id: Id }),
  fulfillment: Schema.Struct({ fulfillment_set_id: Id }) });
const Pairs = Schema.Array(Pair).pipe(Schema.mutable).check(Schema.isMaxLength(1));
const decodeArguments = commerceDecoder(Schema.Tuple([Pairs]), "invalidInput");
const decodeOutput = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: Id, stock_location_id: Id, fulfillment_set_id: Id,
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(1)), "storedCorruption");

/** Creation does not traverse endpoint services. Its genuine router retains
 * cardinality validation, native pair upsert and actual dismissal callbacks. */
export function prepareLocationFulfillmentSetCreationLinkResource(service: unknown) {
  return Result.gen(function* () {
    const native = linkWorkflowServiceDefinition(service);
    if (native === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    if (native.admission !== "dismiss" || native.routing.__joinerConfig.serviceName !== LocationFulfillmentSet.serviceName
      || native.dismissMethod === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const create = native.createMethod, list = native.listMethod, dismiss = native.dismissMethod;
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.location-fulfillment-set.creation-links", services: [native.routing] },
      dependencies: [create, list, dismiss], methods: {
        create: { arguments: decodeArguments, output: decodeOutput }, dismiss: { arguments: decodeArguments, output: decodeOutput },
      }, bind: invoke => {
        const loaded = { ...structuredClone(native.routing),
          create: (bulk: unknown) => invoke(create, bulk),
          list: (filters: unknown, config: unknown) => invoke(list, filters, config),
          dismiss: (pairs: unknown) => invoke(dismiss, pairs) };
        const router = new Link([loaded]);
        return { create: pairs => router.create(structuredClone(pairs)), dismiss: pairs => router.dismiss(structuredClone(pairs)) };
      },
    });
  });
}

export const prepareLocationFulfillmentSetLink = Effect.fn("LocationFulfillmentSetLink.prepare")(function* () {
  const prepared = yield* prepareLinkService(yield* captureLocationFulfillmentSetLinkMetadata(), 8, true);
  const nativeService = yield* Effect.fromResult(prepareLinkWorkflowService(prepared, "locationFulfillmentSetLink", "dismiss"));
  if (nativeService.dismiss === undefined || nativeService.dismissName === undefined || nativeService.dismissMethod === undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const commands = [nativeService.create, nativeService.list, nativeService.dismiss];
  const dismissName = nativeService.dismissName;
  const logicalEventPolicy = () => linkLogicalEventPolicy(prepared.prepared.table.name, prepared.serviceName, prepared.entityName,
    ["stock_location_id", "fulfillment_set_id"], [nativeService.createName], [dismissName]);
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "location_fulfillment_set_creation_links",
    source: { name: prepared.serviceName, profile: "location-fulfillment-set-creation" }, graph: { aliases: [], reads: [] },
    methods: { create: nativeService.createMethod, list: nativeService.listMethod, dismiss: nativeService.dismissMethod },
    logical: { ...logicalEventPolicy(), commands } }));
  const resource = yield* Effect.fromResult(prepareLocationFulfillmentSetCreationLinkResource(nativeService));
  return { workflow, commands, logicalEventPolicy, nativeService, resource };
});
