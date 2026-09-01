import {
  workflowEngineInMemoryModuleDefinition,
  workflowEngineInMemoryModuleExports,
  workflowEngineInMemoryStaticResources,
} from "../static-manifest"
import { WorkflowExecution } from "../models"
import {
  WorkflowOrchestratorService,
  WorkflowsModuleService,
} from "../services"

describe("workflow-engine-inmemory static manifest", () => {
  it("exports Worker-safe static resources for explicit module composition", () => {
    expect(workflowEngineInMemoryModuleDefinition.key).toBe("workflows")
    expect(workflowEngineInMemoryModuleExports.service).toBe(
      WorkflowsModuleService
    )
    expect(workflowEngineInMemoryModuleExports.loaders).toEqual([])
    expect(workflowEngineInMemoryStaticResources.models).toEqual([
      WorkflowExecution,
    ])
    expect(workflowEngineInMemoryStaticResources.services).toEqual([
      WorkflowOrchestratorService,
    ])
    expect(workflowEngineInMemoryStaticResources.moduleService).toBe(
      WorkflowsModuleService
    )
    expect(workflowEngineInMemoryStaticResources.loaders).toHaveLength(1)
  })
})
