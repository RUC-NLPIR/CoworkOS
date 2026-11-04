import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { test } from "node:test";

const execute = promisify(execFile);
const launcher = resolve("scripts/start-pi.mjs");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "atria-watch-launcher-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidence = join(root, "supervisor.json");
  const piDirectory = join(
    root,
    "node_modules",
    ...(process.platform === "win32" ? ["@earendil-works", "pi-coding-agent", "dist", "bundle"] : [".bin"])
  );
  await mkdir(piDirectory, { recursive: true });
  await mkdir(join(root, "dist", "src", "cli"), { recursive: true });
  await writeFile(
    join(piDirectory, process.platform === "win32" ? "cli.js" : "pi"),
    "console.log('fixture Pi exited');\n"
  );
  await writeFile(
    join(root, "dist", "src", "cli", "cowork.js"),
    `require('node:fs').writeFileSync(${JSON.stringify(evidence)},JSON.stringify(process.argv.slice(2)));`
  );
  await writeFile(join(root, "config.json"), "{}\n");
  const isolatedEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(?:COWORK_|ATRIA_|PI_|SERPER_)/.test(name))
  );
  const workspace = join(root, "workspace");
  const launch = (args = []) =>
    execute(process.execPath, [launcher, ...args], {
      cwd: root,
      timeout: 10_000,
      env: {
        ...isolatedEnv,
        ATRIA_HOME: join(root, "home"),
        PI_CODING_AGENT_DIR: join(root, "pi"),
        COWORK_CONFIG: join(root, "config.json"),
        COWORK_HARNESS_ROOT: root,
        COWORK_WORKSPACE: workspace,
        COWORK_TASK_ID: "first-task",
        COWORK_API_BASE: "http://unused.test",
        COWORK_API_KEY: "fixture"
      }
    });
  return { root, evidence, workspace, launch };
}

test("an automatic Watch supervisor receives the whole workspace rather than its launch Task", async (t) => {
  const f = await fixture(t);
  await f.launch();
  let args;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      args = JSON.parse(await readFile(f.evidence, "utf8"));
      break;
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    await delay(10);
  }
  assert.ok(args, "the detached fixture supervisor must launch");
  assert.equal(args[0], "watch-supervisor");
  assert.equal(args[args.indexOf("--workspace") + 1], f.workspace);
  assert.equal(args.includes("--task"), false, "later Tasks must not be excluded by the singleton owner");
});

test("information-only Pi commands do not start a detached Watch supervisor", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, "config.json"), "invalid fixture configuration");
  for (const argument of ["--help", "-h", "--version", "--list-models"]) await f.launch([argument]);
  await assert.rejects(readFile(f.evidence, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(join(f.root, "pi", "settings.json"), "utf8"), { code: "ENOENT" });
});
