import type { DbMessage, DbSession } from "../api/generated/index.js";

export type ApprovalSession = Pick<
  DbSession,
  "id" | "agent" | "session_kind" | "parent_session_id" | "project"
>;

export interface ApprovalRecord {
  id: string;
  session: ApprovalSession;
  ordinal: number;
  timestamp: string;
  outcome: "allow" | "deny" | "unknown";
  risk: string;
  authorization: string;
  rationale: string;
  operation: string;
  justification: string;
  request: string;
  response: string;
}

export function isApprovalSession(session: ApprovalSession): boolean {
  return session.agent === "codex" && session.session_kind === "guardian_review";
}

function objectJSON(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The transcript embedded before this envelope is context, not another request.
// Only inspect the final envelope; never extract commands from that transcript.
export function approvalRequest(content: string): string | null {
  const end = [...content.matchAll(/^>>> APPROVAL REQUEST END\r?$/gm)].at(-1)?.index;
  if (end === undefined) return null;
  const start = [...content.matchAll(/^>>> APPROVAL REQUEST START\r?$/gm)]
    .filter((match) => match.index < end)
    .at(-1);
  return start ? content.slice(start.index + start[0].length, end).trim() : null;
}

function requestFields(request: string): { operation: string; justification: string } {
  const marker = "Planned action JSON:";
  const start = request.indexOf(marker);
  const action = objectJSON(start < 0 ? request : request.slice(start + marker.length).trim());
  if (!action) return { operation: "", justification: "" };
  const command = action.command;
  let operation = "";
  if (Array.isArray(command) && command.every((part) => typeof part === "string")) {
    // Shell -c commands are already complete source strings. Other argv arrays
    // remain JSON so quoting cannot change their meaning in the display.
    const shell = /(?:^|\/)(?:ba|z|da|k)?sh$/.test(command[0] ?? "");
    operation =
      shell && /^-[a-z]*c[a-z]*$/.test(command[1] ?? "") && command.length === 3
        ? command[2]!
        : JSON.stringify(command);
  } else if (typeof command === "string") {
    operation = command;
  } else {
    const tool = string(action.tool_name) || string(action.tool);
    operation =
      tool +
      (action.arguments === undefined ? "" : `\n${JSON.stringify(action.arguments, null, 2)}`);
  }
  return { operation, justification: string(action.justification) };
}

function newRecord(session: ApprovalSession, message: DbMessage, request = ""): ApprovalRecord {
  return {
    id: `${session.id}:${message.ordinal}`,
    session,
    ordinal: message.ordinal,
    timestamp: message.timestamp,
    outcome: "unknown",
    risk: "",
    authorization: "",
    rationale: "",
    ...requestFields(request),
    request,
    response: "",
  };
}

export function extractApprovals(
  session: ApprovalSession,
  messages: DbMessage[],
): ApprovalRecord[] {
  if (!isApprovalSession(session)) return [];
  const records: ApprovalRecord[] = [];
  let current: ApprovalRecord | undefined;
  const seen = new Set<number>();
  for (const message of [...messages].sort((a, b) => a.ordinal - b.ordinal)) {
    if (seen.has(message.ordinal)) continue;
    seen.add(message.ordinal);
    if (message.role === "user") {
      current = undefined;
      const request = approvalRequest(message.content);
      if (request !== null) {
        current = newRecord(session, message, request);
        records.push(current);
      }
      continue;
    }
    if (message.role !== "assistant") continue;
    const result = objectJSON(message.content);
    const hasResult =
      result !== null &&
      ("outcome" in result || "risk_level" in result || "user_authorization" in result);
    if (!current && !hasResult) continue;
    if (!current) {
      current = newRecord(session, message);
      records.push(current);
    }
    current.response += (current.response ? "\n\n" : "") + message.content;
    if (hasResult && result) {
      current.outcome =
        result.outcome === "allow" || result.outcome === "deny" ? result.outcome : "unknown";
      current.risk = string(result.risk_level);
      current.authorization = string(result.user_authorization);
      current.rationale = string(result.rationale);
      // A later result without a new request is a distinct, unpaired record.
      current = undefined;
    }
  }
  return records;
}

export function filterApprovals(
  records: ApprovalRecord[],
  outcome: string,
  query: string,
): ApprovalRecord[] {
  const needle = query.trim().toLocaleLowerCase();
  return records.filter(
    (record) =>
      (outcome === "all" || record.outcome === outcome) &&
      (!needle ||
        [
          record.operation,
          record.justification,
          record.rationale,
          record.session.project,
          record.request,
          record.response,
        ].some((value) => value.toLocaleLowerCase().includes(needle))),
  );
}
