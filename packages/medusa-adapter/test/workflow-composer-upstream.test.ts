// Adapted cases from pinned compose.spec.ts: assertions and business composers
// retained; invocation now uses the native executor port instead of the scheduler.
import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse, createHook, type WorkflowData, type WorkflowDefinition } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { runEffect } from "../../persistence-postgres/test/effectTestRuntime";

const port: WorkflowExecutionPort<Error> = {
 checkpoint: Effect.void,
 capture: value => Effect.sync(() => structuredClone(value)),
 invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause instanceof Error ? cause : new Error("Foreign callback failed") }),
 context: { eventGroupId: "test-owned-group", container: { resolve() { throw new Error("No resources in pure composition cases"); } } },
};
async function run<I, O, H extends readonly unknown[]>(definition: WorkflowDefinition<I, O, H>, options: { input: I }) {
 return { result: await runEffect(executeWorkflow(Result.getOrThrow(definition.prepare()), options.input, port)) };
}
describe("selected upstream composer cases (native invocation)", () => {
  it("captures bounded definition literals and the full typed transformer chain", async () => {
    const literal = { value: 1 };
    const flow = createWorkflow("captured-literal", () => new WorkflowResponse(transform(literal,
      value => value.value + 1, value => value + 1, value => value + 1,
      value => value + 1, value => value + 1, value => value + 1, value => value + 1)));
    literal.value = 100;
    expect(await run(flow, { input: undefined })).toEqual({ result: 8 });
    const getter = vi.fn(() => 1);
    const unsafe = Object.defineProperty({}, "value", { get: getter, enumerable: true });
    expect(() => createWorkflow("accessor-literal", () => new WorkflowResponse(unsafe))).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => createWorkflow("oversized-literal", () => new WorkflowResponse(Array.from({ length: 4097 }, () => 1)))).toThrow();
  });
  // Adapted index.spec.ts hook-result case; expected result is retained.
  it("should allow reading results of a hook", async () => {
    const step1 = createStep("step1", () => new StepResponse({ result: "step1" }));
    const workflow = createWorkflow("hook-result", (input: WorkflowData<{ id: number }>) => {
      const step1Result = step1(undefined);
      const hook = createHook("mutateInputHook", { input, step1Result });
      return new WorkflowResponse({ input, step1Result, hookResult: hook.getResult() }, { hooks: [hook] });
    });
    const definition = Result.getOrThrow(workflow.prepare({ mutateInputHook: data => new StepResponse({
      input: { id: data.input.id + 1 }, step1Result: { result: `mutated-${data.step1Result.result}` },
    }) }));
    expect(await runEffect(executeWorkflow(definition, { id: 1 }, port))).toEqual({
      input: { id: 1 }, step1Result: { result: "step1" }, hookResult: { input: { id: 2 }, step1Result: { result: "mutated-step1" } },
    });
    expect(await runEffect(executeWorkflow(Result.getOrThrow(workflow.prepare()), { id: 1 }, port)))
      .toEqual({ input: { id: 1 }, step1Result: { result: "step1" }, hookResult: undefined });
    // Two independent host bundles may use this same name without changing the first.
    expect(await runEffect(executeWorkflow(definition, { id: 1 }, port))).toMatchObject({ hookResult: { input: { id: 2 } } });
    expect(() => Result.getOrThrow(workflow.prepare({ mutateInputHook: () => undefined }, { mutateInputHook: () => undefined })))
      .toThrow("Cannot define multiple hook handlers for the mutateInputHook hook");
  });

  it("restores composition after failure and refuses unsupported options before handlers run", () => {
    const handler = vi.fn();
    for (const option of ["async", "maxRetries", "nested", "backgroundExecution", "timeout", "compensateAsync"]) {
      expect(() => Reflect.apply(createStep, undefined, [{ name: "unsupported", [option]: true }, handler])).toThrow();
    }
    expect(handler).not.toHaveBeenCalled();
    expect(() => createStep("external-compensator", () => undefined, () => undefined)).toThrow();
    expect(() => createWorkflow("throws", () => { throw new Error("composer failed"); })).toThrow("composer failed");
    const step = createStep("after-failure", (input: number) => input);
    expect(() => step(1)).toThrow("Use inside createWorkflow");
    expect(() => createWorkflow("clean", () => new WorkflowResponse(step(1)))).not.toThrow();
  });

  it("keeps transform failures in the native error channel and never invokes covered compensators", async () => {
    const compensate = vi.fn();
    const step = createStep({ name: "covered", compensation: "transactionCovered" }, () => new StepResponse(1), compensate);
    const failure = new Error("transform failed");
    const workflow = createWorkflow("transform-failure", () => new WorkflowResponse(transform(step(undefined), () => { throw failure; })));
    const exit = await runEffect(Effect.exit(executeWorkflow(Result.getOrThrow(workflow.prepare()), undefined, port)));
    expect(exit._tag).toBe("Failure");
    expect(compensate).not.toHaveBeenCalled();
  });
it("should compose a new workflow and execute it", async () => {
      const mockStep1Fn = vi.fn().mockImplementation((input) => {
        return { inputs: [input], obj: "return from 1" }
      })
      const mockStep2Fn = vi.fn().mockImplementation((...inputs) => {
        inputs.pop()
        return {
          inputs,
          obj: "return from 2",
        }
      })
      const mockStep3Fn = vi.fn().mockImplementation((...inputs) => {
        inputs.pop()
        return {
          inputs,
          obj: "return from 3",
        }
      })

      const step1 = createStep("step1", mockStep1Fn)
      const step2 = createStep("step2", mockStep2Fn)
      const step3 = createStep("step3", mockStep3Fn)

      const workflow = createWorkflow("workflow1", function (input) {
        const returnStep1 = step1(input)
        const ret2 = step2(returnStep1)
        return new WorkflowResponse(step3({ one: returnStep1, two: ret2 }))
      })

      const workflowInput = { test: "payload1" }
      const { result: workflowResult } = await run(workflow, {
        input: workflowInput,
      })

      expect(mockStep1Fn).toHaveBeenCalledTimes(1)
      expect(mockStep1Fn.mock.calls[0]).toHaveLength(2)
      expect(mockStep1Fn.mock.calls[0]?.[0]).toEqual(workflowInput)

      expect(mockStep2Fn).toHaveBeenCalledTimes(1)
      expect(mockStep2Fn.mock.calls[0]).toHaveLength(2)
      expect(mockStep2Fn.mock.calls[0]?.[0]).toEqual({
        inputs: [workflowInput],
        obj: "return from 1",
      })

      expect(mockStep3Fn).toHaveBeenCalledTimes(1)
      expect(mockStep3Fn.mock.calls[0]).toHaveLength(2)
      expect(mockStep3Fn.mock.calls[0]?.[0]).toEqual({
        one: {
          inputs: [workflowInput],
          obj: "return from 1",
        },
        two: {
          inputs: [
            {
              inputs: [workflowInput],
              obj: "return from 1",
            },
          ],
          obj: "return from 2",
        },
      })

      expect(workflowResult).toEqual({
        inputs: [
          {
            one: {
              inputs: [workflowInput],
              obj: "return from 1",
            },
            two: {
              inputs: [
                {
                  inputs: [workflowInput],
                  obj: "return from 1",
                },
              ],
              obj: "return from 2",
            },
          },
        ],
        obj: "return from 3",
      })
    })

it("should transform the values before forward them to the next step", async () => {
      const mockStep1Fn = vi.fn().mockImplementation((obj, context) => {
        const ret = {
          property: "property",
        }
        return ret
      })

      const mockStep2Fn = vi.fn().mockImplementation((obj, context) => {
        const ret = {
          ...obj,
          sum: "sum = " + obj.sum,
        }

        return ret
      })

      const mockStep3Fn = vi.fn().mockImplementation((param, context) => {
        const ret = {
          avg: "avg = " + param.avg,
          ...param,
        }
        return ret
      })

      const transform1Fn = vi
        .fn()
        .mockImplementation(({ input, step1Result }) => {
          const newObj = {
            ...step1Result,
            ...input,
            sum: input.a + input.b,
          }
          return {
            input: newObj,
          }
        })

      const transform2Fn = vi
        .fn()
        .mockImplementation(async ({ input }, context) => {
          input.another_prop = "another_prop"
          return input
        })

      const transform3Fn = vi.fn().mockImplementation(({ obj }) => {
        obj.avg = (obj.a + obj.b) / 2

        return obj
      })

      const step1 = createStep("step1", mockStep1Fn)
      const step2 = createStep("step2", mockStep2Fn)
      const step3 = createStep("step3", mockStep3Fn)

      const mainFlow = createWorkflow("test_", function (input) {
        const step1Result = step1(input)

        const sum = transform(
          { input, step1Result },
          transform1Fn,
          transform2Fn
        )

        const ret2 = step2(sum)

        const avg = transform({ obj: ret2 }, transform3Fn)

        return new WorkflowResponse(step3(avg))
      })

      const workflowInput = { a: 1, b: 2 }
      await run(mainFlow, { input: workflowInput })

      expect(mockStep1Fn.mock.calls[0]?.[0]).toEqual(workflowInput)

      expect(mockStep2Fn.mock.calls[0]?.[0]).toEqual({
        property: "property",
        a: 1,
        b: 2,
        sum: 3,
        another_prop: "another_prop",
      })

      expect(mockStep3Fn.mock.calls[0]?.[0]).toEqual({
        sum: "sum = 3",
        property: "property",
        a: 1,
        b: 2,
        another_prop: "another_prop",
        avg: 1.5,
      })

      expect(transform1Fn).toHaveBeenCalledTimes(1)
      expect(transform2Fn).toHaveBeenCalledTimes(1)
      expect(transform3Fn).toHaveBeenCalledTimes(1)
    })
  it("should compose a workflow that returns destructured properties", async () => {
    const step = function () {
      return new StepResponse({
        propertyNotReturned: 1234,
        property: {
          complex: {
            nested: 123,
          },
          a: "bc",
        },
        obj: "return from 2",
      })
    }

    const step1 = createStep("step1", step)

    const workflow = createWorkflow("workflow1", function () {
      const { property, obj } = step1(undefined)

      return new WorkflowResponse({ someOtherName: property, obj })
    })

    const { result } = await run(workflow, {
      input: undefined,
    })

    expect(result).toEqual({
      someOtherName: {
        complex: {
          nested: 123,
        },
        a: "bc",
      },
      obj: "return from 2",
    })
  })

  it("should compose a workflow that returns an array of steps", async () => {
    const step1 = createStep("step1", () => {
      return new StepResponse({
        obj: "return from 1",
      })
    })
    const step2 = createStep("step2", () => {
      return new StepResponse({
        obj: "returned from 2**",
      })
    })

    const workflow = createWorkflow("workflow1", function () {
      const s1 = step1(undefined)
      const s2 = step2(undefined)

      return new WorkflowResponse([s1, s2])
    })

    const { result } = await run(workflow, {
      input: undefined,
    })

    expect(result).toEqual([
      {
        obj: "return from 1",
      },
      {
        obj: "returned from 2**",
      },
    ])
  })

  it("should compose a workflow that returns an object mixed of steps and properties", async () => {
    const step1 = createStep("step1", () => {
      return new StepResponse({
        obj: {
          nested: "nested",
        },
      })
    })

    const step2 = createStep("step2", () => {
      return new StepResponse({
        obj: "returned from 2**",
      })
    })

    const workflow = createWorkflow("workflow1", function () {
      const { obj } = step1(undefined)
      const s2 = step2(undefined)

      return new WorkflowResponse([{ step1_nested_obj: obj.nested }, s2])
    })

    const { result } = await run(workflow, {
      input: undefined,
    })

    expect(result).toEqual([
      {
        step1_nested_obj: "nested",
      },
      {
        obj: "returned from 2**",
      },
    ])
  })


});
