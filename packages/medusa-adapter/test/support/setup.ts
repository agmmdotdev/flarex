import { vi } from "vitest";
// The unchanged Jest suite owns this timeout; Vitest config applies it.
vi.stubGlobal("jest", { setTimeout(milliseconds: number) {
 if (milliseconds !== 100000) throw new Error("Unadmitted Currency test timeout");
} });
