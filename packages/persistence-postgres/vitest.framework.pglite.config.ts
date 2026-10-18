import { mergeConfig } from "vitest/config";
import framework from "./vitest.framework.config";
import pglite from "./vitest.pglite.config";

// Multi-file image consumers share one migration build and the framework budget.
// Raw migrations and single-consumer runs retain the existing framework config.
export default mergeConfig(framework, pglite);
