import { createApplicationNativeMutationPGliteFixtureWithPersistence } from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { createMigratedPGlitePersistence } from "../../../persistence-postgres/test/support/pgliteTestFixture";
import { FINITE_APPLICATION_WORKER_ADMISSION_OPTIONS } from "../../support/finiteApplicationAdmissionHarness";
import { defineFiniteApplicationAdmissionContract } from "../contracts/finiteApplicationAdmissionContract";

defineFiniteApplicationAdmissionContract({ runScenario: async scenario => {
  const control = await createMigratedPGlitePersistence();
  const target = await createMigratedPGlitePersistence(undefined, "finiteCapture");
  await scenario(await createApplicationNativeMutationPGliteFixtureWithPersistence(FINITE_APPLICATION_WORKER_ADMISSION_OPTIONS, { control, target }));
} });
