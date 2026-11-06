import { mergeConfig } from "vitest/config";
import common from "./vitest.config";

// Paired Core lane of benchmarks/core-performance/product-workflows. The
// workspace Medusa packages resolve from source; ordinary-role PostgreSQL only.
const config = mergeConfig(common, {
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source", "node", "development|production"] } },
  test: { env: { FLAREX_TEST_DRIVER: "postgres", MEDUSA_COMPARISON_DRIVER: "postgres" },
    hookTimeout: 600_000, testTimeout: 3_600_000 },
});
config.test = { ...config.test, include: [`benchmarks/core-performance/product-workflows/${process.env.BENCH_SUITE ?? "core"}.postgres.bench.ts`], exclude: [] };
export default config;
