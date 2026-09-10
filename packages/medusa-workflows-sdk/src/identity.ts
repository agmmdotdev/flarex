import type { Schema } from "effect";
import { definitionError, type Reference, type WorkflowNode } from "./model";
import { referenceOf } from "./references";

export type WorkflowIdentity = {
  readonly name: string;
  readonly nodes: readonly Schema.Json[];
  readonly references: readonly Schema.Json[];
  readonly result: Schema.Json;
};

/** Deterministic preparation data, not code identity. The trusted bundle
 * revision still covers callback implementations and their captured behavior. */
export function workflowIdentity(name: string, nodes: readonly WorkflowNode[], result: unknown): WorkflowIdentity {
  const positions = new Map(nodes.map((node, index) => [node.id, index]));
  const references: Schema.Json[] = [];
  const seen = new Map<Reference, number>();
  const position = (id: object) => {
    const value = positions.get(id);
    if (value === undefined) throw definitionError("invalidReference", "Unknown identity reference");
    return value;
  };
  function encode(value: unknown): Schema.Json {
    const reference = referenceOf(value);
    if (reference !== undefined) {
      if (typeof reference.property === "symbol") throw definitionError("invalidReference", "Workflow data requires string property keys");
      let index = seen.get(reference);
      if (index === undefined) {
        index = references.length;
        seen.set(reference, index); references.push(null);
        references[index] = Object.freeze({ kind: reference.kind,
          ...(reference.step === undefined ? {} : { step: position(reference.step) }),
          ...(reference.guards === undefined ? {} : { guards: Object.freeze(reference.guards.map(position)) }),
          ...(reference.kind === "property" || reference.kind === "transform" ? { input: encode(reference.input) } : {}),
          ...(reference.property === undefined ? {} : { property: reference.property }),
        });
      }
      return Object.freeze({ reference: index });
    }
    if (value === undefined) return Object.freeze({ absent: true });
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return Object.freeze({ array: Object.freeze(value.map(encode)) });
    if (typeof value === "object") return Object.freeze({ record: Object.freeze(Object.entries(value).map(([key, member]) => Object.freeze([key, encode(member)]))) });
    throw definitionError("invalidDefinition", "Unsupported identity literal");
  }
  const entries = nodes.map(node => Object.freeze({ name: node.name, kind: node.kind,
    guards: Object.freeze(node.guards.map(position)), input: encode(node.input),
    ...(node.kind === "workflow" ? { workflow: node.workflow.identity } : { hook: node.hook, bound: node.boundHook === true }),
  }));
  const output = encode(result);
  return Object.freeze({ name, nodes: Object.freeze(entries), references: Object.freeze(references), result: output });
}
