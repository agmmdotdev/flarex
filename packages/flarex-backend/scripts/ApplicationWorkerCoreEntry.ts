// This dependency has no imports: ESM evaluates it before the core's graph,
// including Effect's cached Error.stackTraceLimit writability detection.
import "./ApplicationWorkerStackTracePrelude";
export * from "../src/artifactRuntime/ApplicationWorkerCore";
