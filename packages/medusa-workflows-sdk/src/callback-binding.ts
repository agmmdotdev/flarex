import type { PreparedWorkflow } from "./definition";
import { definitionError, type WorkflowContainer } from "./model";

type ChildRunner = (definition: object, options: unknown) => Promise<{ readonly result: unknown }>;
// Issuer evidence only: each value is a particular live callback's borrowed port.
// Neither container properties nor a process-wide current runner grant admission.
const bindings = new WeakMap<WorkflowContainer, { readonly run: ChildRunner; readonly assertLive: () => void }>();
const definitions = new WeakMap<object, () => PreparedWorkflow>();

export function registerCallbackWorkflow(definition: object, prepare: () => PreparedWorkflow): void {
  definitions.set(definition, prepare);
}
export function prepareCallbackWorkflow(definition: object): PreparedWorkflow {
  const prepare = definitions.get(definition);
  if (prepare === undefined) throw definitionError("invalidDefinition", "Callback children must be authentic workflow definitions");
  return prepare();
}
export function callbackWorkflowView(definition: object, container: WorkflowContainer) {
  const binding = bindings.get(container);
  if (binding === undefined) throw definitionError("unsupportedProfile", "Callback workflow requires a live parent container");
  binding.assertLive();
  return Object.freeze({ run: (options: { readonly input: unknown }) => binding.run(definition, options) });
}
/** Execute only inside the borrowed foreign callback owner. Proxy reflection
 * may throw; that complete defect must be recorded before exposing rejection. */
export function callbackWorkflowInput(options: unknown): unknown {
  if (typeof options !== "object" || options === null) throw definitionError("unsupportedProfile", "Invalid callback workflow options");
  const property = Object.getOwnPropertyDescriptor(options, "input");
  if (property === undefined || !("value" in property) || !property.enumerable ||
    Reflect.ownKeys(options).length !== 1 ||
    (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null))
    throw definitionError("unsupportedProfile", "Invalid callback workflow options");
  return property.value;
}
export function bindCallbackContainer(container: WorkflowContainer, run: ChildRunner,
  refuse: (error: ReturnType<typeof definitionError>) => never) {
  let live = true;
  const assertLive = () => { if (!live) refuse(definitionError("unsupportedProfile", "Callback container binding has expired")); };
  function resolve<Value>(name: string): Value;
  function resolve<Value>(name: string, options: { readonly allowUnregistered: true }): Value | undefined;
  function resolve<Value>(_name: string, _options?: { readonly allowUnregistered: true }): Value | undefined {
    assertLive();
    // Preserve exact arity, explicit undefined, extra arguments and receiver so
    // the parent's strict native resolver remains the ABI/authority owner.
    return Reflect.apply(container.resolve, container, arguments);
  }
  const facade: WorkflowContainer = Object.freeze({ resolve });
  // Retain weak issuer evidence after revocation so a saved handle's refusal
  // still reaches its own owner; it can never borrow another request's runner.
  bindings.set(facade, { run, assertLive });
  return { container: facade, revoke: () => { live = false; } };
}
