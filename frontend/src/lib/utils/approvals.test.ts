import { describe, expect, it } from "vite-plus/test";
import type { DbMessage } from "../api/generated/index.js";
import {
  approvalRequest,
  extractApprovals,
  filterApprovals,
  type ApprovalSession,
} from "./approvals.js";

const session: ApprovalSession = {
  id: "codex:review",
  agent: "codex",
  session_kind: "guardian_review",
  project: "example",
};
const message = (ordinal: number, role: string, content: string) =>
  ({
    ordinal,
    role,
    content,
    timestamp: `2026-09-20T10:00:${String(ordinal).padStart(2, "0")}Z`,
  }) as DbMessage;
const request = (action: object) =>
  `Context transcript\n>>> APPROVAL REQUEST START\nPlanned action JSON:\n${JSON.stringify(action)}\n>>> APPROVAL REQUEST END`;
const result = (outcome: string) =>
  JSON.stringify({
    outcome,
    risk_level: "low",
    user_authorization: "high",
    rationale: `${outcome} reason`,
  });

describe("permission review records", () => {
  it("shows every review, including denied, unresolved, and future outcomes", () => {
    const records = extractApprovals(session, [
      message(
        0,
        "user",
        request({ command: ["/bin/zsh", "-lc", "echo safe"], justification: "Check output" }),
      ),
      message(1, "assistant", result("allow")),
      message(2, "user", request({ command: "delete sample" })),
      message(3, "assistant", result("deny")),
      message(4, "user", request({ tool: "example_tool", arguments: { test: true } })),
      message(5, "user", request({ command: "future" })),
      message(6, "assistant", result("ask_user")),
    ]);
    expect(records.map((r) => r.outcome)).toEqual(["allow", "deny", "unknown", "unknown"]);
    expect(records[0]).toMatchObject({
      operation: "echo safe",
      justification: "Check output",
      rationale: "allow reason",
    });
    expect(records[2]).toMatchObject({
      operation: 'example_tool\n{\n  "test": true\n}',
      response: "",
    });
  });

  it("does not classify ordinary conversations or code reviews by JSON content", () => {
    const messages = [message(0, "assistant", result("allow"))];
    expect(extractApprovals({ ...session, session_kind: "roborev" }, messages)).toEqual([]);
    expect(extractApprovals({ ...session, agent: "claude" }, messages)).toEqual([]);
  });

  it("does not mistake delimiter text inside action arguments for the envelope", () => {
    const command = 'echo ">>> APPROVAL REQUEST START"';
    const records = extractApprovals(session, [message(0, "user", request({ command }))]);
    expect(records[0]!.operation).toBe(command);
  });

  it("extracts the final request instead of a request quoted in context", () => {
    const content =
      request({ command: "old action" }) +
      "\nTRANSCRIPT END\n" +
      request({ command: "new action" });
    expect(approvalRequest(content)).toContain("new action");
    expect(approvalRequest(content)).not.toContain("old action");
    expect(approvalRequest("unframed command")).toBeNull();
  });

  it("keeps malformed responses unknown, preserves raw text, and never infers success", () => {
    const records = extractApprovals(session, [
      message(0, "user", request({ command: ["program", "a b", "c"] })),
      message(1, "assistant", "Command succeeded. Exit code 0. <script>bad()</script>"),
    ]);
    expect(records[0]).toMatchObject({
      outcome: "unknown",
      operation: '["program","a b","c"]',
      risk: "",
    });
    expect(records[0]!.response).toContain("<script>");
  });

  it("retains unpaired results without borrowing the previous request", () => {
    const records = extractApprovals(session, [
      message(0, "user", request({ command: "first" })),
      message(1, "assistant", result("allow")),
      message(2, "assistant", result("deny")),
    ]);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ request: "", operation: "", outcome: "deny", ordinal: 2 });
  });

  it("does not pair a result across unrelated user messages", () => {
    const records = extractApprovals(session, [
      message(0, "user", request({ command: "first" })),
      message(1, "user", "Unrelated context"),
      message(2, "assistant", result("allow")),
    ]);
    expect(records[0]!.outcome).toBe("unknown");
    expect(records[1]!.request).toBe("");
  });

  it("sorts by ordinal and ignores overlapping pages without losing repeated actions", () => {
    const first = message(0, "user", request({ command: "same" }));
    const second = message(2, "user", request({ command: "same" }));
    expect(
      extractApprovals(session, [second, first, first, message(1, "assistant", result("allow"))]),
    ).toHaveLength(2);
  });

  it("filters by outcome and searches reasons and commands without case sensitivity", () => {
    const records = extractApprovals(session, [
      message(0, "user", request({ command: "ECHO sample" })),
      message(1, "assistant", result("deny")),
    ]);
    expect(filterApprovals(records, "deny", "echo")).toHaveLength(1);
    expect(filterApprovals(records, "allow", "echo")).toHaveLength(0);
    expect(filterApprovals(records, "all", "deny reason")).toHaveLength(1);
  });
});
