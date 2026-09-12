import { vi } from "vitest";
// Original routing fixtures use only jest.fn. Keep their executable source
// unchanged and supply that test-runner primitive at this test-only boundary.
Object.defineProperty(globalThis, "jest", { value: { fn: vi.fn }, configurable: true });
