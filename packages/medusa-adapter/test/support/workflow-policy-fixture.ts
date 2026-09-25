import { Result } from "effect";
import { defineWorkflowModule, workflowModuleDefinition, type WorkflowModule,
  type WorkflowLogicalPolicy, type WorkflowMethod } from "../../src/workflow/module";

/** Fault injection at the owning module's construction boundary, preserving its
 * native command tokens and using the production constructor for validation. */
export function withWorkflowPolicy<Methods extends Readonly<Record<string, WorkflowMethod>>>(
  module: WorkflowModule<Methods>, update: (policy: WorkflowLogicalPolicy) => WorkflowLogicalPolicy,
): WorkflowModule<Methods> {
  const definition = workflowModuleDefinition(module);
  if (definition?.logical === undefined) throw new Error("Missing module logical policy");
  return Result.getOrThrow(defineWorkflowModule({ name: module.name, methods: module.methods,
    source: definition.source, graph: definition.graph, logical: update(definition.logical) }));
}
