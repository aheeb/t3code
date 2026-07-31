import {
  EventId,
  ProviderDriverKind,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { runtimeEventToActivities } from "./ProviderRuntimeIngestion.ts";

describe("runtimeEventToActivities sub-agent transcript routing", () => {
  it("stores child assistant text as agent-scoped activity", () => {
    const event = {
      type: "content.delta",
      eventId: EventId.make("evt-child-delta"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-07-31T18:00:00.000Z",
      threadId: ThreadId.make("parent-thread"),
      subAgentThreadId: "child-thread",
      turnId: TurnId.make("parent-turn"),
      itemId: RuntimeItemId.make("child-message"),
      payload: {
        streamKind: "assistant_text",
        delta: "I am inspecting the repository.",
      },
    } satisfies ProviderRuntimeEvent;

    expect(runtimeEventToActivities(event)).toEqual([
      {
        id: "evt-child-delta",
        createdAt: "2026-07-31T18:00:00.000Z",
        tone: "tool",
        kind: "subagent.transcript",
        summary: "Sub-agent activity",
        payload: {
          itemType: "collab_agent_tool_call",
          data: {
            item: {
              type: "subAgentTranscriptEvent",
              agentThreadId: "child-thread",
              eventType: "content.delta",
              eventId: "evt-child-delta",
              createdAt: "2026-07-31T18:00:00.000Z",
              itemId: "child-message",
              streamKind: "assistant_text",
              delta: "I am inspecting the repository.",
            },
          },
        },
        turnId: "parent-turn",
      },
    ]);
  });
});
