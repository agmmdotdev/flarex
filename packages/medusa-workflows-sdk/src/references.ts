import type { Reference, StepExecutionContext, WorkflowData } from "./model";
import { definitionError } from "./model";

const references = new WeakMap<object, Reference>();
export const referenceOf = (value: unknown) => typeof value === "object" && value !== null ? references.get(value) : undefined;

/** Pinned staged property access, represented as pure selection in the native
 * fork. Authenticate reference identity and prevent thenable assimilation. */
export function proxify<T>(reference: Reference, configure?: (options: unknown) => void): WorkflowData<T> {
  const proxy = new Proxy({}, {
    get(_target, property) {
      if (property === "then") return undefined;
      if (property === "config") return (options: unknown) => {
        if (configure === undefined) throw definitionError("unsupportedProfile", "Only step instances support name configuration");
        configure(options);
        return proxy;
      };
      if (property === "if") return () => { throw definitionError("unsupportedProfile", "Use a named when/then branch"); };
      return proxify({ kind: "property", owner: reference.owner, input: proxy, property });
    },
    set() { throw definitionError("invalidDefinition", "Workflow references are immutable"); },
  });
  references.set(proxy, Object.freeze(reference));
  // SAFETY: Medusa's staging facade intentionally represents T with a deferred proxy.
  return proxy as WorkflowData<T>;
}

export function transformer<T>(owner: object, input: unknown, transform: (value: unknown, context: StepExecutionContext) => unknown | Promise<unknown>, guards: readonly object[]): WorkflowData<T> {
  return proxify({ kind: "transform", owner, input, transform, guards });
}
