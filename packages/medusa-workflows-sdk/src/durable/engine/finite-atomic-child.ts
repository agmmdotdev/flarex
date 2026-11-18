import { createStep } from "../utils/composer/create-step.js"
import { createWorkflow } from "../utils/composer/create-workflow.js"
import { StepResponse } from "../utils/composer/helpers/step-response.js"
import { WorkflowResponse } from "../utils/composer/helpers/workflow-response.js"
import type { StepExecutionContext } from "../utils/composer/type.js"

/** The prepared callback has its own atomic settlement/rollback owner. It is
 * resolved from the current execution container, never captured at registration. */
export interface FiniteAtomicChildPort<Input, Output> {
  invoke(input: Input, context: StepExecutionContext): Promise<Output>
}

/** An explicit native execution profile around an already admitted atomic graph.
 * The real native orchestrator owns this synchronous step and DistributedTransaction.
 * No async/retry/timeout/retention option is added, so native checkpointing remains
 * absent. Parent runAsStep, triggerParentStep and cancellation keep their owners.
 * This profile does not claim the original batch's internal native step inventory. */
export function createFiniteAtomicChildWorkflow<Input, Output>(name: string, service: string) {
  const invoke = createStep<{ input: Input }, Output, Output>(
    { name: `${name}-atomic-child`, noCompensation: true },
    async ({ input }, context) => {
      const port = context.container.resolve<FiniteAtomicChildPort<Input, Output>>(service)
      return new StepResponse(await port.invoke(input, context))
    }
  )
  return createWorkflow<Input, Output, []>(name, input => new WorkflowResponse(invoke({ input })))
}
