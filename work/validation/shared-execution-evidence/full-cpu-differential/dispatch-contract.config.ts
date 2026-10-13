import { defineConfig } from 'vitest/config';
import base from './dispatch-profile.config.ts';
export default defineConfig({ ...base, test: { ...base.test, include: [
  'packages/persistence-postgres/test/database/physicalSession.test.ts'], maxWorkers: 1, testTimeout: 120000 } });
