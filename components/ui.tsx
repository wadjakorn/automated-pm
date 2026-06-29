"use client";

// Small shared UI primitives used across the app: a loading spinner and
// skeleton placeholders. Kept dependency-free and theme-token driven.

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

// A single shimmering placeholder bar. Compose several for list/card skeletons.
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`relative block overflow-hidden rounded bg-bg-soft ${className}`}
    >
      <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-fg/10 to-transparent" />
    </span>
  );
}

// Board-shaped loading state: a few ghost columns with ghost cards.
export function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-4" aria-hidden>
      {Array.from({ length: 4 }).map((_, c) => (
        <div
          key={c}
          className="flex h-full w-72 shrink-0 flex-col gap-2 rounded-lg bg-bg-soft p-2"
        >
          <Skeleton className="mx-1 my-1 h-4 w-24" />
          {Array.from({ length: 3 - (c % 2) }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

// Vertical list of ghost rows for Archive/Trash pages.
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
