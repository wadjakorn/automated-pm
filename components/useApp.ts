"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Project, PublicUser } from "@/lib/types";
import { api } from "@/lib/client";

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
// falling back to the first project. Returns a setter that updates the URL.
export function useProjects() {
  const router = useRouter();
  const params = useSearchParams();
  const urlProject = params.get("project");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);

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
      : (projects[0]?.id ?? null);

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
      router.push(`?${sp.toString()}`);
    },
    [params, router]
  );

  const closeTask = useCallback(() => {
    const sp = new URLSearchParams(Array.from(params.entries()));
    sp.delete("task");
    router.replace(`?${sp.toString()}`);
  }, [params, router]);

  return { taskParam, openTask, closeTask };
}
