"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Project, PublicUser } from "@/lib/types";
import { api } from "@/lib/client";
import { pickDefaultProject } from "./board-logic";

// localStorage key remembering the last project the user had selected, so a
// bare `/` reopens it instead of whichever project happens to sort first.
const LAST_PROJECT_KEY = "project:last";

// Current user (or null when anonymous). Auth is optional, so null is normal.
export function useAuth() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      setUser(null);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { user, loaded, refresh };
}

// All users, for assignee pickers.
export function useUsers() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const reload = useCallback(async () => {
    try {
      setUsers(await api.listUsers());
    } catch {
      setUsers([]);
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { users, reload };
}

// Loads projects and tracks the selected one via the ?project= query string,
// falling back to the last-selected project (if still live and not hidden or
// archived), else the first visible one. Returns a setter that updates the URL.
export function useProjects() {
  const router = useRouter();
  const params = useSearchParams();
  const urlProject = params.get("project");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Read after mount (not during render) so SSR and the first client render
  // agree; projects are fetched client-side anyway, so nothing is lost.
  const [lastId, setLastId] = useState<string | null>(null);

  useEffect(() => {
    try {
      setLastId(localStorage.getItem(LAST_PROJECT_KEY));
    } catch {}
  }, []);

  const reload = useCallback(async () => {
    const list = await api.listProjects();
    setProjects(list);
    setLoaded(true);
    return list;
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const selectedId =
    urlProject && projects.some((p) => p.id === urlProject)
      ? urlProject
      : pickDefaultProject(projects, lastId);

  // Remember whatever ends up selected (explicit pick or default).
  useEffect(() => {
    if (!selectedId) return;
    try {
      localStorage.setItem(LAST_PROJECT_KEY, selectedId);
    } catch {}
  }, [selectedId]);

  const select = useCallback(
    (id: string) => {
      const sp = new URLSearchParams(Array.from(params.entries()));
      sp.set("project", id);
      router.replace(`?${sp.toString()}`);
    },
    [params, router]
  );

  return { projects, selectedId, select, reload, loaded };
}

// Poll a function on an interval (default 4s), but ONLY while the tab is
// visible and the window is focused. Hidden/blurred -> interval stops, zero
// requests. On return -> one immediate refetch + interval resumes, so the board
// is fresh the instant the user looks without waiting for the next tick.
export function usePoll(fn: () => void | Promise<void>, deps: unknown[], ms = 4000) {
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setInterval> | null = null;

    const run = () => {
      if (alive) fn();
    };
    const isActive = () =>
      document.visibilityState === "visible" && document.hasFocus();

    const start = () => {
      if (t !== null || !isActive()) return;
      run();
      t = setInterval(run, ms);
    };
    const stop = () => {
      if (t !== null) {
        clearInterval(t);
        t = null;
      }
    };

    const onVisibility = () => (isActive() ? start() : stop());

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", start);
    window.addEventListener("blur", stop);

    start();

    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", start);
      window.removeEventListener("blur", stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// Reads the `task` query param and exposes setters that push/strip it.
// openTask pushes (so browser Back closes the drawer); closeTask replaces.
export function useTaskRoute() {
  const router = useRouter();
  const params = useSearchParams();
  const taskParam = params.get("task");

  const openTask = useCallback(
    (id: string) => {
      const sp = new URLSearchParams(Array.from(params.entries()));
      sp.set("task", id);
      const qs = sp.toString();
      router.push(qs ? `?${qs}` : window.location.pathname);
    },
    [params, router]
  );

  // Rewrite the `task` param without adding a history entry — used to
  // canonicalize a legacy nanoid link to its ticket key once it resolves.
  // Optionally switches `project` in the SAME write: a cold deep link has to
  // do both at once, and two separate router.replace calls would race, the
  // second one clobbering the first's param.
  //
  // Reads window.location.search rather than the `params` snapshot so it can't
  // resurrect a stale query string if something else just navigated.
  const replaceTask = useCallback(
    (id: string, projectId?: string) => {
      const sp = new URLSearchParams(window.location.search);
      sp.set("task", id);
      if (projectId) sp.set("project", projectId);
      const qs = sp.toString();
      router.replace(qs ? `?${qs}` : window.location.pathname);
    },
    [router]
  );

  const closeTask = useCallback(() => {
    const sp = new URLSearchParams(Array.from(params.entries()));
    sp.delete("task");
    const qs = sp.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname);
  }, [params, router]);

  return { taskParam, openTask, replaceTask, closeTask };
}

// Fired after this tab answers/resolves/asks a question so every inbox view
// (the Nav badge, the Inbox page) refetches now instead of on its next tick.
const INBOX_EVENT = "pm:inbox-changed";

export function notifyInboxChanged() {
  window.dispatchEvent(new Event(INBOX_EVENT));
}

// Re-run `fn` whenever notifyInboxChanged() fires in this tab.
export function useInboxChanged(fn: () => void) {
  useEffect(() => {
    window.addEventListener(INBOX_EVENT, fn);
    return () => window.removeEventListener(INBOX_EVENT, fn);
  }, [fn]);
}

// Number of open questions across all projects, for the Nav's Inbox badge.
// Polled every 15s while the tab is visible; null until the first answer.
export function useInboxCount(ms = 15000) {
  const [count, setCount] = useState<number | null>(null);
  const load = useCallback(async () => {
    try {
      setCount((await api.listInbox()).length);
    } catch {
      // keep the last known count; the next tick retries
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  usePoll(load, [load], ms);
  useInboxChanged(load);
  return count;
}
