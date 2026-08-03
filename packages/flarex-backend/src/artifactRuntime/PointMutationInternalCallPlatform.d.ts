declare module "flarex:platform" {
  import type {
    PointMutationInternalCallRuntimeContextV1,
  } from "@flarex/function-runtime/point-mutation-internal-call";

  export function withPointMutationInternalCallContextV1<A>(
    context: PointMutationInternalCallRuntimeContextV1,
    operation: () => A | PromiseLike<A>,
  ): Promise<Awaited<A>>;

  export function inspectPointMutationInternalCallCoreApplicationErrorV1(
    value: unknown,
  ): boolean;

  export function errorCreate(
    code: unknown,
    message: unknown,
    data?: unknown,
  ): Error;
  export function errorCode(error: unknown): string;
  export function errorMessage(error: unknown): string;
  export function errorData(error: unknown): unknown;
}
