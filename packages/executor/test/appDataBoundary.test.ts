import { expectTypeOf, it } from "vitest";
import type { LegacyV1AppDataStore } from "@flarex/persistence-postgres/legacy-v1-app-data-engine";

import type {
  FlarexExecutorControlPersistence,
  FlarexExecutorPersistence,
} from "../src/types";

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
