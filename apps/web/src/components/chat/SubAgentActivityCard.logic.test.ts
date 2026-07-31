import { describe, expect, it } from "vite-plus/test";
import { deriveSubAgentActivityView } from "./SubAgentActivityCard.logic";

describe("deriveSubAgentActivityView", () => {
  it("combines spawn metadata, agent paths, and wait results", () => {
    const view = deriveSubAgentActivityView([
      {
        toolData: {
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          status: "completed",
          receiverThreadIds: ["thread-research"],
          prompt: "Inspect the event pipeline and report the safest integration point.",
          model: "gpt-5.6-terra",
          reasoningEffort: "high",
          agentsStates: {
            "thread-research": { status: "pendingInit" },
          },
        },
      },
      {
        toolData: {
          type: "subAgentActivity",
          agentThreadId: "thread-research",
          agentPath: "/root/research",
          kind: "started",
        },
      },
      {
        toolData: {
          type: "collabAgentToolCall",
          tool: "wait",
          status: "completed",
          receiverThreadIds: ["thread-research"],
          agentsStates: {
            "thread-research": {
              status: "completed",
              message: "The structured collab item is the safest source.",
            },
          },
        },
      },
    ]);

    expect(view).toMatchObject({
      activeCount: 0,
      completedCount: 1,
      failedCount: 0,
      latestAction: "Finished waiting",
      agents: [
        {
          threadId: "thread-research",
          label: "research",
          path: "/root/research",
          status: "completed",
          message: "The structured collab item is the safest source.",
          task: "Inspect the event pipeline and report the safest integration point.",
          model: "gpt-5.6-terra",
          reasoningEffort: "high",
        },
      ],
    });
  });

  it("keeps a running status and the latest follow-up instruction", () => {
    const view = deriveSubAgentActivityView([
      {
        toolData: {
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          status: "completed",
          receiverThreadIds: ["thread-worker"],
          prompt: "Implement the UI.",
          agentsStates: { "thread-worker": { status: "running" } },
        },
      },
      {
        toolData: {
          type: "collabAgentToolCall",
          tool: "sendInput",
          status: "completed",
          receiverThreadIds: ["thread-worker"],
          prompt: "Also add keyboard and screen-reader behavior.",
          agentsStates: { "thread-worker": { status: "running" } },
        },
      },
    ]);

    expect(view?.activeCount).toBe(1);
    expect(view?.agents[0]).toMatchObject({
      status: "running",
      task: "Implement the UI.",
      latestInstruction: "Also add keyboard and screen-reader behavior.",
    });
  });

  it("returns null for unrelated tool data", () => {
    expect(deriveSubAgentActivityView([{ toolData: { type: "mcpToolCall" } }])).toBeNull();
  });

  it("keeps child messages in the selected agent transcript", () => {
    const view = deriveSubAgentActivityView([
      {
        id: "spawn",
        createdAt: "2026-01-01T00:00:00Z",
        toolData: {
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          status: "completed",
          receiverThreadIds: ["thread-worker"],
          prompt: "Inspect the repository.",
        },
      },
      ...["I am ", "inspecting it now."].map((delta, index) => ({
        id: `delta-${index}`,
        createdAt: `2026-01-01T00:00:0${index + 1}Z`,
        toolData: {
          type: "subAgentTranscriptEvent",
          agentThreadId: "thread-worker",
          eventType: "content.delta",
          eventId: `delta-${index}`,
          itemId: "message-1",
          streamKind: "assistant_text",
          delta,
        },
      })),
    ]);

    expect(view?.agents[0]?.transcript).toEqual([
      {
        id: "message-1",
        createdAt: "2026-01-01T00:00:01Z",
        kind: "assistant",
        title: null,
        text: "I am inspecting it now.",
        status: "inProgress",
      },
    ]);
  });
});
