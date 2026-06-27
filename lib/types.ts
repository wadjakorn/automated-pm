// Shared domain types. Used by API routes, repo, CLI, and UI.
import type { Priority } from "./priority";

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
  priority: Priority;
  rank: number;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Archived = filed away off the board, but still live (direct link + search
  // find it). Independent of deleted_at (Trash). Null = not archived.
  archived_at: string | null;
  // Attribution (nullable, backward compat). *_username are joined for display
  // and are not stored columns.
  creator_id: string | null;
  assignee_id: string | null;
  creator_username: string | null;
  assignee_username: string | null;
}

// A user account. password_hash and api_token are secrets — never serialize
// them to clients. PublicUser is the safe shape returned by the API.
export interface User {
  id: string;
  username: string;
  password_hash: string;
  api_token: string;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
  created_at: string;
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

// Stored verb for a ticket link. One directed row per link; the inverse label
// (e.g. "blocked by") is derived at read time. `relates` is symmetric.
export type LinkVerb = "blocks" | "causes" | "relates";

// A link as seen from a given viewer ticket: the verb, whether the viewer is
// the edge's source (drives the displayed label), and the other ticket's
// display fields. `task.deleted_at` non-null = the other ticket was trashed.
export interface LinkedTicket {
  link_id: string;
  verb: LinkVerb;
  is_source: boolean;
  label: string;
  task: {
    id: string;
    title: string;
    status_key: string;
    project_id: string;
    deleted_at: string | null;
  };
}
