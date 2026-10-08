import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

// Regression: the CLI used to call process.exit() right after writing its output.
// stdout to a pipe is asynchronous in Node, so large output (e.g. a ~300KB
// `task list --json`) was cut off whenever the reader was slower than the writer
// — `pm task list --json | jq length` failed with "Unfinished string at EOF".

const ROOT = resolve(__dirname, "..");
const TSX = resolve(ROOT, "node_modules/.bin/tsx");
const PM = resolve(ROOT, "cli/pm.ts");

// ~1MB of tasks: far beyond a 64KB pipe buffer.
const TASKS = Array.from({ length: 2000 }, (_, i) => ({
  id: `t${i}`,
  title: `task ${i}`,
  description: "x".repeat(400),
  status_key: "todo",
}));

let server: Server;
let api: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const big = req.url?.startsWith("/api/tasks?");
    res.writeHead(big ? 200 : 404, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        big ? TASKS : { error: "not_found", message: "y".repeat(500_000) }
      )
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

// Spawn the CLI with stdout as a pipe and deliberately read it late, so the
// child finishes writing long before the pipe has drained.
function runSlowReader(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((done, reject) => {
    const child = spawn(TSX, [PM, ...args, "--api", api], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "inherit"],
    });
    child.stdout.pause();
    const chunks: Buffer[] = [];
    setTimeout(() => {
      child.stdout.on("data", (c: Buffer) => chunks.push(c));
      child.stdout.resume();
    }, 1500);
    child.on("error", reject);
    child.on("close", (code) => done({ code, out: Buffer.concat(chunks).toString("utf8") }));
  });
}

describe("CLI output to a slow pipe", () => {
  it("writes complete JSON for a large success payload", async () => {
    const { code, out } = await runSlowReader(["task", "list", "--project", "p", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toHaveLength(TASKS.length);
  }, 30_000);

  it("writes complete JSON for a large error payload and exits 1", async () => {
    const { code, out } = await runSlowReader(["task", "get", "--id", "nope", "--json"]);
    expect(code).toBe(1);
    expect(JSON.parse(out).error).toBe("not_found");
  }, 30_000);
});
