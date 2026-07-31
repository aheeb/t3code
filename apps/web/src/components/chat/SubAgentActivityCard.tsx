import { memo, useMemo, useState } from "react";
import { BotIcon, ChevronDownIcon } from "lucide-react";
import type { WorkLogEntry } from "../../session-logic";
import { cn } from "~/lib/utils";
import {
  deriveSubAgentActivityView,
  type SubAgentActivityItem,
  type SubAgentStatus,
} from "./SubAgentActivityCard.logic";

const STATUS_PRESENTATION: Record<
  SubAgentStatus,
  { readonly label: string; readonly dotClassName: string; readonly labelClassName: string }
> = {
  pendingInit: {
    label: "Starting",
    dotClassName: "bg-sky-400",
    labelClassName: "text-sky-500 dark:text-sky-400",
  },
  running: {
    label: "Working",
    dotClassName: "bg-emerald-500",
    labelClassName: "text-emerald-600 dark:text-emerald-400",
  },
  interrupted: {
    label: "Interrupted",
    dotClassName: "bg-amber-500",
    labelClassName: "text-amber-600 dark:text-amber-400",
  },
  completed: {
    label: "Completed",
    dotClassName: "bg-emerald-500",
    labelClassName: "text-emerald-600 dark:text-emerald-400",
  },
  errored: {
    label: "Failed",
    dotClassName: "bg-destructive",
    labelClassName: "text-destructive",
  },
  shutdown: {
    label: "Closed",
    dotClassName: "bg-muted-foreground/50",
    labelClassName: "text-muted-foreground",
  },
  notFound: {
    label: "Not found",
    dotClassName: "bg-destructive",
    labelClassName: "text-destructive",
  },
};

function statusSummary(input: {
  readonly total: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
}): string {
  if (input.active > 0) return `${input.active} working`;
  if (input.failed > 0) return `${input.failed} failed`;
  if (input.completed === input.total) {
    return input.total === 1 ? "Completed" : `${input.total} completed`;
  }
  return input.total === 1 ? "1 agent" : `${input.total} agents`;
}

function shortThreadId(threadId: string): string {
  const lastPathSegment = threadId.split("/").findLast((segment) => segment.length > 0) ?? threadId;
  return lastPathSegment.length <= 8 ? lastPathSegment : lastPathSegment.slice(-8);
}

function AgentStatusDot({ status }: { status: SubAgentStatus }) {
  const presentation = STATUS_PRESENTATION[status];
  const isActive = status === "pendingInit" || status === "running";
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden>
      {isActive ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-45",
            presentation.dotClassName,
          )}
        />
      ) : null}
      <span className={cn("relative inline-flex size-2 rounded-full", presentation.dotClassName)} />
    </span>
  );
}

const SubAgentRow = memo(function SubAgentRow({ agent }: { agent: SubAgentActivityItem }) {
  const status = STATUS_PRESENTATION[agent.status];
  const metadata = [agent.model, agent.reasoningEffort].filter(Boolean).join(" · ");
  const showLatestInstruction =
    agent.latestInstruction !== null && agent.latestInstruction !== agent.task;

  return (
    <li className="rounded-lg border border-border/55 bg-background/35 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <AgentStatusDot status={agent.status} />
        <span className="min-w-0 flex-1 truncate font-medium text-[12px] text-foreground/90">
          {agent.label}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/45">
          {shortThreadId(agent.threadId)}
        </span>
        <span className={cn("text-[11px] font-medium", status.labelClassName)}>{status.label}</span>
      </div>

      {metadata ? (
        <p className="mt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/50">
          {metadata}
        </p>
      ) : null}
      {agent.task ? (
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/80">
          {agent.task}
        </p>
      ) : null}
      {showLatestInstruction ? (
        <p className="mt-1.5 border-s border-border/70 ps-2 text-[11px] leading-relaxed text-muted-foreground/75">
          {agent.latestInstruction}
        </p>
      ) : null}
      {agent.message ? (
        <p
          className={cn(
            "mt-2 rounded-md px-2 py-1.5 text-[11px] leading-relaxed",
            agent.status === "errored" || agent.status === "notFound"
              ? "bg-destructive/8 text-destructive"
              : "bg-emerald-500/8 text-foreground/80",
          )}
        >
          {agent.message}
        </p>
      ) : null}
    </li>
  );
});

export const SubAgentActivityCard = memo(function SubAgentActivityCard({
  entries,
}: {
  entries: ReadonlyArray<WorkLogEntry>;
}) {
  const view = useMemo(() => deriveSubAgentActivityView(entries), [entries]);
  const [expanded, setExpanded] = useState(true);
  if (!view) return null;

  const summary = statusSummary({
    total: view.agents.length,
    active: view.activeCount,
    completed: view.completedCount,
    failed: view.failedCount,
  });

  return (
    <section className="overflow-hidden rounded-xl border border-border/65 bg-accent/12 shadow-xs">
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-foreground/75">
          <BotIcon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="font-semibold text-[12px] text-foreground/90">Sub-agents</span>
            <span className="text-[11px] text-muted-foreground/60">{summary}</span>
          </span>
          <span className="block truncate text-[11px] text-muted-foreground/60">
            {view.latestAction}
          </span>
        </span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/55 transition-transform duration-200",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {expanded ? (
        <ul className="space-y-1.5 border-t border-border/45 p-2" aria-label="Sub-agent status">
          {view.agents.map((agent) => (
            <SubAgentRow key={agent.threadId} agent={agent} />
          ))}
        </ul>
      ) : null}
    </section>
  );
});
