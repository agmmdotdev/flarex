import { nodeWorkflowSchedulerAdapter } from "../node-scheduler-adapter"

describe("nodeWorkflowSchedulerAdapter", () => {
  it("parses cron expressions for the Node integration runtime", () => {
    const expression = nodeWorkflowSchedulerAdapter.parseCron?.("* * * * *")

    expect(expression?.next().getTime()).toEqual(expect.any(Number))
  })
})
