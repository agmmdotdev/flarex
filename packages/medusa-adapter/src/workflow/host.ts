import { Effect, Result, Schema } from "effect";
import { isPreparedWorkflow, type PreparedWorkflow } from "@medusajs/workflows-sdk";
import { commerceCommandIdentity, defineAtomicCommerceCommand, defineCommerceEventContract, defineCommerceDerivedIdEventContract, type AtomicCommerceContext, type AtomicCommerceHost, type TaskAtomicCommerceHost, type AtomicCommerceHostInput,
  type AtomicCommerceParticipantInput, type AtomicCommerceEvents, type AtomicCommerceCallObservation, type CommerceCommand, type CommerceEventContract,
  } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { captureCommerceResources, commerceError, isJsonObject, type CommerceResources, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareLocalGraph } from "../local-graph/query";
import { runNativeMedusaWorkflow } from "./runtime";
import { captureCommerceInput } from "../value/input";
import { captureWorkflowArray, captureWorkflowRecord, captureWorkflowPolicy } from "./configuration";
import { workflowMethodDefinition, workflowModuleDefinition, type WorkflowMethod, type WorkflowModule } from "./module";
import { workflowResourceSelections, workflowComposedResources, type PreparedWorkflowResources } from "./resources";
import { composedWorkflowResourceDefinition } from "./composed-resource";
import { bindWorkflowResources, type BoundWorkflowEvent, type WorkflowEventDefinition } from "./binding";
import { checkedCommerceValue } from "../value/checked";
import { requireAtomicCommerceScopeExclusion } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceDecoder } from "../value/decoder";
import type { TrustedWorkflowExecutionSubject } from "@flarex/persistence-postgres/internal/trusted-workflow-execution-subject";
import type { PreparedCommitEventEligibility } from "@flarex/persistence-postgres/internal/commit-event-eligibility";

const decodeOperationScheduling = Schema.decodeUnknownEffect(Schema.UndefinedOr(Schema.Literal("queued")));
const decodeExecutionIsolation = Schema.decodeUnknownEffect(Schema.UndefinedOr(Schema.Literal("scopeExclusive")));
const decodeLogicalPublication = Schema.decodeUnknownResult(Schema.UndefinedOr(Schema.Literal("mixed")));

export type AtomicWorkflowHostComposition = Pick<AtomicCommerceHostInput<never>, "participants" | "commands" | "events" | "identityAndAccessPolicy" | "requestCallLimit" | "requestByteLimit" | "requestEventLimit" | "executionIsolation" | "operationScheduling" | "borrowedOperationScheduling" | "taskControlCommands">;
/** The trusted database host closes its own database/session/authority inputs.
 * Only preparation data crosses this portable adapter boundary. */
export interface AtomicWorkflowExecution<Host extends AtomicCommerceHost = AtomicCommerceHost> {
  readonly identityAndAccessPolicy: Json;
  readonly prepare: (composition: AtomicWorkflowHostComposition) => Effect.Effect<Host, CommerceTransactionError>;
}
export type InstalledWorkflowModule<Module extends WorkflowModule = WorkflowModule> = {
  readonly module: Module;
  /** Trusted selection of the existing identity-bound logical resource profile. */
  readonly logicalResources?: CommerceResources;
  /** Trusted opt-in to native upsert/delete publication within one logical participant. */
  readonly logicalPublication?: "mixed";
  readonly logicalStorage: Extract<AtomicCommerceParticipantInput, { readonly logicalStorage: unknown }>["logicalStorage"];
};

/** Capture selected installed bindings in declared order without invoking
 * getters. The facade keeps its own record-size/hook checks in their original
 * position; the host still authenticates every nested resource and capability. */
export function captureInstalledWorkflowModules<Modules extends Readonly<Record<string, InstalledWorkflowModule>>,
  const Keys extends readonly (keyof Modules & string)[]>(registrations: Modules, keys: Keys) {
  return Result.gen(function* () {
    const names = yield* captureWorkflowArray(keys);
    const entries: [string, object][] = [];
    for (const name of names) {
      const property = yield* Result.try({
        try: () => Object.getOwnPropertyDescriptor(registrations, name),
        catch: cause => commerceError("unsupportedProfile", cause),
      });
      if (property === undefined || !Object.hasOwn(property, "value") || !property.enumerable)
        return yield* Result.fail(commerceError("unsupportedProfile"));
      const binding: unknown = property.value;
      if (binding === null || typeof binding !== "object") return yield* Result.fail(commerceError("unsupportedProfile"));
      const captured = yield* captureWorkflowRecord(binding);
      const resourceInput: unknown = Object.getOwnPropertyDescriptor(captured, "logicalResources")?.value;
      const logicalResources = resourceInput === undefined ? undefined
        : yield* captureWorkflowPolicy(resourceInput).pipe(Result.flatMap(captureCommerceResources));
      const logicalPublication = yield* decodeLogicalPublication(Object.getOwnPropertyDescriptor(captured, "logicalPublication")?.value)
        .pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
      const bindingFields = Object.fromEntries(Object.entries(captured).filter(([field]) => field !== "logicalPublication"));
      entries.push([name, Object.freeze({ ...bindingFields, ...(logicalResources === undefined ? {} : { logicalResources }),
        ...(logicalPublication === undefined ? {} : { logicalPublication }) })]);
    }
    // SAFETY: each selected own data binding is captured under its exact key.
    // This retains the typed configuration, not authority over nested tokens.
    return Object.freeze(Object.fromEntries(entries)) as Readonly<Pick<Modules, Keys[number]>>;
  });
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
export const prepareWorkflowComposition = Effect.fn("Workflow.prepareComposition")(function* <Resources, Input extends Json, Output extends Json, EncodedInput extends Json>(input: {
  readonly identityAndAccessPolicy: Json;
  readonly modules: Readonly<Record<string, InstalledWorkflowModule>>;
  readonly workflow: AtomicWorkflowDefinition<Resources, Input, Output, EncodedInput>;
  readonly revision: string;
  readonly subscribers?: AtomicCommerceEvents["subscribers"];
  /** Trusted composition only; the atomic owner validates the request budget. */
  readonly requestCallLimit?: number;
  readonly requestByteLimit?: number;
  readonly requestEventLimit?: number;
  readonly operationScheduling?: "queued";
  readonly borrowedOperationScheduling?: "queued";
  /** Trusted native graphs can require the existing writer lock without a provider. */
  readonly executionIsolation?: "scopeExclusive";
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const operationScheduling = yield* decodeOperationScheduling(options.operationScheduling)
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const borrowedOperationScheduling = yield* decodeOperationScheduling(options.borrowedOperationScheduling)
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const executionIsolation = yield* decodeExecutionIsolation(options.executionIsolation)
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  if (borrowedOperationScheduling !== undefined && operationScheduling !== "queued")
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const policy = yield* Effect.fromResult(captureWorkflowPolicy(options.identityAndAccessPolicy));
  const workflow = yield* Effect.fromResult(captureWorkflowRecord(options.workflow));
  if (!isPreparedWorkflow(workflow.prepared)) return yield* Effect.fail(commerceError("invalidAuthority"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const members = workflowResourceSelections(workflow.resources);
  if (members === undefined || members.length < 1 || members.length !== Object.keys(registrations).length
    || !Schema.isSchema(workflow.input) || !Schema.isSchema(workflow.output) || !/^[a-f0-9]{64}$/.test(options.revision)
    || workflow.resources.events !== (workflow.events !== undefined) || (!workflow.resources.events && options.subscribers !== undefined)) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, members.map(member => member.name)));
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
  let derivedEvents = false;
  let requestEventLimit = options.requestEventLimit;
  for (const member of members) {
    const raw = installed[member.name];
    if (raw === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const binding = yield* Effect.fromResult(captureWorkflowRecord(raw));
    const definition = workflowModuleDefinition(member.module);
    if (binding.module !== member.module || definition === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
    if (Object.keys(binding).some(key => key !== "module" && key !== "logicalStorage" && key !== "logicalResources" && key !== "logicalPublication") || binding.logicalStorage === undefined)
      return yield* Effect.fail(commerceError("unsupportedProfile"));
    const moduleEvents = definition.logical;
    const commands = new Set<CommerceCommand>();
    const methodIdentities = [];
    const graphIdentities = [];
    const moduleEventNames = new Set<string>();
    for (const name of member.methods) {
      const token = member.module.methods[name];
      const method = token === undefined ? undefined : workflowMethodDefinition(token);
      if (token === undefined || method === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
      const identity = commerceCommandIdentity(method.command);
      if (identity === undefined || (moduleEvents === undefined ? identity.mode === "write" :
        !moduleEvents.commands.includes(method.command))) return yield* Effect.fail(commerceError("invalidAuthority"));
      methodIdentities.push({ name, command: identity, moduleEvents: method.moduleEvents });
      commands.add(method.command); observed.set(token, { participant: member.participant, command: method.command });
      for (const name of method.moduleEvents) moduleEventNames.add(name);
    }
    if (moduleEventNames.size !== 0 && (eventDefinition === undefined || moduleEvents === undefined)) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const capture = moduleEvents?.capture;
    const moduleContracts = new Map<string, CommerceEventContract>();
    const replacement = moduleEvents?.referenceReplacement !== undefined &&
      moduleEvents.referenceReplacement.commands.some(command => commands.has(command))
      ? moduleEvents.referenceReplacement : undefined;
    let derivedContract: CommerceEventContract | undefined;
    if (replacement !== undefined) {
      if (eventDefinition === undefined || !moduleEventNames.has(replacement.eventName)) return yield* Effect.fail(commerceError("unsupportedProfile"));
      derivedContract = yield* Effect.fromResult(defineCommerceDerivedIdEventContract({ name: replacement.eventName,
        revision: options.revision, internal: true, metadata: replacement.metadata }));
      derivedEvents = true;
      requestEventLimit = Math.max(requestEventLimit ?? 0, replacement.eventLimit);
    }
    for (const name of moduleEventNames) {
      if (capture === undefined || names.has(name)) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const contract = name === replacement?.eventName && derivedContract !== undefined ? derivedContract : defineCommerceEventContract({ name, revision: options.revision, internal: true,
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
        if (identity?.mode !== "read" || moduleEvents !== undefined && !moduleEvents.commands.includes(command))
          return yield* Effect.fail(commerceError("invalidAuthority"));
        commands.add(command); graphIdentities.push({ ...metadata, command: identity });
      }
    }
    const selected = { participant: member.participant, commands: [...commands],
      ...(moduleEvents?.setNullPolicy === undefined ? {} : { setNullPolicy: moduleEvents.setNullPolicy }),
      ...(moduleEvents?.allowReconstitution === true ? { allowReconstitution: true as const } : {}),
      ...(moduleEvents?.allowPreservingDeletionUpsert === true ? { allowPreservingDeletionUpsert: true as const } : {}),
      ...(moduleEvents?.allowActiveRestoreUpdate === true ? { allowActiveRestoreUpdate: true as const } : {}),
      ...(moduleEvents?.allowStorageInsertionOrder === true ? { allowStorageInsertionOrder: true as const } : {}),
      ...(moduleEvents === undefined ? {} : { validateLogicalCall: moduleEvents.validateLogicalCall }),
      ...(moduleEvents?.validateLogical === undefined ? {} : { validateLogical: moduleEvents.validateLogical }),
      ...(derivedContract === undefined ? {} : { allowReferenceReplacement: true as const, derivedIdEvent: { contract: derivedContract } }),
      ...(moduleContracts.size === 0 ? {} : { events: {
        contracts: [...moduleContracts.values()],
        select: Effect.fn("Workflow.selectModuleEvent")(function* (message: Json) {
          const token = isJsonObject(message) && typeof message.name === "string" ? moduleContracts.get(message.name) : undefined;
          if (token === undefined) return yield* Effect.fail(commerceError("unadmittedEvent"));
          return token;
        }),
      } }),
    };
    participants.push({ ...selected, logicalStorage: binding.logicalStorage,
      ...(binding.logicalResources === undefined ? {} : { logicalResources: binding.logicalResources }),
      ...(binding.logicalPublication === undefined ? {} : { logicalPublication: binding.logicalPublication }),
    });
    identities.push({ name: member.name, module: member.module.name, profile: definition.source.profile, methods: methodIdentities,
      ...(member.expose === false ? { expose: false } : {}),
      graph: member.graph ? { aliases: definition.graph.aliases, reads: graphIdentities,
        ...(definition.graph.remotePaths === undefined ? {} : { remotePaths: definition.graph.remotePaths }),
      } : null,
    });
  }
  const composedIdentities = [];
  for (const selected of workflowComposedResources(workflow.resources) ?? []) {
    const definition = composedWorkflowResourceDefinition(selected.resource);
    if (!definition) return yield* Effect.fail(commerceError("invalidAuthority"));
    const dependencies = [];
    for (const token of definition.dependencies) {
      const method = observed.get(token);
      const member = members.find(member => member.participant === method?.participant);
      if (!method || !member) return yield* Effect.fail(commerceError("invalidAuthority"));
      dependencies.push({ participant: member.name, command: commerceCommandIdentity(method.command) });
    }
    composedIdentities.push({ name: selected.name, identity: definition.identity, methods: Object.keys(definition.methods), dependencies,
      ...(definition.scopeExclusive ? { scopeExclusive: true } : {}) });
  }
  const graph = graphMembers.length === 0 ? undefined : yield* Effect.fromResult(prepareLocalGraph(graphMembers));
  const decodeInput = commerceDecoder(workflow.input, "invalidInput");
  const decodeOutput = commerceDecoder(workflow.output, "storedCorruption");
  const decodeStoredOutput = commerceDecoder(Schema.toType(workflow.output), "storedCorruption");
  const scopeExclusive = executionIsolation === "scopeExclusive" ||
    (workflowComposedResources(workflow.resources) ?? []).some(member => composedWorkflowResourceDefinition(member.resource)?.scopeExclusive);
  const execute = Effect.fn("Workflow.runAtomic")(function* (ctx: AtomicCommerceContext, value: Json) {
    if (scopeExclusive) yield* requireAtomicCommerceScopeExclusion(ctx);
    const args = yield* checkedCommerceValue(ctx, () => decodeInput(value));
    const result = yield* runNativeMedusaWorkflow(workflow.prepared, ctx, args, owner => bindWorkflowResources(workflow.resources, members, graph, emitted, ctx, owner));
    return yield* checkedCommerceValue(ctx, () => decodeOutput(result));
  });
  const command = defineAtomicCommerceCommand(workflow.name, execute);
  const events: AtomicCommerceEvents | undefined = eventDefinition === undefined || options.subscribers === undefined ? undefined : {
    producerRevision: options.revision, contracts, subscribers: options.subscribers,
    ...(derivedEvents ? { derivedIdValidation: "capturedOnly" as const } : {}),
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
  const identity = yield* Effect.fromResult(captureWorkflowPolicy({ policy, workflow: {
    revision: options.revision, definition: workflow.prepared.identity, resources: identities, events: [...names],
    ...(composedIdentities.length ? { composedResources: composedIdentities } : {}),
    ...(executionIsolation === undefined ? {} : { executionIsolation }),
    ...(operationScheduling === undefined ? {} : { operationScheduling }),
    ...(borrowedOperationScheduling === undefined ? {} : { borrowedOperationScheduling }),
    ...(options.requestByteLimit === undefined ? {} : { requestByteLimit: options.requestByteLimit }),
  } }));
  const composition = { participants, commands: [command], identityAndAccessPolicy: identity,
    ...(operationScheduling === undefined ? {} : { operationScheduling }),
    ...(borrowedOperationScheduling === undefined ? {} : { borrowedOperationScheduling }),
    ...(scopeExclusive ? { executionIsolation: "scopeExclusive" as const } : {}),
    ...(requestEventLimit === undefined ? {} : { requestEventLimit }),
    ...(options.requestByteLimit === undefined ? {} : { requestByteLimit: options.requestByteLimit }),
    ...(options.requestCallLimit === undefined ? {} : { requestCallLimit: options.requestCallLimit }), ...(events === undefined ? {} : { events }) };
  return Object.freeze({ composition, command, decodeInput, decodeStoredOutput,
    run: (ctx: AtomicCommerceContext, value: Json) => Effect.fromResult(captureCommerceInput(value)).pipe(
      Effect.flatMap(args => execute(ctx, args)),
      Effect.flatMap(result => Effect.fromResult(decodeStoredOutput(result))),
    ) });
});

interface WorkflowHostInput<Resources, Input extends Json, Output extends Json, EncodedInput extends Json, Host extends AtomicCommerceHost> {
  readonly execution: AtomicWorkflowExecution<Host>;
  readonly modules: Readonly<Record<string, InstalledWorkflowModule>>;
  readonly workflow: AtomicWorkflowDefinition<Resources, Input, Output, EncodedInput>;
  readonly revision: string;
  readonly subscribers?: AtomicCommerceEvents["subscribers"];
  readonly requestCallLimit?: number;
  readonly requestByteLimit?: number;
  readonly requestEventLimit?: number;
  readonly operationScheduling?: "queued";
  readonly borrowedOperationScheduling?: "queued";
  readonly executionIsolation?: "scopeExclusive";
}
const prepareBoundWorkflowHost = Effect.fn("Workflow.prepareBoundHost")(function* <Resources, Input extends Json, Output extends Json, EncodedInput extends Json, Host extends AtomicCommerceHost>(input: WorkflowHostInput<Resources, Input, Output, EncodedInput, Host>) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const execution = yield* Effect.fromResult(captureWorkflowRecord(options.execution));
  if (typeof execution.prepare !== "function") return yield* Effect.fail(commerceError("unsupportedProfile"));
  const prepared = yield* prepareWorkflowComposition({ identityAndAccessPolicy: execution.identityAndAccessPolicy,
    modules: options.modules, workflow: options.workflow, revision: options.revision,
    ...(options.subscribers === undefined ? {} : { subscribers: options.subscribers }),
    ...(options.requestCallLimit === undefined ? {} : { requestCallLimit: options.requestCallLimit }),
    ...(options.requestByteLimit === undefined ? {} : { requestByteLimit: options.requestByteLimit }),
    ...(options.requestEventLimit === undefined ? {} : { requestEventLimit: options.requestEventLimit }),
    ...(options.operationScheduling === undefined ? {} : { operationScheduling: options.operationScheduling }),
    ...(options.borrowedOperationScheduling === undefined ? {} : { borrowedOperationScheduling: options.borrowedOperationScheduling }),
    ...(options.executionIsolation === undefined ? {} : { executionIsolation: options.executionIsolation }),
  });
  const host = yield* execution.prepare(prepared.composition);
  return { host, prepared };
});

export const prepareAtomicWorkflowHost = Effect.fn("Workflow.prepareAtomicHost")(function* <Resources, Input extends Json, Output extends Json, EncodedInput extends Json>(input: WorkflowHostInput<Resources, Input, Output, EncodedInput, AtomicCommerceHost>) {
  const { host, prepared } = yield* prepareBoundWorkflowHost(input);
  return Object.freeze({ newRequestKey: host.newRequestKey, close: host.close,
    run: Effect.fn("Workflow.run")((key: string, value: EncodedInput) => Effect.fromResult(captureCommerceInput(value)).pipe(
      Effect.flatMap(args => host.run(key, prepared.command, args)),
      Effect.flatMap(result => Effect.fromResult(prepared.decodeStoredOutput(result))),
    )),
  });
});

/** Genuine Task child invocation over the same prepared business graph and
 * resource/event contracts. The supplied core host owns binding admission. */
export const prepareTaskAtomicWorkflowHost = Effect.fn("Workflow.prepareTaskHost")(function* <Resources, Input extends Json, Output extends Json, EncodedInput extends Json>(input: WorkflowHostInput<Resources, Input, Output, EncodedInput, TaskAtomicCommerceHost>) {
  const { host, prepared } = yield* prepareBoundWorkflowHost(input);
  return Object.freeze({ close: host.close, decodeInput: prepared.decodeInput,
    runTaskChild: Effect.fn("Workflow.runTaskChild")((subject: TrustedWorkflowExecutionSubject, occurrence: bigint,
      value: EncodedInput, eligibility?: PreparedCommitEventEligibility) => Effect.fromResult(captureCommerceInput(value)).pipe(
        Effect.flatMap(args => host.runTaskChild(subject, occurrence, prepared.command, args, eligibility)),
        Effect.flatMap(result => Effect.fromResult(prepared.decodeStoredOutput(result))),
      )),
  });
});
