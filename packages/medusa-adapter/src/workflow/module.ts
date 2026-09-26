import { Effect, Result, Schema } from "effect";
import { commerceCommandIdentity, type CommerceCommand, type LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceModuleDescription } from "../module-definition";
import type { GraphModuleDefinition } from "../local-graph/model";
import { prepareLocalGraph } from "../local-graph/query";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { captureCommerceInput } from "../commerce-input";
import { commerceDecoder } from "../commerce-decoder";
import { captureWorkflowArray, captureWorkflowRecord, isWorkflowResourceName } from "./configuration";

declare const methodType: unique symbol;
export interface WorkflowMethod<Args extends readonly unknown[] = readonly unknown[], Output = unknown> {
  readonly [methodType]: { readonly args: Args; readonly output: Output };
}
interface MethodDefinition {
  readonly command: CommerceCommand;
  readonly input: (args: unknown) => Result.Result<Json, CommerceTransactionError>;
  readonly output: (value: Json) => Result.Result<unknown, CommerceTransactionError>;
  readonly moduleEvents: readonly string[];
}
const methods = new WeakMap<object, MethodDefinition>();
const decodeModuleEvents = commerceDecoder(Schema.Array(Schema.String.check(Schema.isPattern(/\S/))).check(Schema.isMaxLength(64)), "unsupportedProfile");

/** A typed adapter over an existing command, not another execution authority. */
export function defineWorkflowMethod<Args extends readonly unknown[], Output>(input: {
  readonly command: CommerceCommand;
  readonly arguments: (value: unknown) => Result.Result<Args, CommerceTransactionError>;
  readonly encode: (args: Args) => Json;
  readonly output: (value: Json) => Result.Result<Output, CommerceTransactionError>;
  readonly moduleEvents?: readonly string[];
}): Result.Result<WorkflowMethod<Args, Output>, CommerceTransactionError> {
  return Result.gen(function* () {
    const definition = yield* captureWorkflowRecord(input);
    if (typeof definition.arguments !== "function" || typeof definition.encode !== "function" || typeof definition.output !== "function") return yield* Result.fail(commerceError("unsupportedProfile"));
    const moduleEvents = yield* captureCommerceInput(definition.moduleEvents === undefined ? [] : definition.moduleEvents).pipe(Result.flatMap(decodeModuleEvents));
    if (new Set(moduleEvents).size !== moduleEvents.length) return yield* Result.fail(commerceError("unsupportedProfile"));
    // SAFETY: only this registry associates typed argument/output decoders with
    // the erased method token. Native inference follows those same decoders.
    const token = Object.freeze({}) as WorkflowMethod<Args, Output>;
    methods.set(token, Object.freeze({ command: definition.command, output: definition.output, moduleEvents: Object.freeze([...moduleEvents].sort()),
      input: (args: unknown) => captureCommerceInput(args).pipe(Result.flatMap(definition.arguments), Result.map(definition.encode), Result.flatMap(captureCommerceInput)),
    }));
    return token;
  });
}
export const workflowMethodDefinition = (method: WorkflowMethod) => methods.get(method);

export interface WorkflowModule<Methods extends Readonly<Record<string, WorkflowMethod>> = Readonly<Record<string, WorkflowMethod>>> {
  readonly name: string;
  readonly methods: Methods;
}
export interface WorkflowLogicalPolicy {
  readonly commands: readonly CommerceCommand[];
  readonly capture: (event: unknown) => Effect.Effect<Json, CommerceTransactionError>;
  readonly validateLogicalCall: LogicalCommerceCallValidation;
  readonly allowSetNull?: true;
  readonly referenceReplacement?: Readonly<{
    commands: readonly CommerceCommand[];
    eventName: string;
    metadata: Json;
    eventLimit: number;
  }>;
}
interface ModuleDefinition {
  readonly source: Pick<CommerceModuleDescription, "name" | "profile">;
  readonly graph: GraphModuleDefinition;
  readonly logical?: WorkflowLogicalPolicy;
}
const modules = new WeakMap<object, ModuleDefinition>();
const Table = Schema.Struct({ name: Schema.String, columns: Schema.Array(Schema.String), primaryKeys: Schema.Array(Schema.String),
  foreignKeys: Schema.Array(Schema.String), companions: Schema.Record(Schema.String, Schema.String) });
const decodeGraphMetadata = commerceDecoder(Schema.Struct({ table: Table,
  paths: Schema.Array(Schema.Struct({ path: Schema.String, table: Table, many: Schema.Boolean, optional: Schema.optionalKey(Schema.Boolean) })),
  orderable: Schema.Array(Schema.String), uniqueOrder: Schema.Array(Schema.String),
}), "unsupportedProfile");
const decodeAliases = commerceDecoder(Schema.Array(Schema.Struct({ name: Schema.String, model: Schema.String })), "unsupportedProfile");

/** Module-owned integration metadata. The original module constructor and its
 * commands continue to own service construction and all database operations. */
export function defineWorkflowModule<const Methods extends Readonly<Record<string, WorkflowMethod>>>(input: {
  readonly name: string;
  readonly source: Pick<CommerceModuleDescription, "name" | "profile">;
  readonly methods: Methods;
  readonly graph: GraphModuleDefinition;
  readonly logical?: WorkflowLogicalPolicy;
}): Result.Result<WorkflowModule<Methods>, CommerceTransactionError> {
  return Result.gen(function* () {
    const definition = yield* captureWorkflowRecord(input);
    const selected = yield* captureWorkflowRecord(definition.methods);
    const source = yield* captureWorkflowRecord(definition.source);
    if (typeof source.name !== "string" || typeof source.profile !== "string") return yield* Result.fail(commerceError("unsupportedProfile"));
    if (!isWorkflowResourceName(definition.name) || ["query", "event_bus"].includes(definition.name)) return yield* Result.fail(commerceError("unsupportedProfile"));
    for (const [name, method] of Object.entries(selected)) {
      if (!isWorkflowResourceName(name) || !methods.has(method)) return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    // Graph preparation owns deep metadata snapshots and validation. Retain its
    // checked snapshot through the original definition captured below.
    const graph = yield* captureGraphDefinition(definition.graph);
    const supplied = definition.logical === undefined ? undefined : yield* captureWorkflowRecord(definition.logical);
    if (supplied !== undefined && (typeof supplied.capture !== "function" || typeof supplied.validateLogicalCall !== "function" ||
      supplied.allowSetNull !== undefined && supplied.allowSetNull !== true)) return yield* Result.fail(commerceError("unsupportedProfile"));
    const replacement = supplied?.referenceReplacement === undefined ? undefined : yield* captureWorkflowRecord(supplied.referenceReplacement);
    const commands = supplied === undefined ? [] : yield* captureWorkflowArray(supplied.commands);
    if (commands.some(command => commerceCommandIdentity(command) === undefined)) return yield* Result.fail(commerceError("invalidAuthority"));
    const admitted = new Set(commands);
    if (replacement !== undefined && (replacement.commands.length === 0 ||
      replacement.commands.some(command => !admitted.has(command) || commerceCommandIdentity(command)?.mode !== "write") ||
      typeof replacement.eventName !== "string" || replacement.eventName.length === 0 ||
      !Number.isSafeInteger(replacement.eventLimit) || replacement.eventLimit < 1 || replacement.eventLimit > 256))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const logical = supplied === undefined ? undefined : Object.freeze({
      capture: supplied.capture,
      validateLogicalCall: Effect.fn("Workflow.validateModuleCall")(function* (call: Parameters<LogicalCommerceCallValidation>[0],
        activity: Parameters<LogicalCommerceCallValidation>[1], command: CommerceCommand) {
        const identity = commerceCommandIdentity(command);
        if (!admitted.has(command) || identity?.name !== call.commandName || identity.mode !== call.mode)
          return yield* Effect.fail(commerceError("invalidAuthority"));
        yield* supplied.validateLogicalCall(call, activity, command);
      }),
      commands,
      ...(supplied.allowSetNull === undefined ? {} : { allowSetNull: supplied.allowSetNull }),
      ...(replacement === undefined ? {} : { referenceReplacement: Object.freeze({
        commands: Object.freeze([...replacement.commands]), eventName: replacement.eventName, eventLimit: replacement.eventLimit,
        metadata: yield* captureCommerceInput(replacement.metadata),
      }) }),
    });
    yield* prepareLocalGraph([{ participant: defineAtomicCommerceParticipant(definition.name), module: graph }]);
    const token = Object.freeze({ name: definition.name, methods: selected });
    modules.set(token, Object.freeze({ source: Object.freeze({ name: source.name, profile: source.profile }), graph, ...(logical === undefined ? {} : { logical }),
    }));
    return token;
  });
}

function captureGraphDefinition(input: GraphModuleDefinition) {
  return Result.gen(function* () {
    const definition = yield* captureWorkflowRecord(input);
    // The graph owner validates columns and paths. Snapshot configuration here
    // before exposing it across host preparations, preserving command identity.
    const aliases = yield* captureCommerceInput(definition.aliases).pipe(Result.flatMap(decodeAliases));
    const reads = [];
    for (const source of yield* captureWorkflowArray(definition.reads)) {
      const read = yield* captureWorkflowRecord(source);
      const metadata = yield* captureCommerceInput({ table: read.table, paths: read.paths, orderable: read.orderable, uniqueOrder: read.uniqueOrder }).pipe(Result.flatMap(decodeGraphMetadata));
      if (typeof read.model !== "string" || typeof read.decode !== "function" || typeof read.multipleOrder !== "boolean") return yield* Result.fail(commerceError("unsupportedProfile"));
      reads.push(Object.freeze({ ...read, ...metadata }));
    }
    return Object.freeze({ aliases, reads: Object.freeze(reads) });
  });
}
export const workflowModuleDefinition = (module: WorkflowModule) => modules.get(module);

export type WorkflowModuleMethods<Module> = Module extends WorkflowModule<infer Methods> ? Methods : never;
export type BoundWorkflowMethod<Method> = Method extends WorkflowMethod<infer Args, infer Output> ? (...args: Args) => Promise<Output> : never;
