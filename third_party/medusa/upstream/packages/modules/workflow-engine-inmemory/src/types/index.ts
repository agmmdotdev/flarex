import type { ContainerLike, Logger } from "@medusajs/types"
import { FlowCancelOptions } from "@medusajs/workflows-sdk/helper/type"

export type InitializeModuleInjectableDependencies = {
  logger?: Logger
}

export type WorkflowOrchestratorCancelOptions = Omit<
  FlowCancelOptions,
  "transaction" | "transactionId" | "container"
> & {
  transactionId: string
  container?: ContainerLike
}
