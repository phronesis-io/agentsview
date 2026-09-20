import { SessionsService, type DbMessage, type DbSession } from "./generated/index.js";
import { extractApprovals, isApprovalSession, type ApprovalRecord } from "../utils/approvals.js";

// Read through the existing archive API; never access or modify Codex's store.
export async function loadApprovalMessages(id: string, signal: AbortSignal): Promise<DbMessage[]> {
  const messages: DbMessage[] = [];
  let from = 0;
  while (true) {
    signal.throwIfAborted();
    const page = await SessionsService.getApiV1SessionsByIdMessages(
      { id },
      { from, limit: 100, direction: "asc", roles: "user,assistant" },
      { signal },
    );
    if (page.messages.length === 0) return messages;
    const next = Math.max(...page.messages.map((message) => message.ordinal)) + 1;
    if (next <= from) throw new Error("Approval message pagination did not advance");
    messages.push(...page.messages);
    from = next;
    // count is the size of this page, not the total number of messages.
    // Continue even on a short page so a server-side cap cannot truncate history.
  }
}

export async function loadApprovals(
  signal: AbortSignal,
  sessionId?: string,
): Promise<{
  records: ApprovalRecord[];
  failedSessions: string[];
}> {
  const candidates = new Map<string, DbSession>();
  const failedSessions: string[] = [];
  if (sessionId) {
    const root = await SessionsService.getApiV1SessionsById({ id: sessionId }, { signal });
    if (isApprovalSession(root)) candidates.set(root.id, root);
    const queue = [sessionId];
    const visited = new Set(queue);
    while (queue.length) {
      signal.throwIfAborted();
      const id = queue.shift()!;
      try {
        const children = await SessionsService.getApiV1SessionsByIdChildren({ id }, { signal });
        for (const child of children) {
          if (child.relationship_type !== "subagent" || visited.has(child.id)) continue;
          visited.add(child.id);
          if (isApprovalSession(child)) candidates.set(child.id, child);
          else queue.push(child.id);
        }
      } catch (error) {
        if (signal.aborted) throw error;
        failedSessions.push(id);
      }
    }
  } else {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      signal.throwIfAborted();
      const page = await SessionsService.getApiV1Sessions(
        {
          agent: "codex",
          include_children: true,
          include_automated: true,
          include_one_shot: true,
          limit: 200,
          cursor,
        },
        { signal },
      );
      for (const session of page.sessions) {
        if (isApprovalSession(session)) candidates.set(session.id, session);
      }
      cursor = page.next_cursor;
      if (cursor && cursors.has(cursor))
        throw new Error("Approval session pagination did not advance");
      if (cursor) cursors.add(cursor);
    } while (cursor);
  }
  const pending = [...candidates.values()];
  const records: ApprovalRecord[] = [];
  // Bound concurrent reads of potentially long review transcripts.
  await Promise.all(
    Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (pending.length) {
        signal.throwIfAborted();
        const session = pending.shift()!;
        try {
          records.push(
            ...extractApprovals(session, await loadApprovalMessages(session.id, signal)),
          );
        } catch (error) {
          if (signal.aborted) throw error;
          failedSessions.push(session.id);
        }
      }
    }),
  );
  records.sort(
    (a, b) =>
      b.timestamp.localeCompare(a.timestamp) || b.ordinal - a.ordinal || a.id.localeCompare(b.id),
  );
  return { records, failedSessions };
}
