// Validation for a project's remote repository URL. Shared by repo (validation)
// and tests. We accept the common ways a Git remote is written:
//   - http(s)://host/org/repo(.git)
//   - git://host/org/repo(.git)
//   - ssh://[user@]host[:port]/org/repo(.git)
//   - scp-style  user@host:org/repo(.git)   (the form `git clone` prints)
// Empty / null clears the field. Anything else is rejected so a typo can't be
// silently stored as the repo an agent will act on.

const URL_SCHEME = /^(https?|git|ssh):\/\/[^\s/]+\/.+/i;
// scp-style: user@host:path — no scheme, single colon between host and path.
const SCP_LIKE = /^[^\s@/]+@[^\s@:/]+:[^\s]+$/;

// Normalize an incoming value to either null (cleared) or a trimmed string.
export function normalizeRemoteRepoUrl(
  value: string | null | undefined
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function isRemoteRepoUrl(value: string): boolean {
  return URL_SCHEME.test(value) || SCP_LIKE.test(value);
}
