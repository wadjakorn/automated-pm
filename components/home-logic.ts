// Pure helpers for the My work page (/home).

// Group rows by project, keeping the server's order both for the groups (first
// appearance) and within each group (the API already sorts by priority).
export function groupByProject<T extends { project_id: string; project_name: string }>(
  rows: T[]
): { project_id: string; project_name: string; items: T[] }[] {
  const groups = new Map<string, { project_id: string; project_name: string; items: T[] }>();
  for (const r of rows) {
    let g = groups.get(r.project_id);
    if (!g) {
      g = { project_id: r.project_id, project_name: r.project_name, items: [] };
      groups.set(r.project_id, g);
    }
    g.items.push(r);
  }
  return Array.from(groups.values());
}
