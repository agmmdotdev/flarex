import { asClass, asValue } from "@medusajs/framework/awilix"
import type { MedusaContainer } from "@medusajs/types"
import {
  InMemoryWorkflowDelayedActionStore,
  InMemoryWorkflowScheduleStore,
  InternalServiceWorkflowExecutionStore,
  defaultWorkflowSchedulerAdapter,
  InMemoryDistributedTransactionStorage,
} from "../utils"

export default async ({
  container,
}: {
  container: MedusaContainer
}): Promise<void> => {
  if (!container.hasRegistration("workflowSchedulerAdapter")) {
    container.register({
      workflowSchedulerAdapter: asValue(defaultWorkflowSchedulerAdapter),
    })
  }

  if (!container.hasRegistration("workflowScheduleStore")) {
    container.register({
      workflowScheduleStore: asClass(InMemoryWorkflowScheduleStore).singleton(),
    })
  }

  if (!container.hasRegistration("workflowExecutionStore")) {
    container.register({
      workflowExecutionStore: asClass(
        InternalServiceWorkflowExecutionStore
      ).singleton(),
    })
  }

  if (!container.hasRegistration("workflowDelayedActionStore")) {
    container.register({
      workflowDelayedActionStore: asClass(
        InMemoryWorkflowDelayedActionStore
      ).singleton(),
    })
  }

  container.register({
    inMemoryDistributedTransactionStorage: asClass(
      InMemoryDistributedTransactionStorage
    ).singleton(),
  })
}
