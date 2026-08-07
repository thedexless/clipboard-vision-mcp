#!/usr/bin/env node
/**
 * MCP smoke test — validates ANY local MCP server from opencode config.
 *
 * Spawns the named MCP server exactly the way opencode does — command + env
 * parsed live from `~/.config/opencode/opencode.jsonc` (server name from
 * CLI arg or default `argus`), then runs a real MCP `initialize` +
 * `tools/list` handshake over stdio.
 *
 * Exit 0 only when the server comes up and answers a tool list.
 * On any startup crash, the server's buffered error output is printed and
 * exit is 1 — a broken MCP can never silently reach an agent session again.
 *
 * Usage: node scripts/mcp-smoke.mjs [serverName]
 *   serverName  — key under "mcp" in opencode.jsonc (default: "argus")
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SERVER_NAME = process.argv[2] ?? "argus";

const CONFIG_CANDIDATES = [
  process.env.OPENCODE_CONFIG,
  join(homedir(), ".config", "opencode", "opencode.jsonc"),
].filter(Boolean);

function stripComments(src) {
  let out = "";
  let i = 0;
  let inString = false;
  let escaped = false;
  while (i < src.length) {
    const c = src[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      i += 1;
    } else if (c === '"') {
      inString = true;
      out += c;
      i += 1;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
    } else if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

function findEntry() {
  let lastErr = null;
  for (const file of CONFIG_CANDIDATES) {
    try {
      const raw = readFileSync(file, "utf8");
      const parsed = JSON.parse(stripComments(raw).replace(/^\uFEFF/, ""));
      const entry = parsed?.mcp?.[SERVER_NAME];
      if (!entry) {
        lastErr = new Error(`no "${SERVER_NAME}" key in ${file}`);
        continue;
      }
      if (entry.type !== "local" || !Array.isArray(entry.command)) {
        throw new Error(`"${SERVER_NAME}" in ${file} is not a local command server`);
      }
      return { entry, file };
    } catch (e) {
      lastErr = e;
    }
  }
  process.stderr.write(`mcp-smoke: could not read "${SERVER_NAME}" entry: ${lastErr?.message}\n`);
  process.exit(2);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const { entry } = findEntry();
const serverEnv = { ...process.env, ...(entry.environment ?? {}) };

console.log(`[mcp-smoke] spawning ${SERVER_NAME}: ${entry.command.join(" ")}`);
const child = spawn(entry.command[0], entry.command.slice(1), {
  env: serverEnv,
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (d) => (stderr += d.toString()));

const startAt = Date.now();
const pendings = new Map();

function dispatch(line) {
  const t = line.trim();
  if (!t) return;
  let msg;
  try {
    msg = JSON.parse(t);
  } catch {
    return;
  }
  if (msg.id !== undefined && pendings.has(msg.id)) {
    pendings.get(msg.id)(msg);
    pendings.delete(msg.id);
  }
}

child.stdout.on("data", (d) => {
  for (const line of d.toString().split("\n")) dispatch(line);
});

function request(id, method, params = {}) {
  return new Promise((resolve, reject) => {
    pendings.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pendings.has(id)) {
        pendings.delete(id);
        reject(new Error(`timeout waiting for ${method} response`));
      }
    }, 15000);
  });
}

function fail(msg) {
  process.stderr.write(`[mcp-smoke] FAILED: ${msg}\n`);
  if (stderr.trim()) process.stderr.write(stderr);
  try {
    child.kill("SIGTERM");
  } catch {}
  process.exit(1);
}

try {
  let init;
  try {
    init = await request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-smoke", version: "1.0.0" },
    });
  } catch {
    fail("server died or never answered initialize");
  }

  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  let tools;
  try {
    tools = await request(2, "tools/list", {});
  } catch {
    fail("tools/list did not respond");
  }

  const serverInfo = init.result?.serverInfo ?? {};
  const toolCount = Array.isArray(tools.result?.tools) ? tools.result.tools.length : 0;
  console.log(
    `[mcp-smoke] OK ${SERVER_NAME} MCP server (${serverInfo.name ?? "?"} v${serverInfo.version ?? "?"}) ` +
      `tools=${toolCount} in ${((Date.now() - startAt) / 1000).toFixed(1)}s`,
  );
  child.kill("SIGTERM");
  process.exit(0);
} catch (e) {
  fail(e.message);
}