import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName, isDefined } from "@medusajs/framework/utils/portable";
import { prepareTaxRegionInputForCreate } from "@medusajs/tax/services";
import { isJsonObject, jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlatePhysicalGraphReceipt } from "../../repository/physical-graph-receipt";
import { correlateScalarCreateReceipt, correlateScalarCreateWrites } from "../../repository/scalar-create-receipt";
import { projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { moduleEventDecoder } from "../../module/events";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { TaxId } from "./query";
import { prepareTaxRegionParentRepository } from "./region-create-query";
import type { compileTaxRegionCreationContracts } from "./region-create-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileTaxRegionCreationContracts>>;
const decodePrepared = commerceDecoder(Schema.Struct({ regionData: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)),
  defaultRates: Schema.Array(Schema.NullOr(Schema.JsonObject)).check(Schema.isMaxLength(4)) }), "receiptMismatch");
const decodeRules = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)), "receiptMismatch");
const decodeParents = commerceDecoder(Schema.Array(Schema.NullOr(TaxId)).check(Schema.isMaxLength(4)), "receiptMismatch");
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.TAX), object: Schema.Literals(["tax_region", "tax_rate", "tax_rate_rule"]),
    action: Schema.Literals(["created", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([TaxId, Schema.Array(TaxId).check(Schema.isLengthBetween(1, 8))]) }),
}), defaultCommerceResources);

/** Bind native Region preparation and positional nested creates to complete
 * writes, exact parent selection and checkpoint target observations. Native
 * pure normalization is reused without repeating service calls or FK checks. */
export function taxRegionCreationPolicy(contracts: Contracts) {
  const parentRepository = prepareTaxRegionParentRepository(contracts.region);
  const capture = Effect.fn("TaxRegion.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.TAX, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("TaxRegion.validateCreationCall")(function* (call, activity) {
    const creating = call.commandName === "taxRegionCreateForWorkflow";
    if ((!creating && call.commandName !== "taxRegionPhysicalDeleteForWorkflow") || call.mode !== "write" ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length ||
      !creating && activity.mutations.some(mutation => mutation.realNormalization !== undefined) ||
      call.fromAttempt !== 0 || call.toAttempt !== activity.mutations.length || call.fromLifecycle !== 0 || call.toLifecycle !== 0)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const expectedEvents: Array<{ readonly object: "tax_region" | "tax_rate" | "tax_rate_rule"; readonly id: string }> = [];
    if (creating) {
      const inputs = yield* Effect.fromResult(contracts.decodeInput(call.input));
      const results = yield* Effect.fromResult(contracts.decodeOutput(call.result));
      // This is a narrow foreign pure-function boundary: a native throw means
      // this claimed successful receipt cannot follow the original preparation.
      const nativePrepared = yield* Effect.fromResult(Result.try({ try: (): unknown => Reflect.apply(prepareTaxRegionInputForCreate, undefined, [inputs]),
        catch: cause => commerceError("receiptMismatch", cause) }));
      const prepared = yield* Effect.fromResult(captureCommerceInput(nativePrepared).pipe(Result.flatMap(decodePrepared)));
      const regions = yield* Effect.fromResult(correlateScalarCreateReceipt(prepared.regionData, results));
      const decoded: Array<JsonObject & { readonly id: string }> = [];
      for (const mutation of activity.mutations) {
        const decode = mutation.table === contracts.region.name ? contracts.decodeRegionRow : mutation.table === contracts.rate.name ? contracts.decodeRateRow
          : mutation.table === contracts.rule.name ? contracts.decodeRuleRow : undefined;
        if (decode === undefined || mutation.after === null) return yield* Effect.fail(commerceError("receiptMismatch"));
        decoded.push(yield* Effect.fromResult(decode(projectNativeRow(mutation.after))));
      }
      const rateRows = decoded.filter((_, index) => activity.mutations[index]?.table === contracts.rate.name);
      const ruleRows = decoded.filter((_, index) => activity.mutations[index]?.table === contracts.rule.name);
      if (regions.inputs.length > 4 || rateRows.length > 4 || ruleRows.length > 8)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const inserted = new Map<string, JsonObject>();
      const check = Effect.fn("TaxRegion.authenticateInsert")(function* (
        ordinal: number, table: string, expected: JsonObject, object: "tax_region" | "tax_rate" | "tax_rate_rule",
      ) {
        const mutation = activity.mutations[ordinal], stored = decoded[ordinal];
        if (mutation === undefined || stored === undefined || mutation.ordinal !== ordinal || mutation.operation !== "insert" ||
          mutation.table !== table || mutation.before !== null || mutation.after === null ||
          mutation.realNormalization !== undefined && (table !== contracts.rate.name || Object.keys(mutation.realNormalization).some(field => field !== "rate")))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const identity = table + ":" + stored.id;
        if (inserted.has(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
        const presented = { ...stored, ...mutation.realNormalization };
        for (const [field, value] of Object.entries(expected)) if (presented[field] === undefined || !jsonEqual(presented[field], value))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        inserted.set(identity, stored); expectedEvents.push({ object, id: stored.id });
        return stored;
      });
      const providerIds = new Set<string>();
      for (const [ordinal, input] of regions.inputs.entries()) {
        const output = regions.results[ordinal];
        if (output === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
        const stored = yield* check(ordinal, contracts.region.name, { ...contracts.regionDefaults, deleted_at: null, ...input }, "tax_region");
        const presented: Record<string, Json> = { ...stored, children: [], tax_rates: [] };
        for (const relation of contracts.region.relationships) if (relation.type === "belongsTo" && relation.nullable)
          for (const name of relation.foreignKeyNames ?? []) if (input[name] === undefined) delete presented[name];
        if (!jsonEqual(presented, output)) return yield* Effect.fail(commerceError("receiptMismatch"));
        if (typeof stored.provider_id === "string") providerIds.add(stored.provider_id);
      }
      const rateInputs: JsonObject[] = [];
      for (const [index, rate] of prepared.defaultRates.entries()) {
        const region = results[index];
        if (region === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
        if (rate !== null) rateInputs.push({ ...rate, tax_region_id: region.id });
      }
      const rates = yield* Effect.fromResult(correlateScalarCreateWrites(rateInputs.map(({ rules: _rules, ...scalar }) => scalar), rateRows));
      for (const [index, input] of rates.inputs.entries()) yield* check(regions.inputs.length + index, contracts.rate.name,
        { ...contracts.rateDefaults, deleted_at: null, ...input }, "tax_rate");
      const ruleInputs: JsonObject[] = [];
      for (const [index, rate] of rateInputs.entries()) {
        const position = rates.positions[index], canonical = position === undefined ? undefined : rates.inputs[position], parent = position === undefined ? undefined : rates.results[position];
        if (canonical === undefined || parent === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
        if (rate.rules === undefined) continue;
        for (const rule of yield* Effect.fromResult(decodeRules(rate.rules))) {
          const canonicalInput = yield* Effect.fromResult(captureCommerceInput({ ...rule, created_by: canonical.created_by, tax_rate_id: parent.id }));
          if (!isJsonObject(canonicalInput))
            return yield* Effect.fail(commerceError("receiptMismatch"));
          ruleInputs.push(canonicalInput);
        }
      }
      const rules = yield* Effect.fromResult(correlateScalarCreateWrites(ruleInputs, ruleRows));
      for (const [index, input] of rules.inputs.entries()) yield* check(regions.inputs.length + rates.inputs.length + index, contracts.rule.name,
        { ...contracts.ruleDefaults, deleted_at: null, ...input }, "tax_rate_rule");
      if (inserted.size !== activity.mutations.length) return yield* Effect.fail(commerceError("receiptMismatch"));

      const parentIds = yield* Effect.fromResult(decodeParents(prepared.regionData.map(region => region.parent_id).filter(isDefined)));
      const parents = new Map<string, JsonObject>(), seen = new Set<string>(), providers = new Map<string, JsonObject>();
      for (const observation of activity.observedRows) {
        const identity = observation.table + ":" + observation.row.id, own = inserted.get(identity);
        if (own !== undefined) {
          if (!jsonEqual(own, projectNativeRow(observation.row))) return yield* Effect.fail(commerceError("receiptMismatch"));
          seen.add(identity); continue;
        }
        if (observation.table === contracts.provider.name) {
          const provider = yield* Effect.fromResult(contracts.decodeProviderRow(projectNativeRow(observation.row)));
          const prior = providers.get(provider.id);
          if (!providerIds.has(provider.id) || prior !== undefined && !jsonEqual(prior, provider)) return yield* Effect.fail(commerceError("receiptMismatch"));
          providers.set(provider.id, provider);
        } else if (observation.table === contracts.region.name) {
          const parent = yield* Effect.fromResult(contracts.decodeRegionRow(projectNativeRow(observation.row))), prior = parents.get(parent.id);
          if (!parentIds.includes(parent.id) || parent.deleted_at !== null || prior !== undefined && !jsonEqual(prior, parent))
            return yield* Effect.fail(commerceError("receiptMismatch"));
          parents.set(parent.id, parent);
        } else return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (seen.size !== inserted.size || providers.size !== providerIds.size || parents.size !== new Set(parentIds).size)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const region of prepared.regionData) if (isDefined(region.parent_id)) {
        const parent = typeof region.parent_id === "string" ? parents.get(region.parent_id) : undefined;
        if (parent === undefined || parent.country_code !== region.country_code) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (parentIds.length) {
        const parent = yield* Effect.fromResult(parentRepository), selection = yield* Effect.fromResult(parent.parentQueryForIds(parentIds));
        const expected = [{ table: contracts.region.name, query: commerceRelationReadQuery(defaultCommerceResources, selection.query.predicate), total: parents.size, returned: parents.size }];
        if (!jsonEqual(expected, activity.relationalReads)) return yield* Effect.fail(commerceError("receiptMismatch"));
      } else if (activity.relationalReads.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    } else {
      if (call.result !== null) return yield* Effect.fail(commerceError("receiptMismatch"));
      const requestedIds = yield* Effect.fromResult(contracts.decodePhysicalIds(call.input));
      const ids = yield* Effect.fromResult(correlatePhysicalGraphReceipt({ tables: contracts.tables, entities: contracts.entities,
        root: contracts.region, rootOrder: "storageInsertion", rootMutationOrder: "dependencies", requestedIds, activity }));
      expectedEvents.push(...ids.map(id => ({ object: "tax_region" as const, id })));
    }
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.action !== (creating ? "created" : "deleted")) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const expected = expectedEvents[emitted++];
        if (expected?.id !== id || expected?.object !== message.metadata.object) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(commerceError("receiptMismatch"));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture, validateLogicalCall, allowStorageInsertionOrder: true as const, allowReferenceCheckpoints: true as const,
    insertValidation: "entityBatch" as const };
}
