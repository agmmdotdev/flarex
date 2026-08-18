import { Effect } from "effect";

export interface ApplicationWorkerEntrypointLoad<Entrypoint, Failure> {
  readonly code: WorkerLoaderWorkerCode;
  readonly entrypointName: string;
  readonly selectEntrypoint: (
    worker: WorkerStub,
    entrypointName: string,
  ) => Entrypoint;
  readonly onFailure: (cause: unknown) => Failure;
}

export interface ApplicationWorkerRuntime {
  readonly loadEntrypoint: <Entrypoint, Failure>(
    input: ApplicationWorkerEntrypointLoad<Entrypoint, Failure>,
  ) => Effect.Effect<Entrypoint, Failure>;
}

export interface ApplicationWorkerCodeInput {
  readonly compatibilityDate: string;
  readonly compatibilityFlags?: ReadonlyArray<string>;
  readonly mainModule: string;
  readonly modules: Readonly<Record<string, WorkerLoaderModule | string>>;
  readonly env: Readonly<Record<PropertyKey, unknown>>;
  readonly limits: NonNullable<WorkerLoaderWorkerCode["limits"]>;
  readonly globalOutbound: Exclude<
    WorkerLoaderWorkerCode["globalOutbound"],
    undefined
  >;
}

/**
 * Exact Application Worker Loader code projection shared by foreground
 * transaction/action execution and accepted Task sessions. Validation remains
 * with each operation-specific definition owner.
 */
export function applicationWorkerCode(
  input: ApplicationWorkerCodeInput,
): WorkerLoaderWorkerCode {
  const shared = {
    compatibilityDate: input.compatibilityDate,
    mainModule: input.mainModule,
    modules: input.modules,
    env: input.env,
    limits: input.limits,
    globalOutbound: input.globalOutbound,
  };
  return input.compatibilityFlags === undefined
    ? shared
    : { ...shared, compatibilityFlags: [...input.compatibilityFlags] };
}

/**
 * Application-owned fresh Worker entrypoint acquisition shared by one-shot
 * function execution and accepted Task sessions. The caller retains its
 * operation-specific error contract and every later RPC/session lifetime.
 *
 * This remains a plain multi-instance capability because tests and hosts may
 * own several independent WorkerLoader instances in one Effect Context.
 */
export function makeApplicationWorkerRuntime(
  loader: WorkerLoader,
): ApplicationWorkerRuntime {
  const loadEntrypoint: ApplicationWorkerRuntime["loadEntrypoint"] = Effect.fn(
    "ApplicationWorkerRuntime.loadEntrypoint",
  )(function* <Entrypoint, Failure>(
    input: ApplicationWorkerEntrypointLoad<Entrypoint, Failure>,
  ): Effect.fn.Return<Entrypoint, Failure> {
    return yield* Effect.try({
      try: (): Entrypoint =>
        input.selectEntrypoint(loader.load(input.code), input.entrypointName),
      catch: input.onFailure,
    });
  });

  return Object.freeze({ loadEntrypoint });
}
