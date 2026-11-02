"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiClientError, type Overview, type TaskWithProject } from "@/lib/client";
import { usePoll, useProjects } from "./useApp";
import { AppShell } from "./AppShell";
import { PriorityIcon } from "./PriorityIcon";
import { ListSkeleton } from "./ui";
import { toast } from "./Toast";
import { relativeTime } from "./activity-logic";
import { groupByProject } from "./home-logic";
import { ticketHref } from "./search-logic";

// My work (/home): my open tickets across every project, what agents are doing
// right now (with a STALE flag after 2h untouched), and the inbox count.
// Refreshes every 15s while the tab is visible.
export function Home() {
  const { projects, selectedId, select, reload } = useProjects();
  const [data, setData] = useState<Overview | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setData(await api.overview());
    } catch (e) {
      toast((e as ApiClientError).message ?? "Could not load your work", "error");
    } finally {
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  usePoll(load, [load], 15000);

  const groups = data ? groupByProject(data.mine) : [];

  return (
    <AppShell projects={projects} selectedId={selectedId} select={select} reload={reload}>
      <div className="mx-auto w-full max-w-3xl space-y-8 p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold text-fg">My work</h2>
          {data?.user && <span className="text-sm text-fg-subtle">{data.user.username}</span>}
          {data && (
            <Link
              href="/inbox"
              className={`ml-auto inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm ${
                data.inbox_count
                  ? "border-warning-border bg-warning-bg text-fg hover:border-warning"
                  : "border-border text-fg-muted hover:bg-bg-soft hover:text-fg"
              }`}
            >
              {data.inbox_count ? (
                <>
                  <span className="font-semibold">{data.inbox_count}</span>
                  open question{data.inbox_count === 1 ? "" : "s"} in your inbox →
                </>
              ) : (
                <>Inbox is clear →</>
              )}
            </Link>
          )}
        </div>

        <section aria-labelledby="home-mine">
          <h3
            id="home-mine"
            className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle"
          >
            My open tickets{" "}
            {data && <span className="font-normal normal-case">({data.mine.length})</span>}
          </h3>
          {!data ? (
            <ListSkeleton rows={4} />
          ) : !data.user ? (
            <Empty>Log in to see the tickets assigned to you.</Empty>
          ) : groups.length === 0 ? (
            <Empty>Nothing open is assigned to you.</Empty>
          ) : (
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={g.project_id}>
                  <h4 className="mb-1.5 flex items-baseline gap-2 text-sm font-medium text-fg">
                    <Link
                      href={`/?project=${encodeURIComponent(g.project_id)}`}
                      className="hover:text-accent hover:underline"
                    >
                      {g.project_name}
                    </Link>
                    <span className="text-xs font-normal text-fg-subtle">{g.items.length}</span>
                  </h4>
                  <ul className="divide-y divide-border overflow-hidden rounded border border-border bg-bg-soft">
                    {g.items.map((t) => (
                      <TicketRow key={t.id} task={t} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="home-agents">
          <h3
            id="home-agents"
            className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle"
          >
            Agents at work{" "}
            {data && <span className="font-normal normal-case">({data.agents.length})</span>}
          </h3>
          {!data ? (
            <ListSkeleton rows={3} />
          ) : data.agents.length === 0 ? (
            <Empty>No agent is working on a ticket right now.</Empty>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded border border-border bg-bg-soft">
              {data.agents.map((t) => (
                <TicketRow key={t.id} task={t} now={now} agent stale={t.stale} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-bg-soft px-4 py-6 text-center text-sm text-fg-subtle">
      {children}
    </div>
  );
}

// One ticket line. In the agents list it also names the agent, the project
// and how long ago it last moved, flagging STALE ones.
function TicketRow({
  task,
  agent = false,
  stale = false,
  now,
}: {
  task: TaskWithProject;
  agent?: boolean;
  stale?: boolean;
  now?: number;
}) {
  return (
    <li>
      <Link
        href={ticketHref(task)}
        className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-sm hover:bg-bg-card focus-visible:bg-bg-card"
      >
        <PriorityIcon priority={task.priority} className="h-4 w-4 shrink-0" />
        <span className="shrink-0 font-mono text-xs text-fg-muted">
          {task.ticket_key ?? task.id}
        </span>
        <span className="min-w-0 flex-1 basis-40 truncate font-medium text-fg">{task.title}</span>
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-fg-subtle">
          {agent && (
            <span className="inline-flex items-center gap-1 text-fg-muted">
              <span aria-label="agent" role="img">
                🤖
              </span>
              {task.assignee_username}
            </span>
          )}
          {agent && <span>{task.project_name}</span>}
          <span className="rounded bg-bg-card px-1.5 py-0.5 text-fg-muted ring-1 ring-border">
            {task.status_key}
          </span>
          {agent && now !== undefined && (
            <time dateTime={task.updated_at} title={new Date(task.updated_at).toLocaleString()}>
              {relativeTime(task.updated_at, now)}
            </time>
          )}
          {stale && (
            <span
              className="rounded bg-danger-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger ring-1 ring-danger-border"
              title="Untouched for 2 hours or more"
            >
              stale
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
