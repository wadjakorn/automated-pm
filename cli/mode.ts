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

  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") json = true;
    else if (t === "--pretty") pretty = true;
    else if (t === "--no-color") noColor = true;
    else if (t === "--version" || t === "-v") showVersion = true;
    else if (t === "--api") {
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith("--")) {
        api = v;
        i++;
      }
    } else rest.push(t);
  }

  const mode: Mode = json ? "json" : pretty ? "pretty" : isTTY ? "pretty" : "json";
  // NO_COLOR disables color by PRESENCE (any value, incl. empty) per no-color.org.
  const color = mode === "pretty" && !noColor && env.NO_COLOR === undefined;
  return { mode, color, api, argv: rest, showVersion };
}
