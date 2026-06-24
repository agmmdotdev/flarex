import type { FunctionReference } from "flarex";
import type { FlarexTest } from "../src/index";

declare const testRuntime: FlarexTest;
declare const internalListLessons: FunctionReference<
  "query",
  "internal",
  { userId: string },
  string[]
>;
declare const internalCompleteLesson: FunctionReference<
  "mutation",
  "internal",
  { userId: string },
  { completed: boolean }
>;
declare const internalSendEmail: FunctionReference<
  "action",
  "internal",
  { userId: string },
  { sent: boolean }
>;

function assertPublicTestConvenienceReferences(): void {
  // @ts-expect-error Test convenience query calls should mirror public client visibility.
  void testRuntime.query(internalListLessons, { userId: "user-1" });
  // @ts-expect-error Test convenience mutation calls should mirror public client visibility.
  void testRuntime.mutation(internalCompleteLesson, { userId: "user-1" });
  // @ts-expect-error Test convenience action calls should mirror public client visibility.
  void testRuntime.action(internalSendEmail, { userId: "user-1" });

  void testRuntime.invokeRaw(internalListLessons, { userId: "user-1" });
  void testRuntime.invokeRaw(internalCompleteLesson, { userId: "user-1" });
  void testRuntime.invokeRaw(internalSendEmail, { userId: "user-1" });
}

void assertPublicTestConvenienceReferences;
