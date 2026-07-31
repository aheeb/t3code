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
  };
  agents.set(threadId, created);
  return created;
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
  entries: ReadonlyArray<Pick<WorkLogEntry, "toolData">>,
): SubAgentActivityView | null {
  const agents = new Map<string, MutableSubAgentActivityItem>();
  let latestAction = "Sub-agent activity";

  for (const entry of entries) {
    const item = asRecord(entry.toolData);
    if (item?.type === "collabAgentToolCall") {
      latestAction = applyCollabToolCall(agents, item);
    } else if (item?.type === "subAgentActivity") {
      latestAction = applySubAgentActivity(agents, item);
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
