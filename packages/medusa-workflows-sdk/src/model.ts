import { Data } from "effect";
import type { StepResponse } from "./responses";
import type { PreparedWorkflow } from "./definition";

/** Medusa's staged authoring type: values are references until runtime resolution. */
export declare const dataBrand: unique symbol;
export type WorkflowData<T> = [T] extends [never] ? { readonly [dataBrand]: T }
  : T extends null | void ? { readonly [dataBrand]: T } : T & { readonly [dataBrand]: T };
export type StepOutput<Output> = WorkflowData<Output> & {
  readonly config: (options: { readonly name: string; readonly noCompensation?: true } | { readonly noCompensation: true; readonly name?: string }) => StepOutput<Output>;
};
/** Definition inputs may place typed references at any resolved data member.
 * Branded references must match that member's value type; they cannot enter
 * through an otherwise structurally compatible literal record or array. */
type WorkflowInput<T> = WorkflowData<T> | (T extends Date | ((...args: never[]) => unknown) ? T
  : T extends readonly unknown[] ? { [Key in keyof T]: WorkflowInput<T[Key]> } & { readonly [dataBrand]?: never }
  : T extends object ? { [Key in keyof T]: WorkflowInput<T[Key]> } & { readonly [dataBrand]?: never } : T);
export interface StepFunction<Input, Output> { (input: WorkflowInput<Input>): StepOutput<Output> }
/** Resolve structural authoring records without projecting nominal values into
 * public member bags. A private/protected identity is absent from Pick's keys;
 * preserving its type does not admit class instances at a runtime boundary. */
export type Resolved<T> = T extends { readonly [dataBrand]: infer Value } ? Value
  : T extends Date | ((...args: never[]) => unknown) ? T
  : T extends object ? Pick<T, keyof T> extends T ? { [Key in keyof T]: Resolved<T[Key]> } : T : T;
/** Narrow, trusted resource view. The adapter authenticates every resolved method. */
export interface WorkflowContainer {
  resolve<T>(name: string): T;
  resolve<T>(name: string, options: { readonly allowUnregistered: true }): T | undefined;
}
export interface StepExecutionContext {
  readonly container: WorkflowContainer;
  readonly eventGroupId: string;
  /** Trusted root and complete prepared-node occurrence identity. Identifies
   * an invocation; it grants no resource, storage or compensation authority. */
  readonly idempotencyKey?: string;
}
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
export interface ParallelBranch { readonly start: number; readonly end: number }
export interface ParallelGroup { readonly branches: readonly ParallelBranch[] }
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
