/** Adapted from the pinned SDK response wrappers. Compensation is retained as
 * declaration data; the selected atomic runtime delegates rollback to its owner. */
export class StepResponse<Output = undefined, Compensation = Output> {
  readonly #output: Output;
  readonly #compensateInput: Compensation | Output;
  constructor(output: Output, compensateInput?: Compensation) {
    this.#output = output;
    this.#compensateInput = compensateInput === undefined ? output : compensateInput;
  }
  get __type() { return Symbol.for("WorkflowStepResponse").toString(); }
  get output() { return this.#output; }
  get compensateInput() { return this.#compensateInput; }
  toJSON() { return { __type: this.__type, output: this.#output, compensateInput: this.#compensateInput }; }
}
export class WorkflowResponse<Output, const Hooks extends readonly unknown[] = readonly []> {
  readonly __type = Symbol.for("MedusaWorkflowResponse").toString();
  constructor(readonly $result: Output, readonly options?: { readonly hooks: Hooks }) {}
}
