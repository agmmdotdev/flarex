import type {
  Clock,
  FlarexExecutorDependencyHealth,
  FlarexExecutorControlPersistence,
  FlarexHealth,
} from "./types";

export const defaultClock: Clock = {
  now: () => new Date(),
};

export async function getExecutorHealth(
  persistence: FlarexExecutorControlPersistence,
  clock: Clock,
): Promise<FlarexHealth> {
  const persistenceHealth = await checkPersistence(persistence);

  return {
    service: "executor",
    status: persistenceHealth.status === "ok" ? "ok" : "degraded",
    persistence: persistenceHealth,
    time: clock.now().toISOString(),
  };
}

async function checkPersistence(
  persistence: FlarexExecutorControlPersistence,
): Promise<FlarexExecutorDependencyHealth> {
  try {
    await persistence.check();
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unknown persistence error",
    };
  }
}
