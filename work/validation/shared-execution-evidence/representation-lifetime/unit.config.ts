import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['work/validation/shared-execution-evidence/representation-lifetime/probe.test.ts'],maxWorkers:1,fileParallelism:false}});
