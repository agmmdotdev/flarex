import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { loadUtils } from "./loaders"
import { WorkflowExecution } from "./models"
import {
  WorkflowOrchestratorService,
  WorkflowsModuleService,
} from "./services"

export const workflowEngineInMemoryModuleDefinition =
  ModulesDefinition[Modules.WORKFLOW_ENGINE]

export const workflowEngineInMemoryModuleModels = [WorkflowExecution]

export const workflowEngineInMemoryModuleExports: ModuleExports = {
  service: WorkflowsModuleService,
  loaders: [],
}

export const workflowEngineInMemoryStaticResources: StaticModuleResources = {
  models: workflowEngineInMemoryModuleModels,
  services: [WorkflowOrchestratorService],
  repositories: [],
  loaders: [loadUtils],
  moduleService: WorkflowsModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.WORKFLOW_ENGINE, {
    models: workflowEngineInMemoryModuleModels,
  }),
}
