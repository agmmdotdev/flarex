import { defineConfig } from 'vitest/config';
import base from './dispatch-analysis.config.ts';
export default defineConfig({ ...base, test: { ...base.test, include: [
  'work/validation/shared-execution-evidence/full-cpu-differential/dispatch-calibration.test.ts'], testTimeout: 120000 } });
