import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { loadApprovalMessages, loadApprovals } from "./approvals.js";
const { list, children, detail, messages } = vi.hoisted(() => ({
  list: vi.fn(),
  children: vi.fn(),
  detail: vi.fn(),
  messages: vi.fn(),
}));
vi.mock("./generated/index.js", () => ({
  SessionsService: {
    getApiV1Sessions: list,
    getApiV1SessionsByIdChildren: children,
    getApiV1SessionsById: detail,
    getApiV1SessionsByIdMessages: messages,
  },
}));
const review = {
  id: "codex:review",
  agent: "codex",
  session_kind: "guardian_review",
  relationship_type: "subagent",
};
const output = {
  ordinal: 8,
  role: "assistant",
  content: '{"outcome":"deny","rationale":"test"}',
  timestamp: "2026-09-20T10:00:00Z",
};
afterEach(() => vi.resetAllMocks());

describe("approval archive reads", () => {
  it("paginates short message pages by ordinal until exhaustion", async () => {
    messages
      .mockResolvedValueOnce({ messages: [{ ...output, ordinal: 3 }] })
      .mockResolvedValueOnce({ messages: [output] })
      .mockResolvedValueOnce({ messages: [] });
    const result = await loadApprovalMessages(review.id, new AbortController().signal);
    expect(result).toHaveLength(2);
    expect(messages.mock.calls.map((call) => call[1].from)).toEqual([0, 4, 9]);
  });

  it("loads every session page including orphan reviews, deduplicating sessions", async () => {
    list
      .mockResolvedValueOnce({ sessions: [review], next_cursor: "next" })
      .mockResolvedValueOnce({ sessions: [review], next_cursor: "" });
    messages.mockResolvedValueOnce({ messages: [output] }).mockResolvedValueOnce({ messages: [] });
    const result = await loadApprovals(new AbortController().signal);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.outcome).toBe("deny");
    expect(list.mock.calls[1]![0].cursor).toBe("next");
    expect(list.mock.calls[0]![0]).toMatchObject({
      include_children: true,
      include_automated: true,
      include_one_shot: true,
    });
  });

  it("walks nested subagents but excludes forks and cycles", async () => {
    detail.mockResolvedValue({ id: "root", agent: "codex" });
    children.mockImplementation(({ id }) =>
      Promise.resolve(
        id === "root"
          ? [
              { id: "worker", relationship_type: "subagent" },
              { id: "fork", relationship_type: "fork" },
            ]
          : [review, { id: "root", relationship_type: "subagent" }],
      ),
    );
    messages.mockResolvedValueOnce({ messages: [output] }).mockResolvedValueOnce({ messages: [] });
    const result = await loadApprovals(new AbortController().signal, "root");
    expect(result.records).toHaveLength(1);
    expect(children.mock.calls.map((call) => call[0].id)).toEqual(["root", "worker"]);
  });

  it("reports partial failures instead of falsely reporting complete history", async () => {
    list.mockResolvedValue({ sessions: [review, { ...review, id: "broken" }] });
    messages.mockImplementation(({ id }, { from }) =>
      id === "broken"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ messages: from ? [] : [output] }),
    );
    const result = await loadApprovals(new AbortController().signal);
    expect(result.records).toHaveLength(1);
    expect(result.failedSessions).toEqual(["broken"]);
  });

  it("stops requests after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadApprovals(controller.signal)).rejects.toThrow();
    expect(list).not.toHaveBeenCalled();
  });

  it("fails rather than looping forever on a repeated message page", async () => {
    messages.mockResolvedValue({ messages: [output] });
    await expect(loadApprovalMessages(review.id, new AbortController().signal)).rejects.toThrow(
      "did not advance",
    );
    expect(messages).toHaveBeenCalledTimes(2);
  });
});
