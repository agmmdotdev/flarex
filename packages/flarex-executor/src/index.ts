export interface Clock {
  now(): Date;
}

export interface FlarexExecutorConfig {
  clock?: Clock;
}

export interface FlarexExecutor {
  health(): FlarexHealth;
}

export interface FlarexHealth {
  service: "flarex-executor";
  status: "ok";
  time: string;
}

const defaultClock: Clock = {
  now: () => new Date(),
};

export function createFlarexExecutor(
  config: FlarexExecutorConfig = {},
): FlarexExecutor {
  const clock = config.clock ?? defaultClock;

  return {
    health() {
      return {
        service: "flarex-executor",
        status: "ok",
        time: clock.now().toISOString(),
      };
    },
  };
}
