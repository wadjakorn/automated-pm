export type Mode = "json" | "pretty";

export interface Resolved {
  mode: Mode;
  color: boolean;
  api: string;
  argv: string[];      // argv with global flags removed
  showVersion: boolean;
}

// Pull global flags out of argv and resolve the output mode. Pure: all inputs
// (argv, TTY-ness, env) are injected so the resolver is unit-testable.
export function resolveGlobals(input: {
  argv: string[];
  isTTY: boolean;
  env: Record<string, string | undefined>;
}): Resolved {
  const { argv, isTTY, env } = input;
  let json = false;
  let pretty = false;
  let noColor = false;
  let showVersion = false;
  let api = env.PM_API ?? "http://localhost:3000";
  const rest: string[] = [];
  let sawPositional = false;

  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") json = true;
    else if (t === "--pretty") pretty = true;
    else if (t === "--no-color") noColor = true;
    else if (t === "--version" || t === "-v") {
      // `--version <n>` after a subcommand is that command's optimistic-lock
      // option (task update/move), NOT the global version flag. Global only
      // when it precedes the subcommand or carries no value. `-v` is always
      // global — no subcommand defines it.
      const next = argv[i + 1];
      const hasValue = next !== undefined && !next.startsWith("-");
      if (t === "-v" || !sawPositional || !hasValue) showVersion = true;
      else rest.push(t); // leave the value token for the subcommand parser
    } else if (t === "--api") {
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith("--")) {
        api = v;
        i++;
      }
    } else {
      if (!t.startsWith("-")) sawPositional = true;
      rest.push(t);
    }
  }

  const mode: Mode = json ? "json" : pretty ? "pretty" : isTTY ? "pretty" : "json";
  // NO_COLOR disables color by PRESENCE (any value, incl. empty) per no-color.org.
  const color = mode === "pretty" && !noColor && env.NO_COLOR === undefined;
  return { mode, color, api, argv: rest, showVersion };
}
