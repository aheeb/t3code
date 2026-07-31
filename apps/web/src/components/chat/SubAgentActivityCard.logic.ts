import type { WorkLogEntry } from "../../session-logic";

export const SUB_AGENT_STATUSES = [
  "pendingInit",
  "running",
  "interrupted",
  "completed",
  "errored",
  "shutdown",
  "notFound",
] as const;

export type SubAgentStatus = (typeof SUB_AGENT_STATUSES)[number];

export type SubAgentTranscriptKind = "assistant" | "reasoning" | "tool" | "error";

export interface SubAgentTranscriptItem {
  readonly id: string;
  readonly createdAt: string;
  readonly kind: SubAgentTranscriptKind;
  readonly title: string | null;
  readonly text: string;
  readonly status: string | null;
}

export interface SubAgentActivityItem {
  readonly threadId: string;
  readonly label: string;
  readonly path: string | null;
  readonly status: SubAgentStatus;
  readonly message: string | null;
  readonly task: string | null;
  readonly latestInstruction: string | null;
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  readonly transcript: ReadonlyArray<SubAgentTranscriptItem>;
}

export interface SubAgentActivityView {
  readonly agents: ReadonlyArray<SubAgentActivityItem>;
  readonly activeCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly latestAction: string;
}

interface MutableSubAgentActivityItem {
  threadId: string;
  path: string | null;
  status: SubAgentStatus;
  message: string | null;
  task: string | null;
  latestInstruction: string | null;
  model: string | null;
  reasoningEffort: string | null;
  transcript: SubAgentTranscriptItem[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const stringValue = asTrimmedString(entry);
        return stringValue ? [stringValue] : [];
      })
    : [];
}

function asSubAgentStatus(value: unknown): SubAgentStatus | null {
  return typeof value === "string" && SUB_AGENT_STATUSES.includes(value as SubAgentStatus)
    ? (value as SubAgentStatus)
    : null;
}

function ensureAgent(
  agents: Map<string, MutableSubAgentActivityItem>,
  threadId: string,
): MutableSubAgentActivityItem {
  const existing = agents.get(threadId);
  if (existing) return existing;

  const created: MutableSubAgentActivityItem = {
    threadId,
    path: null,
    status: "pendingInit",
    message: null,
    task: null,
    latestInstruction: null,
    model: null,
    reasoningEffort: null,
    transcript: [],
  };
  agents.set(threadId, created);
  return created;
}

function transcriptKindForStream(streamKind: string | null): SubAgentTranscriptKind | null {
  if (streamKind === "assistant_text") return "assistant";
  if (streamKind === "reasoning_text" || streamKind === "reasoning_summary_text") {
    return "reasoning";
  }
  return null;
}

function transcriptEntryId(item: Record<string, unknown>, fallbackId: string): string {
  return asTrimmedString(item.itemId) ?? asTrimmedString(item.eventId) ?? fallbackId;
}

function appendTranscriptDelta(
  agent: MutableSubAgentActivityItem,
  input: {
    readonly id: string;
    readonly createdAt: string;
    readonly kind: SubAgentTranscriptKind;
    readonly delta: string;
  },
): void {
  const previous = agent.transcript.at(-1);
  if (previous && previous.id === input.id && previous.kind === input.kind) {
    agent.transcript[agent.transcript.length - 1] = {
      ...previous,
      text: previous.text + input.delta,
    };
    return;
  }
  agent.transcript.push({
    id: input.id,
    createdAt: input.createdAt,
    kind: input.kind,
    title: input.kind === "reasoning" ? "Reasoning" : null,
    text: input.delta,
    status: "inProgress",
  });
}

function upsertTranscriptItem(
  agent: MutableSubAgentActivityItem,
  item: SubAgentTranscriptItem,
): void {
  const existingIndex = agent.transcript.findIndex((entry) => entry.id === item.id);
  if (existingIndex < 0) {
    agent.transcript.push(item);
    return;
  }
  const existing = agent.transcript[existingIndex]!;
  agent.transcript[existingIndex] = {
    ...existing,
    ...item,
    text: item.text || existing.text,
  };
}

function applySubAgentTranscript(
  agents: Map<string, MutableSubAgentActivityItem>,
  item: Record<string, unknown>,
  entry: { readonly id?: string; readonly createdAt?: string },
): string {
  const threadId = asTrimmedString(item.agentThreadId);
  if (!threadId) return "Sub-agent activity";

  const agent = ensureAgent(agents, threadId);
  const eventType = asTrimmedString(item.eventType);
  const createdAt = asTrimmedString(item.createdAt) ?? entry.createdAt ?? "";
  const id = transcriptEntryId(item, entry.id ?? `${threadId}:${agent.transcript.length}`);

  if (eventType === "turn.started") {
    agent.status = "running";
    agent.model = asTrimmedString(item.model) ?? agent.model;
    agent.reasoningEffort = asTrimmedString(item.reasoningEffort) ?? agent.reasoningEffort;
    return "Sub-agent started working";
  }
  if (eventType === "turn.completed") {
    const state = asTrimmedString(item.state);
    agent.status = state === "failed" ? "errored" : "completed";
    const detail = asTrimmedString(item.detail);
    if (detail) agent.message = detail;
    return state === "failed" ? "Sub-agent failed" : "Sub-agent completed";
  }
  if (eventType === "runtime.error") {
    const detail = asTrimmedString(item.detail) ?? "The sub-agent failed.";
    agent.status = "errored";
    upsertTranscriptItem(agent, {
      id,
      createdAt,
      kind: "error",
      title: "Error",
      text: detail,
      status: "failed",
    });
    return "Sub-agent failed";
  }
  if (eventType === "runtime.warning") {
    const detail = asTrimmedString(item.detail);
    if (detail) {
      upsertTranscriptItem(agent, {
        id,
        createdAt,
        kind: "tool",
        title: "Warning",
        text: detail,
        status: null,
      });
    }
    return "Sub-agent warning";
  }

  if (eventType === "content.delta") {
    const kind = transcriptKindForStream(asTrimmedString(item.streamKind));
    const delta = typeof item.delta === "string" ? item.delta : "";
    if (kind && delta.length > 0) {
      appendTranscriptDelta(agent, { id, createdAt, kind, delta });
      agent.status = "running";
    }
    return kind === "assistant" ? "Sub-agent responded" : "Sub-agent is reasoning";
  }

  if (
    eventType === "item.started" ||
    eventType === "item.updated" ||
    eventType === "item.completed"
  ) {
    const itemType = asTrimmedString(item.itemType);
    const detail = asTrimmedString(item.detail) ?? "";
    const status =
      asTrimmedString(item.status) ?? (eventType === "item.completed" ? "completed" : "inProgress");
    if (itemType === "assistant_message" || itemType === "reasoning") {
      const kind: SubAgentTranscriptKind =
        itemType === "assistant_message" ? "assistant" : "reasoning";
      upsertTranscriptItem(agent, {
        id,
        createdAt,
        kind,
        title: kind === "reasoning" ? "Reasoning" : null,
        text: detail,
        status,
      });
    } else if (itemType && itemType !== "user_message") {
      upsertTranscriptItem(agent, {
        id,
        createdAt,
        kind: "tool",
        title: asTrimmedString(item.title) ?? itemType.replaceAll("_", " "),
        text: detail,
        status,
      });
    }
    return eventType === "item.completed" ? "Sub-agent finished a step" : "Sub-agent is working";
  }

  return "Sub-agent activity";
}

function applyAgentStates(
  agents: Map<string, MutableSubAgentActivityItem>,
  statesValue: unknown,
): void {
  const states = asRecord(statesValue);
  if (!states) return;

  for (const [threadId, rawState] of Object.entries(states)) {
    const state = asRecord(rawState);
    const status = asSubAgentStatus(state?.status);
    if (!status) continue;
    const agent = ensureAgent(agents, threadId);
    agent.status = status;
    agent.message = asTrimmedString(state?.message);
  }
}

function actionLabel(tool: string | null, inProgress: boolean): string {
  switch (tool) {
    case "spawnAgent":
      return inProgress ? "Starting a sub-agent" : "Started a sub-agent";
    case "sendInput":
      return inProgress ? "Messaging a sub-agent" : "Sent input to a sub-agent";
    case "resumeAgent":
      return inProgress ? "Resuming a sub-agent" : "Resumed a sub-agent";
    case "wait":
      return inProgress ? "Waiting for sub-agents" : "Finished waiting";
    case "closeAgent":
      return inProgress ? "Closing a sub-agent" : "Closed a sub-agent";
    default:
      return "Sub-agent activity";
  }
}

function defaultStatusForTool(tool: string | null, inProgress: boolean): SubAgentStatus | null {
  if (inProgress) return tool === "spawnAgent" ? "pendingInit" : "running";
  if (tool === "resumeAgent" || tool === "sendInput") return "running";
  if (tool === "closeAgent") return "shutdown";
  return null;
}

function applyCollabToolCall(
  agents: Map<string, MutableSubAgentActivityItem>,
  item: Record<string, unknown>,
): string {
  const receiverThreadIds = asStringArray(item.receiverThreadIds);
  const tool = asTrimmedString(item.tool);
  const inProgress = item.status === "inProgress";
  const prompt = asTrimmedString(item.prompt);
  const model = asTrimmedString(item.model);
  const reasoningEffort = asTrimmedString(item.reasoningEffort);
  const defaultStatus = defaultStatusForTool(tool, inProgress);

  for (const threadId of receiverThreadIds) {
    const agent = ensureAgent(agents, threadId);
    if (defaultStatus) agent.status = defaultStatus;
    if (tool === "spawnAgent") {
      agent.task = prompt ?? agent.task;
      agent.model = model ?? agent.model;
      agent.reasoningEffort = reasoningEffort ?? agent.reasoningEffort;
    } else if (prompt) {
      agent.latestInstruction = prompt;
    }
  }

  applyAgentStates(agents, item.agentsStates);
  return actionLabel(tool, inProgress);
}

function applySubAgentActivity(
  agents: Map<string, MutableSubAgentActivityItem>,
  item: Record<string, unknown>,
): string {
  const threadId = asTrimmedString(item.agentThreadId);
  const path = asTrimmedString(item.agentPath);
  const kind = asTrimmedString(item.kind);
  if (!threadId) return "Sub-agent activity";

  const agent = ensureAgent(agents, threadId);
  agent.path = path ?? agent.path;
  if (kind === "started" || kind === "interacted") agent.status = "running";
  if (kind === "interrupted") agent.status = "interrupted";

  if (kind === "started") return `Started ${path ?? "a sub-agent"}`;
  if (kind === "interacted") return `Contacted ${path ?? "a sub-agent"}`;
  if (kind === "interrupted") return `Interrupted ${path ?? "a sub-agent"}`;
  return "Sub-agent activity";
}

function displayLabel(agent: MutableSubAgentActivityItem, index: number): string {
  if (agent.path) {
    const lastSegment = agent.path.split("/").findLast((segment) => segment.length > 0);
    if (lastSegment) return lastSegment;
  }
  return `Agent ${index + 1}`;
}

export function deriveSubAgentActivityView(
  entries: ReadonlyArray<
    Pick<WorkLogEntry, "toolData"> & Partial<Pick<WorkLogEntry, "id" | "createdAt">>
  >,
): SubAgentActivityView | null {
  const agents = new Map<string, MutableSubAgentActivityItem>();
  let latestAction = "Sub-agent activity";

  for (const entry of entries) {
    const item = asRecord(entry.toolData);
    if (item?.type === "collabAgentToolCall") {
      latestAction = applyCollabToolCall(agents, item);
    } else if (item?.type === "subAgentActivity") {
      latestAction = applySubAgentActivity(agents, item);
    } else if (item?.type === "subAgentTranscriptEvent") {
      latestAction = applySubAgentTranscript(agents, item, entry);
    }
  }

  if (agents.size === 0) return null;

  const activityItems = [...agents.values()].map((agent, index) => ({
    ...agent,
    label: displayLabel(agent, index),
  }));
  const activeCount = activityItems.filter(
    (agent) => agent.status === "pendingInit" || agent.status === "running",
  ).length;
  const completedCount = activityItems.filter((agent) => agent.status === "completed").length;
  const failedCount = activityItems.filter(
    (agent) => agent.status === "errored" || agent.status === "notFound",
  ).length;

  return {
    agents: activityItems,
    activeCount,
    completedCount,
    failedCount,
    latestAction,
  };
}
