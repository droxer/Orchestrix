import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("task card references", () => {
  it("shows the same short REF identity on backlog and routine cards", async () => {
    const [backlogRecords, routineRecords, reference] = await Promise.all([
      readFile(resolve("web/src/components/task-board/BacklogRecords.tsx"), "utf8"),
      readFile(resolve("web/src/components/task-board/RoutineRecords.tsx"), "utf8"),
      readFile(resolve("web/src/components/task-board/TaskReference.tsx"), "utf8"),
    ]);

    assert.match(backlogRecords, /<TaskReference taskId=\{task\.id\} \/>/);
    assert.match(routineRecords, /<TaskReference taskId=\{task\.id\} \/>/);
    assert.match(reference, /t\("backlog\.col_ref"\)/);
    assert.match(reference, /taskRef\(taskId\)/);
  });
});
