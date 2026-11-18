import { performance } from "node:perf_hooks";
import type { ResourceReading } from "../cpu";

/** Counter-only observation performs no inspector, heap or GC acquisition. */
export function readNodeResourceCounters(): ResourceReading {
  return { process: process.cpuUsage(), thread: typeof process.threadCpuUsage === "function" ? process.threadCpuUsage() : null,
    eventLoop: performance.eventLoopUtilization() };
}
