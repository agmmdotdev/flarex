import { vi } from "vitest";
import type { Logger } from "@medusajs/framework/types";

export function notificationLogger(): Logger {
  return { panic: vi.fn(), shouldLog: () => true, setLogLevel: vi.fn(), unsetLogLevel: vi.fn(),
    activity: () => "activity", progress: vi.fn(), error: vi.fn(), failure: vi.fn(), success: () => ({}),
    silly: vi.fn(), debug: vi.fn(), verbose: vi.fn(), http: vi.fn(), info: vi.fn(), warn: vi.fn(), log: vi.fn() };
}
