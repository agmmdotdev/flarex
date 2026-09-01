import { parseExpression } from "cron-parser"

import {
  defaultWorkflowSchedulerAdapter,
  type WorkflowSchedulerAdapter,
} from "./utils"

export const nodeWorkflowSchedulerAdapter: WorkflowSchedulerAdapter = {
  ...defaultWorkflowSchedulerAdapter,
  parseCron: (expression) => parseExpression(expression),
}
