import type { LocalWorkflow } from "@medusajs/orchestration/workflow/local-workflow"
import type { LoadedModule, MedusaContainer } from "@medusajs/types"
import { ExportedWorkflow } from "./helper"

class MedusaWorkflow {
  static workflows: Record<
    string,
    (
      container?: LoadedModule[] | MedusaContainer
    ) => Omit<
      LocalWorkflow,
      "run" | "registerStepSuccess" | "registerStepFailure" | "cancel"
    > &
      ExportedWorkflow
  > = {}

  static registerWorkflow(workflowId, exportedWorkflow) {
    if (workflowId in MedusaWorkflow.workflows) {
      return
    }

    MedusaWorkflow.workflows[workflowId] = exportedWorkflow
  }

  static unregisterWorkflow(workflowId) {
    delete MedusaWorkflow.workflows[workflowId]
  }

  static getWorkflow(workflowId): ExportedWorkflow {
    return MedusaWorkflow.workflows[workflowId] as unknown as ExportedWorkflow
  }
}

const medusaWorkflowGlobal = globalThis as typeof globalThis & {
  MedusaWorkflow?: typeof MedusaWorkflow
}

medusaWorkflowGlobal.MedusaWorkflow ??= MedusaWorkflow
const GlobalMedusaWorkflow = medusaWorkflowGlobal.MedusaWorkflow

export { GlobalMedusaWorkflow as MedusaWorkflow }
