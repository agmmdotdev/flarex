declare module "flarex:platform" {
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
