import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { projectNativeRow } from "../../repository/result";
import { replaceGraphRows } from "../../write/replace";
import type { GraphCatalog, ReplacementProfile } from "../../write/graph-model";
import type { commerceMutationEvents } from "../../repository/mutation-events";
import { compileFulfillmentShipmentContracts, FulfillmentShipmentLabel, FulfillmentGraphUpdate, decodeFulfillmentShipmentUpdate,
  fulfillmentUpdateMutableFields, fulfillmentUpdateChangedFields } from "./fulfillment-shipment-input";
import { assignFulfillmentJson, decodeFulfillmentAssignmentPrior } from "./fulfillment-create-value-profile";
import { FulfillmentCreationId, type compileFulfillmentCreationContracts } from "./fulfillment-create-input";
import { prepareFulfillmentShipmentQuery, type FulfillmentNativeHydration } from "./fulfillment-shipment-query";

type Contracts = Result.Result.Success<ReturnType<typeof compileFulfillmentCreationContracts>>;
const rootInput = commerceDecoder(Schema.Struct({ id: FulfillmentCreationId, ...FulfillmentGraphUpdate.fields }), "invalidInput");
const childInput = commerceDecoder(FulfillmentShipmentLabel, "invalidInput");

/** The genuine module already performed Label normalization and internal
 * hydration. This owner translates its checked DAL pair to shared graph writes. */
export function prepareFulfillmentShipmentRepository(contracts: Contracts) {
  return Result.gen(function* () {
    const values = yield* compileFulfillmentShipmentContracts(contracts), reads = yield* prepareFulfillmentShipmentQuery(contracts);
    const entity = (value: Contracts["fulfillment"]) => ({ table: value.table, model: value.model, keyColumn: "id",
      prefix: value.table.columns.find(column => column.name === "id")?.options?.prefix });
    const fulfillment = entity(contracts.fulfillment), label = entity(contracts.label), item = entity(contracts.item);
    const catalog: GraphCatalog = { entities: [fulfillment, label, item], tables: contracts.tables, writablePivots: [], queryRelations: contracts.queryRelations,
      decodeRow: (target, input) => Result.gen(function* () {
        const row = target === fulfillment ? yield* rootInput(input) : target === label ? yield* childInput(input)
          : yield* Result.fail(commerceError("unsupportedProfile"));
        return { supplied: row, key: row.id };
      }), decodeReference: () => Result.fail(commerceError("unsupportedProfile")), decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")) };
    const profile: ReplacementProfile = { catalog, operation: "update", ordering: reads.ordering, emptyCollections: "replace", replacementMembers: "active", allowReconstitution: true,
      repeatedOwnedReferences: "coalesceIdentical",
      ownedChildUpdatedAt: "managed",
      allowedRelations: target => target === fulfillment ? ["labels"] : [], ownedToOne: () => [], mutableForeignKeys: () => false,
      admitSelection: (table, rows) => reads.admitSelection(table.name, rows), prepareProjection: () => Effect.void,
      toManyMode: (target, name, child) => target === fulfillment && name === "labels" && child === label ? Result.succeed("replace") : Result.fail(commerceError("unsupportedProfile")),
      validateLink: () => Effect.fail(commerceError("unsupportedProfile")), projectionPaths: () => ["items", "labels"],
      project: rows => Result.succeed(new Map([...rows].map(([table, members]) => [table, members.filter(row => row.deleted_at === null)]))) };
    const update = Effect.fn("FulfillmentShipment.update")(function* (ctx: CommerceCommandContext, pair: { readonly entity: JsonObject; readonly update: JsonObject },
      events: ReturnType<typeof commerceMutationEvents>, shared: Parameters<DAL.RepositoryService["update"]>[1], original: JsonObject,
      hydration: FulfillmentNativeHydration) {
      if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
      const before = yield* Effect.fromResult(contracts.decodeOutput(pair.entity)), { id, ...raw } = pair.update;
      if (typeof id !== "string" || id !== before.id) return yield* ctx.refuse(commerceError("invalidInput"));
      if (original.id !== id) return yield* ctx.refuse(commerceError("invalidInput"));
      if (hydration.id !== id || hydration.dirtyReferences.some(reference => original[reference.column] !== reference.key ||
        !contracts.referenceFields.some(field => field.nativeKind === "hasOneWithFK" && field.column === reference.column)))
        return yield* ctx.refuse(commerceError("invalidInput"));
      if (Object.hasOwn(raw, "metadata")) yield* Effect.fromResult(decodeFulfillmentAssignmentPrior(original.metadata ?? null));
      const decoded = yield* Effect.fromResult(decodeFulfillmentShipmentUpdate(raw)),
        request = yield* Effect.fromResult(fulfillmentUpdateMutableFields(before, decoded));
      const labels = request.labels;
      // Native ORM dirty tracking omits equal scalar assignments. Labels have
      // their own shared child dirty tracking and native event contribution.
      const normalized = { ...Object.fromEntries(Object.entries(request).filter(([name]) => name !== "labels")),
        ...(request.data === undefined ? {} : { data: yield* Effect.fromResult(assignFulfillmentJson(before.data, request.data)) }),
        ...(request.metadata !== undefined && request.metadata !== null && Object.keys(request.metadata).length === 0
          ? { metadata: yield* Effect.fromResult(assignFulfillmentJson(before.metadata, request.metadata)) } : {}) };
      const scalar = fulfillmentUpdateChangedFields(original, normalized);
      const input = { id, ...scalar, ...(labels == null ? {} : { labels }) };
      const replacement: ReplacementProfile = hydration.dirtyReferences.length ? { ...profile, touchExistingRoot: true } : profile;
      const replaced = yield* replaceGraphRows(ctx, replacement, fulfillment, [input], { relations: labels == null ? [] : ["labels"] });
      const root = replaced.entities[0];
      if (root === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
      for (const [action, event] of [["created", "afterCreate"], ["updated", "afterUpdate"], ["deleted", "afterDelete"]] as const) {
        if (action === "updated") yield* events.rows(event, "Fulfillment", (replaced.performedActions.updated.Fulfillment ?? []).map(projectNativeRow), shared);
        yield* events.rows(event, "FulfillmentLabel", (replaced.performedActions[action].FulfillmentLabel ?? []).map(projectNativeRow), shared);
      }
      const result = contracts.initializeRead(root, before, "assigned");
      if (labels != null && Array.isArray(result.labels)) {
        const created = [...replaced.performedActions.created.FulfillmentLabel ?? []];
        const rows = new Map(result.labels.filter((row): row is JsonObject => row !== null && typeof row === "object" && !Array.isArray(row)).map(row => [row.id, row]));
        const ordered: JsonObject[] = [];
        for (const labelRequest of labels) {
          const id = labelRequest.id ?? created.shift()?.id, row = rows.get(id);
          if (row === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          if (ordered.includes(row)) continue;
          ordered.push(row);
        }
        return [{ ...result, labels: ordered }];
      }
      return [result];
    });
    return { values, reads, graph: { catalog, profile, fulfillment, label, item }, update };
  });
}
