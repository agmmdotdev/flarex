import type { Reference, StepExecutionContext, WorkflowData } from "./model";
import { definitionError } from "./model";

const references = new WeakMap<object, Reference>();
export const referenceOf = (value: unknown) => typeof value === "object" && value !== null ? references.get(value) : undefined;

/** Pinned proxy algorithm: property access becomes a deferred transform of its
 * target. Fork changes authenticate reference identity and prevent thenable assimilation. */
export function proxify<T>(reference: Reference): WorkflowData<T> {
  const proxy = new Proxy({}, {
    get(_target, property) {
      if (property === "then") return undefined;
      if (property === "config" || property === "if") return () => { throw definitionError("unsupportedProfile", "Step reconfiguration and conditions require a separate profile"); };
      return proxify({ kind: "transform", owner: reference.owner, input: proxy,
        transform: (value: unknown) => value == null ? undefined : Reflect.get(Object(value), property),
      });
    },
    set() { throw definitionError("invalidDefinition", "Workflow references are immutable"); },
  });
  references.set(proxy, Object.freeze(reference));
  // SAFETY: Medusa's staging facade intentionally represents T with a deferred proxy.
  return proxy as WorkflowData<T>;
}

export function transformer<T>(owner: object, input: unknown, transform: (value: unknown, context: StepExecutionContext) => unknown | Promise<unknown>): WorkflowData<T> {
  return proxify({ kind: "transform", owner, input, transform });
}
