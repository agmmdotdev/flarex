import { Data } from "effect";
import type { StepResponse } from "./responses";
import type { PreparedWorkflow } from "./definition";

/** Medusa's staged authoring type: values are references until runtime resolution. */
export declare const dataBrand: unique symbol;
export type WorkflowData<T> = [T] extends [never] ? { readonly [dataBrand]: T }
  : T extends null | void ? { readonly [dataBrand]: T } : T & { readonly [dataBrand]: T };
export type StepOutput<Output> = WorkflowData<Output> & {
  readonly config: (options: { readonly name: string }) => StepOutput<Output>;
};
export interface StepFunction<Input, Output> { (input: Input | WorkflowData<Input>): StepOutput<Output> }
export type Resolved<T> = T extends { readonly [dataBrand]: infer Value } ? Value : T extends readonly unknown[]
  ? { [Key in keyof T]: Resolved<T[Key]> } : T extends object ? { [Key in keyof T]: Resolved<T[Key]> } : T;
/** Narrow, trusted resource view. The adapter authenticates every resolved method. */
export interface WorkflowContainer { resolve<T>(name: string): T }
export interface StepExecutionContext { readonly container: WorkflowContainer; readonly eventGroupId: string }
export type Invoke<Input, Output, Compensation = Output> = (input: Input, context: StepExecutionContext) =>
  Output | StepResponse<Output, Compensation> | Promise<Output | StepResponse<Output, Compensation>>;
export type Compensate<Input> = (input: Input | undefined, context: StepExecutionContext) => void | Promise<void>;
export interface StepOptions { readonly name: string; readonly compensation?: "transactionCovered" }
export class WorkflowDefinitionError extends Data.TaggedError("WorkflowDefinitionError")<{
  readonly reason: "unsupportedProfile" | "outsideComposer" | "duplicateStep" | "duplicateHook" | "invalidReference" | "invalidDefinition";
  readonly detail: string;
}> { override get message() { return this.detail; } }
export const definitionError = (reason: WorkflowDefinitionError["reason"], detail: string) => new WorkflowDefinitionError({ reason, detail });
interface WorkflowNodeBase {
  readonly id: object;
  readonly guards: readonly object[];
  readonly name: string;
  readonly input: unknown;
}
export type WorkflowNode = WorkflowNodeBase & ({
  readonly kind: "workflow";
  readonly workflow: PreparedWorkflow;
} | {
  readonly kind: "step" | "condition" | "branchResult";
  readonly invoke: Invoke<unknown, unknown>;
  readonly compensate: Compensate<unknown> | undefined;
  readonly compensation: "transactionCovered" | undefined;
  readonly hook: boolean;
  readonly boundHook?: boolean;
});
export interface Reference {
  readonly kind: "input" | "step" | "transform" | "property";
  readonly owner: object;
  readonly step?: object;
  readonly guards?: readonly object[];
  readonly input?: unknown;
  readonly property?: PropertyKey;
  readonly transform?: (value: unknown, context: StepExecutionContext) => unknown | Promise<unknown>;
}
export interface Hook<Name extends string, Input, Output = unknown> {
  readonly name: Name;
  readonly " input"?: Input;
  readonly " output"?: Output;
  readonly getResult: () => WorkflowData<Output | undefined>;
}
export type HookHandlers<Hooks extends readonly unknown[]> = {
  readonly [H in Hooks[number] as H extends Hook<infer Name, infer _Input, infer _Output> ? Name : never]?:
    H extends Hook<string, infer Input, infer Output> ? Invoke<Resolved<Input>, Output> : never;
};
