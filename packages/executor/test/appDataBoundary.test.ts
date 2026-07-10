import { expectTypeOf, it } from "vitest";
import type { LegacyV1AppDataStore } from "@flarex/persistence-postgres/legacy-v1-app-data-engine";

import type {
  FlarexExecutor,
  FlarexExecutorConfig,
  FlarexExecutorControlPersistence,
  FlarexExecutorPersistence,
} from "../src/types";

type StorageSelectionKey =
  | "storageGeneration"
  | "storageGenerationFence"
  | "storageGenerationResolver"
  | "appDataEngine"
  | "appDataEngines"
  | "appDataEngineRegistry"
  | "storageEngine";

type FirstArgument<FunctionType> =
  FunctionType extends (...arguments_: infer Arguments) => unknown
    ? Arguments[0]
    : never;

type ExecutorInput = {
  [Key in keyof FlarexExecutor]: FirstArgument<FlarexExecutor[Key]>;
}[keyof FlarexExecutor];

type ForbiddenStorageSelectionKey<Value> = Value extends unknown
  ? Extract<keyof Value, StorageSelectionKey>
  : never;

it("keeps legacy app-data capabilities out of executor control persistence", () => {
  type AppDataKey = keyof LegacyV1AppDataStore;
  type ControlAppDataKey = Extract<
    keyof FlarexExecutorControlPersistence,
    AppDataKey
  >;
  type CompositionAppDataKey = Extract<
    keyof FlarexExecutorPersistence,
    AppDataKey
  >;

  expectTypeOf<ControlAppDataKey>().toEqualTypeOf<never>();
  expectTypeOf<CompositionAppDataKey>().toEqualTypeOf<AppDataKey>();
});

it("keeps storage generation selection out of the public executor surface", () => {
  expectTypeOf<ForbiddenStorageSelectionKey<FlarexExecutorConfig>>()
    .toEqualTypeOf<never>();
  expectTypeOf<ForbiddenStorageSelectionKey<ExecutorInput>>()
    .toEqualTypeOf<never>();
  expectTypeOf<
    Extract<
      keyof FlarexExecutor,
      | "resolveStorageGeneration"
      | "resolveAppDataEngine"
      | "selectAppDataEngine"
    >
  >().toEqualTypeOf<never>();
});
