import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runtimesForComputer, computersForEmployee } from "../src/lib/createAgent.js";

describe("create agent options", () => {
  it("lists each computer once even when it has several runtime nodes", () => {
    const nodes = [
      { id: "n1", employeeId: "alice", workspaceId: "m1", supportedAgents: ["claude"] },
      { id: "n2", employeeId: "alice", workspaceId: "m1", supportedAgents: ["codex"] },
    ];
    const computers = computersForEmployee(nodes, "alice");
    assert.equal(computers.length, 1);
  });

  it("unions runtimes across a computer's nodes and drops disabled ones", () => {
    const nodes = [
      { id: "n1", employeeId: "alice", workspaceId: "m1", supportedAgents: ["claude"] },
      {
        id: "n2",
        employeeId: "alice",
        workspaceId: "m1",
        supportedAgents: ["codex", "pi"],
        disabledAgents: ["pi"],
      },
    ];
    assert.deepEqual(
      runtimesForComputer(nodes, "device:alice:m1").sort(),
      ["claude", "codex"],
    );
  });

  it("excludes another employee's computers", () => {
    const nodes = [
      { id: "n1", employeeId: "bob", workspaceId: "m1", supportedAgents: ["claude"] },
    ];
    assert.deepEqual(computersForEmployee(nodes, "alice"), []);
  });
});
