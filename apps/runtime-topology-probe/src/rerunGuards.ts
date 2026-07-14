export class ProbeOneShotInvocationGate {
  private state: "ready" | "running" | "spent" = "ready";

  async run<Result>(operation: () => Promise<Result>): Promise<Result> {
    if (this.state !== "ready") {
      throw new Error("runtime rerun capability already consumed");
    }
    this.state = "running";
    try {
      return await operation();
    } finally {
      this.state = "spent";
    }
  }
}

export class ProbeRerunConcurrencyFence {
  private readonly activeKeys = new Set<string>();

  async run<Result>(
    key: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    if (this.activeKeys.has(key)) {
      throw new Error("synthetic sync rerun already active");
    }
    this.activeKeys.add(key);
    try {
      return await operation();
    } finally {
      this.activeKeys.delete(key);
    }
  }
}
