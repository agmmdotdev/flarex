import type { Context } from "@medusajs/types"
import { isDefined } from "@medusajs/utils/common/is-defined"
import type { ReturnWorkflow, UnwrapWorkflowInputDataType } from "../index.js"
import { WorkflowOrchestratorService, type IdempotencyKeyParts, type WorkflowOrchestratorCancelOptions, type WorkflowOrchestratorRunOptions } from "./workflow-orchestrator.js"

/** Portable extraction of the genuine native module's execution methods.
 * Administrative DAL, ORM managers and Redis lifecycle are outside this profile. */
export class WorkflowsModuleService {
  constructor(protected readonly workflowOrchestratorService_: WorkflowOrchestratorService) {}

  async run<TWorkflow extends string | ReturnWorkflow<any, any, any>>(
      workflowIdOrWorkflow: TWorkflow,
      options: WorkflowOrchestratorRunOptions<
        TWorkflow extends ReturnWorkflow<any, any, any>
          ? UnwrapWorkflowInputDataType<TWorkflow>
          : unknown
      > = {},
      context: Context = {}
    ) {
      const options_ = JSON.parse(JSON.stringify(options ?? {}))

      const {
        manager,
        transactionManager,
        preventReleaseEvents,
        transactionId,
        parentStepIdempotencyKey,
        ...restContext
      } = context

      let localPreventReleaseEvents = false

      if (isDefined(options_.context?.preventReleaseEvents)) {
        localPreventReleaseEvents = options_.context!.preventReleaseEvents!
      } else {
        if (
          isDefined(context.eventGroupId) &&
          isDefined(options_.context?.eventGroupId) &&
          context.eventGroupId === options_.context?.eventGroupId
        ) {
          localPreventReleaseEvents = true
        }
      }

      let eventGroupId

      if (options_.context?.eventGroupId) {
        eventGroupId = options_.context.eventGroupId
      } else if (localPreventReleaseEvents && context.eventGroupId) {
        eventGroupId = context.eventGroupId
      }

      options_.context = {
        ...(restContext ?? {}),
        ...(options_.context ?? {}),
        eventGroupId,
        preventReleaseEvents: localPreventReleaseEvents,
      }

      const ret = await this.workflowOrchestratorService_.run<
        TWorkflow extends ReturnWorkflow<any, any, any>
          ? UnwrapWorkflowInputDataType<TWorkflow>
          : unknown
      >(workflowIdOrWorkflow, options_)

      return ret as any
    }

  async getRunningTransaction(
      workflowId: string,
      transactionId: string,
      context: Context = {}
    ) {
      return await this.workflowOrchestratorService_.getRunningTransaction(
        workflowId,
        transactionId,
        context
      )
    }

  async setStepSuccess(
      {
        idempotencyKey,
        stepResponse,
        options,
      }: {
        idempotencyKey: string | object
        stepResponse: unknown
        options?: Record<string, any>
      },
      context: Context = {}
    ) {
      const options_ = JSON.parse(JSON.stringify(options ?? {}))

      const { manager, transactionManager, ...restContext } = context

      options_.context ??= restContext

      return await this.workflowOrchestratorService_.setStepSuccess({
        idempotencyKey,
        stepResponse,
        options: options_,
      } as any)
    }

  async setStepFailure(
      {
        idempotencyKey,
        stepResponse,
        options,
      }: {
        idempotencyKey: string | object
        stepResponse: unknown
        options?: Record<string, any> & {
          forcePermanentFailure?: boolean
        }
      },
      context: Context = {}
    ) {
      const options_ = JSON.parse(JSON.stringify(options ?? {}))

      const { manager, transactionManager, ...restContext } = context

      options_.context ??= restContext

      return await this.workflowOrchestratorService_.setStepFailure({
        idempotencyKey,
        stepResponse,
        options: options_,
      } as any)
    }

  async retryStep(
      {
        idempotencyKey,
        options,
      }: {
        idempotencyKey: string | IdempotencyKeyParts
        options?: Record<string, any>
      },
      context: Context = {}
    ) {
      const options_ = JSON.parse(JSON.stringify(options ?? {}))

      const { manager, transactionManager, ...restContext } = context

      options_.context ??= restContext

      return await this.workflowOrchestratorService_.retryStep({
        idempotencyKey,
        options: options_,
      })
    }

  async cancel(workflowId: string, options: WorkflowOrchestratorCancelOptions) {
      return await this.workflowOrchestratorService_.cancel(workflowId, options)
    }
}
