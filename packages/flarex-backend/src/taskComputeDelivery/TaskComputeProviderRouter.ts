import {
  TaskComputeCancellationRejectedError,
  TaskComputeDispatchContractError,
  TaskComputeDispatchRejectedError,
  TaskComputeProvider,
  decodeTaskComputeProviderDescriptorV1,
  makeTaskComputeProviderV1,
  type TaskComputeProviderDescriptorV1,
  type TaskComputeProviderShape,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  TaskComputeProfileRefV1Schema,
  type TaskComputeProfileRefV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Layer, Result, Schema } from "effect";

export interface TaskComputeProviderRoute {
  readonly descriptor: TaskComputeProviderDescriptorV1;
  readonly computeProfiles: ReadonlyArray<TaskComputeProfileRefV1>;
  readonly provider: TaskComputeProviderShape;
}

export class TaskComputeProviderRouterConfigurationError extends Data.TaggedError(
  "TaskComputeProviderRouterConfigurationError",
)<{
  readonly reason:
    | "invalid_routes"
    | "invalid_route"
    | "invalid_provider"
    | "duplicate_compute_profile"
    | "duplicate_provider";
  readonly cause?: unknown;
}> {}

interface CapturedProvider {
  readonly descriptor: TaskComputeProviderDescriptorV1;
  readonly provider: TaskComputeProviderShape;
}

interface CapturedRouter {
  readonly byComputeProfile: ReadonlyMap<TaskComputeProfileRefV1, CapturedProvider>;
  readonly byProvider: ReadonlyMap<string, CapturedProvider>;
}

interface CapturedRouteProperties {
  readonly descriptor: unknown;
  readonly computeProfiles: unknown;
  readonly provider: unknown;
}

const decodeComputeProfile = Schema.decodeUnknownResult(
  TaskComputeProfileRefV1Schema,
);

export function makeTaskComputeProviderRouter(
  routes: ReadonlyArray<TaskComputeProviderRoute>,
): Result.Result<
  TaskComputeProviderShape,
  TaskComputeProviderRouterConfigurationError
> {
  return captureRouter(routes).pipe(Result.map(router => {
    const dispatch: TaskComputeProviderShape["dispatch"] = Effect.fn(
      "TaskComputeProviderRouter.dispatch",
    )(function* (request) {
      const selected = router.byComputeProfile.get(request.computeProfile);
      if (selected === undefined) {
        return yield* new TaskComputeDispatchRejectedError({
          operation: "dispatch",
          reason: "unsupported_compute_profile",
          retryable: false,
          computeProfile: request.computeProfile,
        });
      }
      const acceptance = yield* selected.provider.dispatch(request);
      if (
        acceptance.execution.provider !== selected.descriptor.provider ||
        acceptance.execution.providerVersion !==
          selected.descriptor.providerVersion
      ) {
        return yield* new TaskComputeDispatchContractError({
          operation: "dispatch",
          reason: "receipt_correlation_mismatch",
          execution: acceptance.execution,
        });
      }
      return acceptance;
    });
    const requestCancellation: TaskComputeProviderShape["requestCancellation"] =
      Effect.fn("TaskComputeProviderRouter.requestCancellation")(
        function* (request) {
          const selected = router.byProvider.get(
            providerKey(request.execution),
          );
          if (selected === undefined) {
            return yield* new TaskComputeCancellationRejectedError({
              operation: "request_cancellation",
              reason: "execution_not_found",
              retryable: false,
            });
          }
          return yield* selected.provider.requestCancellation(request);
        },
      );
    const implementation: TaskComputeProviderShape = Object.freeze({
      dispatch,
      requestCancellation,
    });
    return makeTaskComputeProviderV1(implementation);
  }));
}

export function makeTaskComputeProviderRouterLayer(
  routes: ReadonlyArray<TaskComputeProviderRoute>,
): Layer.Layer<
  TaskComputeProvider,
  TaskComputeProviderRouterConfigurationError
> {
  return Layer.effect(
    TaskComputeProvider,
    Effect.fromResult(makeTaskComputeProviderRouter(routes)),
  );
}

function captureRouter(
  input: unknown,
): Result.Result<CapturedRouter, TaskComputeProviderRouterConfigurationError> {
  return Result.gen(function* () {
    const routeValues = yield* captureDenseDataArray(input, "invalid_routes");
    if (routeValues.length === 0) {
      return yield* Result.fail(configurationError("invalid_routes"));
    }
    const byComputeProfile = new Map<
      TaskComputeProfileRefV1,
      CapturedProvider
    >();
    const byProvider = new Map<string, CapturedProvider>();
    for (const routeValue of routeValues) {
      const route = yield* captureRoute(routeValue);
      const key = providerKey(route.descriptor);
      if (byProvider.has(key)) {
        return yield* Result.fail(configurationError("duplicate_provider"));
      }
      byProvider.set(key, route);
      for (const computeProfile of route.computeProfiles) {
        if (byComputeProfile.has(computeProfile)) {
          return yield* Result.fail(
            configurationError("duplicate_compute_profile"),
          );
        }
        byComputeProfile.set(computeProfile, route);
      }
    }
    return Object.freeze({
      byComputeProfile,
      byProvider,
    });
  });
}

function captureRoute(input: unknown): Result.Result<
  CapturedProvider & Readonly<{
    readonly computeProfiles: ReadonlyArray<TaskComputeProfileRefV1>;
  }>,
  TaskComputeProviderRouterConfigurationError
> {
  return Result.gen(function* () {
    const properties = yield* captureRouteProperties(input);
    const descriptor = yield* decodeTaskComputeProviderDescriptorV1(
      properties.descriptor,
    ).pipe(Result.mapError(cause => configurationError("invalid_route", cause)));
    const profileValues = yield* captureDenseDataArray(
      properties.computeProfiles,
      "invalid_route",
    );
    if (profileValues.length === 0) {
      return yield* Result.fail(configurationError("invalid_route"));
    }
    const computeProfiles: TaskComputeProfileRefV1[] = [];
    const routeProfiles = new Set<TaskComputeProfileRefV1>();
    for (const profileValue of profileValues) {
      const profile = yield* decodeComputeProfile(profileValue).pipe(
        Result.mapError(cause => configurationError("invalid_route", cause)),
      );
      if (routeProfiles.has(profile)) {
        return yield* Result.fail(
          configurationError("duplicate_compute_profile"),
        );
      }
      routeProfiles.add(profile);
      computeProfiles.push(profile);
    }
    const provider = yield* captureProvider(properties.provider);
    return Object.freeze({
      descriptor,
      computeProfiles: Object.freeze(computeProfiles),
      provider,
    });
  });
}

function captureProvider(
  input: unknown,
): Result.Result<
  TaskComputeProviderShape,
  TaskComputeProviderRouterConfigurationError
> {
  return Result.try({
    try: () => {
      if (!isNonArrayRecord(input)) throw new Error("Invalid provider.");
      const dispatchValue = ownDataValue(input, "dispatch");
      const cancellationValue = ownDataValue(input, "requestCancellation");
      if (
        typeof dispatchValue !== "function" ||
        typeof cancellationValue !== "function"
      ) throw new Error("Invalid provider.");
      const owner = input;
      // SAFETY: the router can prove only callable runtime members. The typed
      // private route contract supplies their Effect request/result channels.
      const dispatch = dispatchValue as TaskComputeProviderShape["dispatch"];
      const requestCancellation = cancellationValue as
        TaskComputeProviderShape["requestCancellation"];
      return Object.freeze({ owner, dispatch, requestCancellation });
    },
    catch: cause => configurationError("invalid_provider", cause),
  }).pipe(Result.map(({ owner, dispatch, requestCancellation }) =>
    makeTaskComputeProviderV1(Object.freeze({
      dispatch: (request: Parameters<typeof dispatch>[0]) =>
        dispatch.call(owner, request),
      requestCancellation: (
        request: Parameters<typeof requestCancellation>[0],
      ) => requestCancellation.call(owner, request),
    }))
  ));
}

function captureRouteProperties(
  input: unknown,
): Result.Result<
  CapturedRouteProperties,
  TaskComputeProviderRouterConfigurationError
> {
  return Result.try({
    try: () => {
      if (!isNonArrayRecord(input)) throw new Error("Invalid route.");
      const descriptor = ownDataValue(input, "descriptor");
      const computeProfiles = ownDataValue(input, "computeProfiles");
      const provider = ownDataValue(input, "provider");
      if (
        descriptor === MISSING || computeProfiles === MISSING ||
        provider === MISSING
      ) throw new Error("Invalid route.");
      return Object.freeze({ descriptor, computeProfiles, provider });
    },
    catch: cause => configurationError("invalid_route", cause),
  });
}

const MISSING = Symbol("missing");

function ownDataValue(input: object, key: string): unknown | typeof MISSING {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value as unknown
    : MISSING;
}

function captureDenseDataArray(
  input: unknown,
  reason: "invalid_routes" | "invalid_route",
): Result.Result<
  ReadonlyArray<unknown>,
  TaskComputeProviderRouterConfigurationError
> {
  return Result.try({
    try: () => {
      if (!Array.isArray(input)) throw new Error("Invalid array.");
      const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
      if (
        lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
        typeof lengthDescriptor.value !== "number" ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0
      ) throw new Error("Invalid array.");
      const values: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (descriptor === undefined || !("value" in descriptor)) {
          throw new Error("Invalid array.");
        }
        values.push(descriptor.value as unknown);
      }
      const expectedKeys = new Set([
        "length",
        ...values.map((_, index) => String(index)),
      ]);
      if (Reflect.ownKeys(input).some(key =>
        typeof key !== "string" || !expectedKeys.has(key)
      )) throw new Error("Invalid array.");
      return Object.freeze(values);
    },
    catch: cause => configurationError(reason, cause),
  });
}

function providerKey(
  descriptor: Pick<
    TaskComputeProviderDescriptorV1,
    "provider" | "providerVersion"
  >,
): string {
  return JSON.stringify([descriptor.provider, descriptor.providerVersion]);
}

function configurationError(
  reason: TaskComputeProviderRouterConfigurationError["reason"],
  cause?: unknown,
): TaskComputeProviderRouterConfigurationError {
  return cause === undefined
    ? new TaskComputeProviderRouterConfigurationError({ reason })
    : new TaskComputeProviderRouterConfigurationError({ reason, cause });
}
