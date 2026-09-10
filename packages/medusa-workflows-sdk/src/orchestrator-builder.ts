/** Selected ordered graph mechanics from Medusa's OrchestratorBuilder.
 * Branch insertion/movement and persisted transaction loading are unadmitted. */
interface InternalStep {
  readonly action?: string;
  readonly depth: number;
  readonly parent?: string;
  next?: InternalStep;
}
export interface OrderedStep { readonly action: string; readonly next?: OrderedStep }
export class OrchestratorBuilder {
  protected steps: InternalStep = { depth: -1 };
  protected hasChanges_ = false;
  get hasChanges() { return this.hasChanges_; }
  addAction(action: string) {
    const step = this.findLastStep();
    const newAction = { action, depth: step.depth + 1, ...(step.action === undefined ? {} : { parent: step.action }) };
    step.next = newAction;
    this.hasChanges_ = true;
    return this;
  }
  protected findLastStep(steps: InternalStep = this.steps): InternalStep {
    let step = steps;
    while (step.next) step = step.next;
    return step;
  }
  build(): OrderedStep | undefined {
    // The selected graph contains only names and a single next pointer. Copy
    // these fields directly instead of the upstream JSON round-trip/reviver.
    const copy = (step: InternalStep | undefined): OrderedStep | undefined => {
      if (step?.action === undefined) return undefined;
      const next = copy(step.next);
      return Object.freeze({ action: step.action, ...(next === undefined ? {} : { next }) });
    };
    this.hasChanges_ = false;
    return copy(this.steps.next);
  }
}
