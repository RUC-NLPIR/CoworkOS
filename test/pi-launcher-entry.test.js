import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execute = promisify(execFile);
const launcher = resolve("scripts/start-pi.mjs");

test(
  "Windows launcher runs the Pi JavaScript entry without interpreting the command shim",
  {
    skip: process.platform !== "win32"
  },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "cowork pi launcher "));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bin = join(root, "node_modules", ".bin");
    const bundle = join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle");
    await mkdir(bin, { recursive: true });
    await mkdir(bundle, { recursive: true });
    await writeFile(join(bin, "pi.cmd"), "@echo off\r\necho SHIM_MUST_NOT_RUN\r\nexit /b 91\r\n");
    await writeFile(join(bundle, "cli.js"), "console.log(JSON.stringify(process.argv.slice(2)));\n");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^(COWORK_|PI_|ATRIA_)/.test(key))
    );
    const args = ["--list-models", "literal & value; $(echo unsafe)"];
    const { stdout, stderr } = await execute(process.execPath, [launcher, ...args], {
      cwd: root,
      env: { ...env, COWORK_HARNESS_ROOT: root, ATRIA_HOME: join(root, "home"), PI_OFFLINE: "1" },
      timeout: 10_000
    });
    assert.deepEqual(JSON.parse(stdout.trim()), args);
    assert.equal(stderr, "");
  }
);
