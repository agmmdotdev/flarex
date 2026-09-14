import { Effect, Schema } from "effect";
import { isPreparedWorkflow, type PreparedWorkflow } from "@medusajs/workflows-sdk";
import { commerceCommandIdentity, defineAtomicCommerceCommand, defineCommerceEventContract, type AtomicCommerceHost, type AtomicCommerceHostInput,
  type AtomicCommerceParticipantInput, type AtomicCommerceEvents, type AtomicCommerceCallObservation, type CommerceCommand, type CommerceEventContract } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError, isJsonObject, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareLocalGraph } from "../local-graph/query";
import { runNativeMedusaWorkflow } from "../workflow-runtime";
import { captureCommerceInput } from "../commerce-input";
import { captureWorkflowArray, captureWorkflowRecord } from "./configuration";
import { workflowMethodDefinition, workflowModuleDefinition, type WorkflowMethod, type WorkflowModule } from "./module";
import { workflowResourceSelections, type PreparedWorkflowResources } from "./resources";
import { bindWorkflowResources, type BoundWorkflowEvent, type WorkflowEventDefinition } from "./binding";
import { checkedCommerceValue } from "../commerce-checked-value";
import { commerceDecoder } from "../commerce-decoder";

export type AtomicWorkflowHostComposition = Pick<AtomicCommerceHostInput<never>, "participants" | "commands" | "events" | "identityAndAccessPolicy" | "requestCallLimit">;
/** The trusted database host closes its own database/session/authority inputs.
 * Only preparation data crosses this portable adapter boundary. */
export interface AtomicWorkflowExecution {
  readonly identityAndAccessPolicy: Json;
  readonly prepare: (composition: AtomicWorkflowHostComposition) => Effect.Effect<AtomicCommerceHost, CommerceTransactionError>;
}
export interface InstalledWorkflowModule<Module extends WorkflowModule = WorkflowModule> {
  readonly module: Module;
  readonly profile: AtomicCommerceParticipantInput["profile"];
  readonly installation: AtomicCommerceParticipantInput["installation"];
  readonly moduleEvents?: Pick<LocalCommerceEventPolicy, "capture" | "validate">;
}
export interface WorkflowCallResults {
  /** Native encoded inputs and outputs of successful, validated outer calls. */
  readonly calls: (method: WorkflowMethod) => readonly Pick<AtomicCommerceCallObservation, "input" | "result">[];
  readonly results: (method: WorkflowMethod) => readonly Json[];
}
export interface AtomicWorkflowDefinition<Resources, Input extends Json, Output extends Json, EncodedInput extends Json = Input> {
  readonly name: string;
  readonly resources: PreparedWorkflowResources<Resources>;
  readonly prepared: PreparedWorkflow;
  readonly input: Schema.Codec<Input, EncodedInput>;
  readonly output: Schema.ConstraintDecoder<Output>;
  readonly events?: {
    readonly contracts: readonly WorkflowEventDefinition[];
    readonly validate: (events: Parameters<AtomicCommerceEvents["validate"]>[0], calls: WorkflowCallResults) => Effect.Effect<void, CommerceTransactionError>;
  };
}

/** Explicit multi-instance host: immutable preparation, fresh scoped resources
 * per invocation, and exactly one existing core transaction/recovery owner. */
export const prepareAtomicWorkflowHost = Effect.fn("Workflow.prepareAtomicHost")(function* <Resources, Input extends Json, Output extends Json, EncodedInput extends Json>(input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: Readonly<Record<string, InstalledWorkflowModule>>;
  readonly workflow: AtomicWorkflowDefinition<Resources, Input, Output, EncodedInput>;
  readonly revision: string;
  readonly subscribers?: AtomicCommerceEvents["subscribers"];
  /** Trusted composition only; the atomic owner validates and caps this by every profile. */
  readonly requestCallLimit?: number;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const execution = yield* Effect.fromResult(captureWorkflowRecord(options.execution));
  const policy = yield* Effect.fromResult(captureCommerceInput(execution.identityAndAccessPolicy));
  const workflow = yield* Effect.fromResult(captureWorkflowRecord(options.workflow));
  if (!isPreparedWorkflow(workflow.prepared)) return yield* Effect.fail(commerceError("invalidAuthority"));
  const installed = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const members = workflowResourceSelections(workflow.resources);
  if (members === undefined || members.length < 1 || members.length !== Object.keys(installed).length || typeof execution.prepare !== "function"
    || !Schema.isSchema(workflow.input) || !Schema.isSchema(workflow.output) || !/^[a-f0-9]{64}$/.test(options.revision)
    || workflow.resources.events !== (workflow.events !== undefined) || (!workflow.resources.events && options.subscribers !== undefined)) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const eventDefinition = workflow.events === undefined ? undefined : yield* Effect.fromResult(captureWorkflowRecord(workflow.events));
  const emitted: BoundWorkflowEvent[] = [];
  const contracts = [];
  const names = new Set<string>();
  if (eventDefinition !== undefined) {
    if (typeof eventDefinition.validate !== "function" || options.subscribers === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    for (const raw of yield* Effect.fromResult(captureWorkflowArray(eventDefinition.contracts))) {
      const event = yield* Effect.fromResult(captureWorkflowRecord(raw));
      if (typeof event.name !== "string" || names.has(event.name) || typeof event.decode !== "function") return yield* Effect.fail(commerceError("unsupportedProfile"));
      names.add(event.name);
      const contract = defineCommerceEventContract({ name: event.name, revision: options.revision, internal: false, decode: value => Effect.fromResult(event.decode(value)) });
      emitted.push(Object.freeze({ ...event, contract })); contracts.push(contract);
    }
  }
  const participants: AtomicCommerceParticipantInput[] = [];
  const graphMembers = [];
  const identities = [];
  const observed = new Map<WorkflowMethod, { participant: AtomicCommerceParticipantInput["participant"]; command: CommerceCommand }>();
  for (const member of members) {
    const raw = installed[member.name];
    if (raw === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const binding = yield* Effect.fromResult(captureWorkflowRecord(raw));
    const definition = workflowModuleDefinition(member.module);
    if (binding.module !== member.module || definition === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
    const moduleEvents = binding.moduleEvents === undefined ? undefined : yield* Effect.fromResult(captureWorkflowRecord(binding.moduleEvents));
    if (moduleEvents !== undefined && (typeof moduleEvents.capture !== "function" || typeof moduleEvents.validate !== "function")) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const commands = new Set<CommerceCommand>();
    const methodIdentities = [];
    const graphIdentities = [];
    const moduleEventNames = new Set<string>();
    for (const name of member.methods) {
      const token = member.module.methods[name];
      const method = token === undefined ? undefined : workflowMethodDefinition(token);
      if (token === undefined || method === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
      const identity = commerceCommandIdentity(method.command);
      if (identity === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
      methodIdentities.push({ name, command: identity, moduleEvents: method.moduleEvents });
      commands.add(method.command); observed.set(token, { participant: member.participant, command: method.command });
      for (const name of method.moduleEvents) moduleEventNames.add(name);
    }
    if (moduleEventNames.size !== 0 && (eventDefinition === undefined || moduleEvents === undefined)) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const capture = moduleEvents?.capture;
    const moduleContracts = new Map<string, CommerceEventContract>();
    for (const name of moduleEventNames) {
      if (capture === undefined || names.has(name)) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const contract = defineCommerceEventContract({ name, revision: options.revision, internal: true,
        decode: Effect.fn("Workflow.moduleEvent")(function* (value) {
          const message = yield* capture(value);
          if (!isJsonObject(message) || message.name !== name) return yield* Effect.fail(commerceError("unadmittedEvent"));
          return message;
        }),
      });
      moduleContracts.set(name, contract); names.add(name); contracts.push(contract);
    }
    if (member.graph) {
      graphMembers.push({ participant: member.participant, module: definition.graph });
      for (const { command, decode: _decode, ...metadata } of definition.graph.reads) {
        const identity = commerceCommandIdentity(command);
        if (identity === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
        commands.add(command); graphIdentities.push({ ...metadata, command: identity });
      }
    }
    participants.push({ participant: member.participant, profile: binding.profile, installation: binding.installation, commands: [...commands],
      ...(moduleEvents === undefined ? {} : { validate: moduleEvents.validate }), ...(moduleContracts.size === 0 ? {} : { events: {
        contracts: [...moduleContracts.values()],
        select: Effect.fn("Workflow.selectModuleEvent")(function* (message: Json) {
          const token = isJsonObject(message) && typeof message.name === "string" ? moduleContracts.get(message.name) : undefined;
          if (token === undefined) return yield* Effect.fail(commerceError("unadmittedEvent"));
          return token;
        }),
      } }),
    });
    identities.push({ name: member.name, module: member.module.name, profile: definition.source.profile, methods: methodIdentities,
      graph: member.graph ? { aliases: definition.graph.aliases, reads: graphIdentities } : null,
    });
  }
  const graph = graphMembers.length === 0 ? undefined : yield* Effect.fromResult(prepareLocalGraph(graphMembers));
  const decodeInput = commerceDecoder(workflow.input, "invalidInput");
  const decodeOutput = commerceDecoder(workflow.output, "storedCorruption");
  const decodeStoredOutput = commerceDecoder(Schema.toType(workflow.output), "storedCorruption");
  const command = defineAtomicCommerceCommand(workflow.name, Effect.fn("Workflow.runAtomic")(function* (ctx, value) {
    const args = yield* checkedCommerceValue(ctx, () => decodeInput(value));
    const result = yield* runNativeMedusaWorkflow(workflow.prepared, ctx, args, owner => bindWorkflowResources(workflow.resources, members, graph, emitted, ctx, owner));
    return yield* checkedCommerceValue(ctx, () => decodeOutput(result));
  }));
  const events: AtomicCommerceEvents | undefined = eventDefinition === undefined || options.subscribers === undefined ? undefined : {
    producerRevision: options.revision, contracts, subscribers: options.subscribers,
    validate: (events, calls) => {
      const selected = (method: WorkflowMethod) => {
        const expected = observed.get(method);
        return expected === undefined ? [] : calls.filter(call => call.participant === expected.participant && call.command === expected.command);
      };
      return eventDefinition.validate(events, {
        calls: method => Object.freeze(selected(method).map(({ input, result }) => Object.freeze({ input, result }))),
        results: method => selected(method).map(call => call.result),
      });
    },
  };
  const identity = yield* Effect.fromResult(captureCommerceInput({ policy, workflow: {
    revision: options.revision, definition: workflow.prepared.identity, resources: identities, events: [...names],
  } }));
  const host = yield* execution.prepare({ participants, commands: [command], identityAndAccessPolicy: identity,
    ...(options.requestCallLimit === undefined ? {} : { requestCallLimit: options.requestCallLimit }), ...(events === undefined ? {} : { events }) });
  return Object.freeze({ newRequestKey: host.newRequestKey,
    run: Effect.fn("Workflow.run")((key: string, value: EncodedInput) => Effect.fromResult(captureCommerceInput(value)).pipe(
      Effect.flatMap(args => host.run(key, command, args)), Effect.flatMap(result => Effect.fromResult(decodeStoredOutput(result))),
    )),
  });
});
