// Shared domain types. Used by API routes, repo, CLI, and UI.

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Status {
  id: string;
  project_id: string;
  key: string;
  label: string;
  sort_order: number;
  is_final: boolean;
}

export interface Transition {
  id: string;
  project_id: string;
  from_key: string;
  to_key: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status_key: string;
  rank: number;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// A project's full state machine: ordered statuses + allowed transition edges.
export interface StateMachine {
  statuses: Status[];
  transitions: Transition[];
}

export interface TransitionCheck {
  ok: boolean;
  reason?: string;
}
