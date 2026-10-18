import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { batchShippingOptionRulesWorkflow } from "@medusajs/core-flows/fulfillment/batch-shipping-option-rules";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeShippingOptionRuleCommands } from "../../src/modules/fulfillment/shipping-option-rule-service";
import { captureServiceZoneCreationMetadata } from "../../src/modules/fulfillment/shipping-profile-schema";
import { compileFulfillmentGraphContracts } from "../../src/modules/fulfillment/fulfillment-graph-contracts";
import { projectNativeRow } from "../../src/repository/result";
import { commerceDecoder } from "../../src/value/decoder";
import { captureCommerceInput } from "../../src/value/input";
import { ShippingOptionRuleBatchInput, ShippingOptionRuleCreates, ShippingOptionRuleUpdates, ShippingOptionRuleIds } from "../../src/modules/fulfillment/shipping-option-rule-input";
import { prepareShippingOptionRuleBatchWorkflow } from "../../src/workflows/fulfillment/batch-shipping-option-rules";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { shippingOptionRuleBatchResources } from "../../src/workflow/policy";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalServiceZoneCreation, serviceZoneDeletionGraph } from "./logical-service-zone-creation-fixture";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

const revision = createHash("sha256").update("native-shipping-option-rule-batch-136").digest("hex");
const prepared = Result.getOrThrow(batchShippingOptionRulesWorkflow.prepare());
type NativeInput = Parameters<typeof batchShippingOptionRulesWorkflow.runAsStep>[0]["input"];
export type RuleInverse = "create" | "update" | "delete";
const retainedCallback = (action: RuleInverse) => {
  const node = prepared.nodes.find(node => node.name === `${action}-shipping-option-rules`);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine Rule retained inverse: " + action);
  return node.compensate;
};
const callbacks = { create: retainedCallback("create"), update: retainedCallback("update"), delete: retainedCallback("delete") };
const decodeText = Schema.decodeUnknownSync(Schema.String);
export const ruleGraph = (() => {
  const base = serviceZoneDeletionGraph("rule-batch", { options: 4, rules: 8 });
  const rows = base.rows.map(seed => seed.table === "shipping_option" && seed.row.id === base.optionIds[3]
    ? { ...seed, row: { ...seed.row, deleted_at: "2026-10-18T00:00:00.000Z" } }
    : seed.table !== "shipping_option_rule" ? seed : {
    ...seed, row: { ...seed.row, attribute: "native.attribute", operator: "eq", value: "original-" + decodeText(seed.row.id),
      deleted_at: null },
  });
  const original = rows.find(seed => seed.row.id === base.ruleIds[7]);
  if (original === undefined) throw new Error("Missing historical Rule seed source");
  const historicalId = "rule-batch-historical";
  rows.push({ ...original, row: { ...original.row, id: historicalId, deleted_at: "2026-10-18T00:00:00.000Z" } });
  // Canonical DML permits historical persisted JSON that the public business
  // validator refuses. Native retained callbacks must preserve that refusal.
  const legacyNullId = "rule-batch-legacy-null", legacyObjectId = "rule-batch-legacy-object";
  rows.push({ ...original, row: { ...original.row, id: legacyNullId, value: null } });
  rows.push({ ...original, row: { ...original.row, id: legacyObjectId, value: { opaque: true } } });
  const parent = rows.find(seed => seed.row.id === base.optionIds[0]);
  if (parent === undefined) throw new Error("Missing unused Option seed source");
  const unusedParentId = "rule-batch-unused-option";
  rows.push({ ...parent, row: { ...parent.row, id: unusedParentId, name: unusedParentId } });
  return { ...base, rows, historicalId, legacyNullId, legacyObjectId, unusedParentId,
    allIds: [...base.allIds, historicalId, legacyNullId, legacyObjectId, unusedParentId] };
})();

export function maximumShippingOptionRuleBatch(prefix: string): typeof ShippingOptionRuleBatchInput.Type {
  return { create: Array.from({ length: 4 }, (_, index) => ({ id: `${prefix}-created-${index}`, attribute: "native.attribute", operator: "eq",
    value: index === 0 ? true : "created-" + index, shipping_option_id: ruleGraph.optionIds[index]! })),
  update: ruleGraph.ruleIds.slice(0, 4).map((id, index) => ({ id, attribute: "native.attribute", operator: "in", value: ["updated", index] })),
  delete: ruleGraph.ruleIds.slice(4, 8) };
}

/** Reuse the existing canonical eight-table graph installer and complete row
 * inventory. Constructing its Zone module grants no Rule workflow authority. */
export async function prepareLogicalShippingOptionRuleBatch(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const base = await prepareLogicalServiceZoneCreation(driver, close, [ruleGraph], shared);
  const fulfillment = await Effect.runPromise(makeShippingOptionRuleCommands());
  const installed = { ...base.installed, module: fulfillment.workflow };
  const options = { execution: base.execution, fulfillment: installed, revision,
    subscribers: [{ id: "native-shipping-option-rule-batch", revision: "f".repeat(64) }] };
  const modules = { fulfillment: { ...installed, logicalResources: shippingOptionRuleBatchResources } };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["createShippingOptionRules", "updateShippingOptionRules", "deleteShippingOptionRules", "listShippingOptionRules"], graph: false } }, true));
  const prepare = async (selectedRevision = revision) => {
    const host = await Effect.runPromise(prepareShippingOptionRuleBatchWorkflow({ ...options, revision: selectedRevision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareRoundtrip = async (retained: (kind: RuleInverse) => unknown, lateFailure = false) => {
    const undo = createStep("probe-native-rule-retained-inverses", resources.callback(async (_input: null, context) => {
      // The actual native scheduler packet starts genuine inverses C/U/D. The
      // probe invokes those unchanged callbacks with actual captured responses.
      for (const action of ["create", "update", "delete"] as const) {
        const callback = callbacks[action];
        if (callback === undefined) throw new Error("Missing retained Rule callback");
        await callback(retained(action), context);
      }
      if (lateFailure) throw new Error("Late genuine Rule inverse failure");
      return null;
    }));
    const flow = createWorkflow("probe-native-rule-batch-roundtrip", (value: WorkflowData<typeof ShippingOptionRuleBatchInput.Type>) => {
      // SAFETY: checked runtime persistence admits supplied IDs, JSON values
      // and nullable omitted-branch fields wider than the public workflow DTO.
      const output = batchShippingOptionRulesWorkflow.runAsStep({ input: value as NativeInput });
      const inverse = undo(transform(output, () => null));
      return new WorkflowResponse(transform({ output, inverse }, ({ output }) => output));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: options.execution, modules, revision,
      operationScheduling: "queued",
      subscribers: options.subscribers, requestCallLimit: shippingOptionRuleBatchResources.calls,
      requestEventLimit: shippingOptionRuleBatchResources.eventMessages,
      workflow: { name: "probeNativeRuleBatchRoundtrip", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ShippingOptionRuleBatchInput, output: fulfillment.output, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareInverse = async (kind: RuleInverse, lateFailure = false) => {
    const callback = callbacks[kind];
    if (callback === undefined) throw new Error("Missing retained Rule callback");
    const undo = createStep("probe-native-rule-" + kind + "-inverse", resources.callback(async (value: unknown, context) => {
      await callback(value, context);
      if (lateFailure) throw new Error("Late genuine Rule inverse failure"); return null;
    }));
    const flow = createWorkflow("probe-native-rule-" + kind + "-inverse", (value: WorkflowData<unknown>) => {
      undo(value);
      return new WorkflowResponse(null);
    });
    const prepareSelected = async <Input extends Json>(input: Schema.Codec<Input, Input>) => {
      const decode = commerceDecoder(input, "invalidInput");
      const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: options.execution, modules, revision, subscribers: options.subscribers,
        operationScheduling: "queued",
        requestCallLimit: shippingOptionRuleBatchResources.calls, requestEventLimit: shippingOptionRuleBatchResources.eventMessages,
        workflow: { name: "probeNativeRuleInverse" + kind, resources, prepared: Result.getOrThrow(flow.prepare()), input,
          output: Schema.Null, events: internalModuleWorkflowEvents } }));
      close(() => Effect.runPromise(host.close));
      // Actual retained responses enter as unknown. Keep the selected callback's
      // original bounded codec, rather than widening all inverse transports.
      return { ...host, run: Effect.fn("RuleInverseFixture.run")((key: string, value: unknown) =>
        Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(decode))).pipe(Effect.flatMap(decoded => host.run(key, decoded)))) };
    };
    if (kind === "create") return prepareSelected(ShippingOptionRuleIds);
    if (kind === "update") return prepareSelected(ShippingOptionRuleUpdates);
    return prepareSelected(ShippingOptionRuleCreates);
  };
  const prepareLateFailure = async () => {
    const fail = createStep("probe-native-rule-late-failure", resources.callback(async (_input: unknown) => { throw new Error("Late Rule root failure"); }));
    const flow = createWorkflow("probe-native-rule-late-failure", (value: WorkflowData<typeof ShippingOptionRuleBatchInput.Type>) => {
      // SAFETY: same checked native boundary as the roundtrip above.
      const result = batchShippingOptionRulesWorkflow.runAsStep({ input: value as NativeInput });
      return new WorkflowResponse(fail(result));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: options.execution, modules, revision, subscribers: options.subscribers,
      operationScheduling: "queued",
      requestCallLimit: shippingOptionRuleBatchResources.calls, requestEventLimit: shippingOptionRuleBatchResources.eventMessages,
      workflow: { name: "probeNativeRuleLateFailure", resources, prepared: Result.getOrThrow(flow.prepare()), input: ShippingOptionRuleBatchInput,
        output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  /** Canonical fixture mutation independently removes the previously unused
   * parent. It grants no native Option CRUD at the Rule facade; core FK and
   * dependency settlement remain the only enforcement authority. */
  const prepareUnusedParentRemoval = async () => {
    const graph = Result.getOrThrow(compileFulfillmentGraphContracts((await Effect.runPromise(captureServiceZoneCreationMetadata())).frame));
    const decode = graph.entities.find(entity => entity.table === graph.option)?.decodeRow;
    if (decode === undefined) throw new Error("Missing canonical Option row decoder");
    const remove = defineCommerceCommand("ruleUnusedOptionRaceRemove", "write", Effect.fn(function* (ctx, value) {
      const id = yield* Schema.decodeUnknownEffect(Schema.Literal(ruleGraph.unusedParentId))(value)
        .pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return [...yield* (yield* ctx.table(graph.option.name)).delete(ctx.manager, [{ id }])];
    }));
    const participant = defineAtomicCommerceParticipant("ruleUnusedOptionRace");
    const root = defineAtomicCommerceCommand("ruleUnusedOptionRaceRoot", (ctx, value) => ctx.call(participant, remove, value));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...base.fixture.hostInput,
      identityAndAccessPolicy: { profile: "rule-unused-option-canonical-race-fixture" }, commands: [root],
      participants: [{ participant, logicalStorage: installed.logicalStorage, commands: [remove],
        validateLogicalCall: Effect.fn("RuleUnusedOptionRace.validate")(function* (call, activity, command) {
          if (command !== remove || call.commandName !== "ruleUnusedOptionRaceRemove" || call.mode !== "write" ||
            call.input !== ruleGraph.unusedParentId || call.events.length || activity.mutations.length !== 1 ||
            activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length || activity.relationalReads.length)
            return yield* Effect.fail(commerceError("receiptMismatch"));
          const mutation = activity.mutations[0];
          const output = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject).check(Schema.isLengthBetween(1, 1)))(call.result)
            .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          if (mutation === undefined || mutation.ordinal !== 0 || mutation.operation !== "delete" || mutation.table !== graph.option.name ||
            mutation.before === null || mutation.after !== null || output[0] === undefined)
            return yield* Effect.fail(commerceError("receiptMismatch"));
          const before = yield* Effect.fromResult(decode(projectNativeRow(mutation.before)));
          if (before.id !== ruleGraph.unusedParentId || !jsonEqual(output[0], before)) return yield* Effect.fail(commerceError("receiptMismatch"));
          for (const observation of activity.observedRows) {
            if (observation.table !== graph.option.name || !jsonEqual(projectNativeRow(observation.row), before))
              return yield* Effect.fail(commerceError("receiptMismatch"));
          }
        }),
      }],
    }));
    close(() => Effect.runPromise(host.close));
    return { newRequestKey: host.newRequestKey, run: (key: string) => host.run(key, root, ruleGraph.unusedParentId) };
  };
  return { ...base, fulfillment, installed, options, modules, resources, prepare, prepareRoundtrip, prepareInverse, prepareLateFailure, prepareUnusedParentRemoval };
}
