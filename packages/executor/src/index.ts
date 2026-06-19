import type { FlarexPersistenceCheck } from "@flarex/persistence-postgres";

export interface Clock {
  now(): Date;
}

export interface FlarexExecutorConfig {
  clock?: Clock;
  persistence: FlarexExecutorPersistence;
}

export interface FlarexExecutor {
  health(): Promise<FlarexHealth>;
}

export interface FlarexExecutorPersistence {
  check(): Promise<FlarexPersistenceCheck>;
}

export interface FlarexHealth {
  service: "executor";
  status: "ok" | "degraded";
  persistence: FlarexExecutorDependencyHealth;
  time: string;
}

export type FlarexExecutorDependencyHealth =
  | {
      status: "ok";
    }
  | {
      status: "error";
      message: string;
    };

const defaultClock: Clock = {
  now: () => new Date(),
};

export function createFlarexExecutor(config: FlarexExecutorConfig): FlarexExecutor {
  const clock = config.clock ?? defaultClock;
  const persistence = config.persistence;

  return {
    async health() {
      const persistenceHealth = await checkPersistence(persistence);

      return {
        service: "executor",
        status: persistenceHealth.status === "ok" ? "ok" : "degraded",
        persistence: persistenceHealth,
        time: clock.now().toISOString(),
      };
    },
  };
}

async function checkPersistence(
  persistence: FlarexExecutorPersistence,
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
