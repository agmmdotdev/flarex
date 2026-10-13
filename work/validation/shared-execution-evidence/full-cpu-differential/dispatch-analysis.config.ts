import { defineConfig } from 'vitest/config';
import base from './analysis.config.ts';
import profile from './dispatch-profile.config.ts';
export default defineConfig({ ...base, plugins: profile.plugins ?? [], test: { ...base.test,
  include: ['work/validation/shared-execution-evidence/full-cpu-differential/dispatch-analysis.test.ts'], maxWorkers: 1 } });
