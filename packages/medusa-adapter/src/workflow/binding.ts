import { Effect, Result } from "effect";
import type { WorkflowContainer } from "@medusajs/workflows-sdk";
import type { AtomicCommerceContext, CommerceEventContract } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, isJsonObject, type Json, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../commerce-promise-owner";
import { captureCommerceInput } from "../commerce-input";
import type { PreparedLocalGraph } from "../local-graph/model";
import { registerWorkflowResourceContext, type PreparedWorkflowResources, type PreparedWorkflowSelection } from "./resources";
import { workflowMethodDefinition, workflowModuleDefinition } from "./module";
import { checkedCommerceValue } from "../commerce-checked-value";

export interface WorkflowEventDefinition {
  readonly name: string;
  readonly decode: (value: unknown) => Result.Result<Json, CommerceTransactionError>;
}
export interface BoundWorkflowEvent extends WorkflowEventDefinition { readonly contract: CommerceEventContract }

/** Missing native methods refuse on invocation. Reflection and protocol probes
 * remain inert; the target still exposes only the admitted own properties. */
function scopedResource(methods: object, owner: CommercePromiseOwner): object {
  const refuse = () => owner.reject(commerceError("unsupportedProfile"));
  return new Proxy(Object.freeze(methods), {
    get(target, key, receiver) {
      if (Reflect.has(target, key)) return Reflect.get(target, key, receiver);
      if (typeof key !== "string" || key === "then" || key === "toJSON") return undefined;
      return refuse;
    },
  });
}

/** This is the sole Promise facade for admitted workflow resources. It owns no
 * manager and invokes only the supplied root's authentic commands/graph/events. */
export function bindWorkflowResources(selection: PreparedWorkflowResources, members: readonly PreparedWorkflowSelection[],
  graph: PreparedLocalGraph | undefined, events: readonly BoundWorkflowEvent[], ctx: AtomicCommerceContext, owner: CommercePromiseOwner): WorkflowContainer {
  const entries: [string, object][] = [];
  for (const member of members) {
    const definition = workflowModuleDefinition(member.module);
    if (definition === undefined) return owner.reject(commerceError("invalidAuthority"));
    if (member.methods.length === 0) continue;
    const methods: Array<[string, (...args: unknown[]) => Promise<unknown>]> = [];
    for (const name of member.methods) {
      const token = member.module.methods[name];
      const method = token === undefined ? undefined : workflowMethodDefinition(token);
      if (method === undefined) return owner.reject(commerceError("invalidAuthority"));
      methods.push([name, (...args) => owner.run(Effect.gen(function* () {
        const input = yield* checkedCommerceValue(ctx, () => method.input(args));
        const result = yield* ctx.call(member.participant, method.command, input);
        return yield* checkedCommerceValue(ctx, () => method.output(result));
      }))]);
    }
    entries.push([member.name, scopedResource(Object.fromEntries(methods), owner)]);
  }
  if (graph !== undefined) {
    const query = graph.bind(ctx);
    entries.push(["query", scopedResource({ maxPageSize: commerceLimits.catalogRows,
      graph: (...args: unknown[]) => owner.run(args.length === 1 ? query.graph(args[0]) : ctx.refuse(commerceError("unsupportedProfile"))),
    }, owner)]);
  }
  if (selection.events) {
    const contracts = new Map(events.map(event => [event.name, event]));
    entries.push(["event_bus", scopedResource({
      emit: (input: unknown) => owner.run(Effect.gen(function* () {
        const messages = yield* checkedCommerceValue(ctx, () => captureCommerceInput(input));
        if (!Array.isArray(messages)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
        for (const message of messages) {
          const contract = isJsonObject(message) && typeof message.name === "string" ? contracts.get(message.name) : undefined;
          if (contract === undefined) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          const decoded = yield* checkedCommerceValue(ctx, () => contract.decode(message));
          if (!isJsonObject(decoded) || decoded.name !== contract.name || decoded.metadata === undefined || !isJsonObject(decoded.metadata)
            || decoded.metadata.eventGroupId !== ctx.eventGroupId) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* ctx.emit(contract.contract, decoded);
        }
      })),
      clearGroupedEvents: () => owner.reject(commerceError("unadmittedEvent")),
      releaseGroupedEvents: () => owner.reject(commerceError("unadmittedEvent")),
    }, owner)]);
  }
  const resources = Object.freeze(Object.fromEntries(entries));
  const container: WorkflowContainer = Object.freeze({ resolve<T>(name: string): T {
    if (!Object.hasOwn(resources, name)) return owner.reject(commerceError("unsupportedProfile"));
    // SAFETY: Medusa's generic resolver is a compatibility ABI. T grants no
    // capability; the same finite scoped methods serve the inferred native view.
    return resources[name] as T;
  } });
  registerWorkflowResourceContext(container, selection, resources, owner.reject);
  return container;
}
