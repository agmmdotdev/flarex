import { Result } from "effect";
import { commerceError, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../value/input";
import { captureWorkflowArray, captureWorkflowRecord, isWorkflowResourceName } from "./configuration";
import { workflowMethodDefinition, type WorkflowMethod } from "./module";

/** The native service ABI supplies unknown arguments; the authentic method
 * owns their exact decoder. Its output type remains associated with the token. */
export type InvokeWorkflowMethod = <Output>(method: WorkflowMethod<readonly unknown[], Output>, ...args: readonly unknown[]) => Promise<Output>;
export interface ComposedResourceMethod<Args extends readonly unknown[] = readonly unknown[], Output = unknown> {
  readonly arguments: (value: unknown) => Result.Result<Args, CommerceTransactionError>;
  readonly output: (value: Json) => Result.Result<Output, CommerceTransactionError>;
}
type ResourceService<Methods extends Readonly<Record<string, ComposedResourceMethod>>> = {
  readonly [Key in keyof Methods]: Methods[Key] extends ComposedResourceMethod<infer Args, infer Output> ? (...args: Args) => Promise<Output> : never;
};
type ResourceFactory<Methods extends Readonly<Record<string, ComposedResourceMethod>>> = {
  readonly [Key in keyof Methods]: Methods[Key] extends ComposedResourceMethod<infer Args, unknown> ? (...args: Args) => Promise<unknown> : never;
};
declare const resourceType: unique symbol;
export interface ComposedWorkflowResource<Service = unknown> { readonly [resourceType]: Service }
interface Definition {
  readonly resource: ComposedWorkflowResource;
  readonly identity: Json;
  readonly dependencies: readonly WorkflowMethod[];
  readonly methods: Readonly<Record<string, ComposedResourceMethod>>;
  readonly bind: (invoke: InvokeWorkflowMethod) => object;
  readonly scopeExclusive: boolean;
}
const definitions = new WeakMap<object, Definition>();

/** A trusted native resource may combine authenticated commands from several
 * sources. Its factory receives callable methods, never storage or settlement. */
export function defineComposedWorkflowResource<const Methods extends Readonly<Record<string, ComposedResourceMethod>>>(input: {
  readonly identity: unknown; readonly dependencies: readonly WorkflowMethod[]; readonly methods: Methods;
  readonly bind: (invoke: InvokeWorkflowMethod) => ResourceFactory<Methods>;
  readonly scopeExclusive?: true;
}): Result.Result<ComposedWorkflowResource<ResourceService<Methods>>, CommerceTransactionError> {
  return Result.gen(function* () {
    const captured = yield* captureWorkflowRecord(input);
    if (captured.scopeExclusive !== undefined && captured.scopeExclusive !== true) return yield* Result.fail(commerceError("unsupportedProfile"));
    const methods = yield* captureWorkflowRecord(captured.methods);
    const dependencies = yield* captureWorkflowArray(captured.dependencies);
    if (typeof captured.bind !== "function" || !dependencies.length ||
      new Set(dependencies).size !== dependencies.length || dependencies.some(method => !workflowMethodDefinition(method)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const admitted: Array<[string, ComposedResourceMethod]> = [];
    for (const [name, raw] of Object.entries(methods)) {
      const method = yield* captureWorkflowRecord(raw);
      if (!isWorkflowResourceName(name) || typeof method.arguments !== "function" || typeof method.output !== "function")
        return yield* Result.fail(commerceError("unsupportedProfile"));
      admitted.push([name, { arguments: method.arguments, output: method.output }]);
    }
    if (!admitted.length) return yield* Result.fail(commerceError("unsupportedProfile"));
    const identity = yield* captureCommerceInput(captured.identity);
    // SAFETY: the issuer alone associates the inferred service with its runtime
    // argument/output decoders and finite authentic dependency tokens.
    const token = Object.freeze({}) as ComposedWorkflowResource<ResourceService<Methods>>;
    definitions.set(token, Object.freeze({ resource: token, identity, dependencies,
      methods: Object.freeze(Object.fromEntries(admitted)), bind: captured.bind, scopeExclusive: captured.scopeExclusive === true }));
    return token;
  });
}
export const composedWorkflowResourceDefinition = (resource: unknown) =>
  typeof resource === "object" && resource !== null ? definitions.get(resource) : undefined;
export type ComposedWorkflowServices<Resources extends Readonly<Record<string, ComposedWorkflowResource>>> = {
  readonly [Key in keyof Resources]: Resources[Key] extends ComposedWorkflowResource<infer Service> ? Service : never;
};
