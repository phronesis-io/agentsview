// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mount, tick, unmount } from "svelte";
import { fireEvent, screen, waitFor } from "@testing-library/svelte";
import { setLocale } from "../../i18n/index.js";
import type { ApprovalRecord } from "../../utils/approvals.js";
import ApprovalPanel from "./ApprovalPanel.svelte";

const { load, navigate, scroll } = vi.hoisted(() => ({
  load: vi.fn(),
  navigate: vi.fn(),
  scroll: vi.fn(),
}));
vi.mock("../../api/approvals.js", () => ({ loadApprovals: load }));
vi.mock("../../stores/sync.svelte.js", () => ({ sync: { lastSync: null } }));
vi.mock("../../stores/router.svelte.js", () => ({
  router: { navigateToSession: navigate, navigate },
}));
vi.mock("../../stores/ui.svelte.js", () => ({ ui: { scrollToOrdinal: scroll } }));

function record(id: string, outcome: ApprovalRecord["outcome"]): ApprovalRecord {
  return {
    id,
    outcome,
    session: {
      id: `codex:${id}`,
      agent: "codex",
      session_kind: "guardian_review",
      parent_session_id: "codex:parent",
      project: "example",
    },
    ordinal: 4,
    timestamp: "2026-09-20T10:00:00Z",
    risk: "low",
    authorization: "high",
    rationale: `${outcome} reason`,
    operation: `${outcome} command`,
    justification: "test justification",
    request: "<script>window.bad = true</script>",
    response: `{"outcome":"${outcome}"}`,
  };
}

let component: ReturnType<typeof mount> | undefined;
beforeEach(() => setLocale("en"));
afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  document.body.innerHTML = "";
  vi.resetAllMocks();
});

describe("ApprovalPanel", () => {
  it("loads only when opened and aborts a pending read on collapse", async () => {
    load.mockImplementation(() => new Promise(() => {}));
    component = mount(ApprovalPanel, { target: document.body, props: { sessionId: "parent" } });
    await tick();
    expect(load).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "Permission reviews" }));
    expect(load.mock.calls[0]![1]).toBe("parent");
    const signal = load.mock.calls[0]![0] as AbortSignal;
    await fireEvent.click(screen.getByRole("button", { name: "Permission reviews" }));
    expect(signal.aborted).toBe(true);
  });

  it("filters denied reviews, searches reasons, escapes raw text and opens the correct source", async () => {
    load.mockResolvedValue({
      records: [record("one", "allow"), record("two", "deny")],
      failedSessions: [],
    });
    component = mount(ApprovalPanel, { target: document.body, props: { fullPage: true } });
    await waitFor(() => expect(document.querySelectorAll("article")).toHaveLength(2));
    await fireEvent.click(screen.getByRole("radio", { name: "Denied" }));
    expect(document.querySelectorAll("article")).toHaveLength(1);
    expect(document.body.textContent).toContain("deny reason");
    await fireEvent.input(
      screen.getByRole("searchbox", { name: "Search commands or review reasons" }),
      { target: { value: "does not exist" } },
    );
    expect(document.body.textContent).toContain("No matching reviews.");
    await fireEvent.input(
      screen.getByRole("searchbox", { name: "Search commands or review reasons" }),
      { target: { value: "deny reason" } },
    );
    expect(document.querySelectorAll("article")).toHaveLength(1);
    const details = document.querySelector("details")!;
    details.open = true;
    expect(details.textContent).toContain("<script>window.bad = true</script>");
    expect(details.querySelector("script")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Open review session" }));
    expect(scroll).toHaveBeenCalledWith(4, "codex:two");
    expect(navigate).toHaveBeenCalledWith("codex:two");
  });

  it("labels missing fields without inventing permission and reports incomplete reads", async () => {
    load.mockResolvedValue({
      records: [{ ...record("unknown", "unknown"), operation: "", risk: "", rationale: "" }],
      failedSessions: ["failed"],
    });
    component = mount(ApprovalPanel, { target: document.body, props: { fullPage: true } });
    await waitFor(() => expect(document.querySelectorAll("article")).toHaveLength(1));
    expect(screen.getByRole("alert").textContent).toContain("Affected sessions: 1");
    expect(document.body.textContent).toContain("Action not recorded or not recognized");
    expect(document.querySelector(".outcome")!.textContent).toContain("Unknown");
  });

  it("shows errors and allows retry", async () => {
    load
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ records: [], failedSessions: [] });
    component = mount(ApprovalPanel, { target: document.body, props: { fullPage: true } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not load"));
    await fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(document.body.textContent).toContain("No saved permission reviews found."),
    );
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale request after collapse and reopen", async () => {
    let finish: (value: { records: ApprovalRecord[]; failedSessions: string[] }) => void = () => {};
    load
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({ records: [record("current", "deny")], failedSessions: [] });
    component = mount(ApprovalPanel, { target: document.body, props: { sessionId: "parent" } });
    const toggle = screen.getByRole("button", { name: "Permission reviews" });
    await fireEvent.click(toggle);
    await fireEvent.click(toggle);
    await fireEvent.click(toggle);
    await waitFor(() => expect(document.querySelectorAll("article")).toHaveLength(1));
    finish({ records: [record("stale", "allow")], failedSessions: [] });
    await tick();
    expect(document.querySelector(".operation")!.textContent).toBe("deny command");
  });
});
