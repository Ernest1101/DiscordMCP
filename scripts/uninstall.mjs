#!/usr/bin/env node
// Remove the "discord" MCP entry from installed AI-client configs.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { checkbox, confirm } from "@inquirer/prompts";

const home = os.homedir();

function claudeCliAvailable() {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    execFileSync(cmd, ["claude"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function candidateClients() {
  const list = [];
  const claudeDir =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Claude")
      : path.join(process.env.APPDATA || "", "Claude");
  list.push({
    name: "Claude Desktop",
    config: path.join(claudeDir, "claude_desktop_config.json"),
    format: "mcpServers",
  });
  list.push({
    name: "Cursor",
    config: path.join(home, ".cursor", "mcp.json"),
    format: "mcpServers",
  });
  if (claudeCliAvailable() || fs.existsSync(path.join(home, ".claude.json"))) {
    list.push({
      name: "Claude Code",
      config: path.join(home, ".claude.json"),
      format: "claude-cli",
    });
  }
  // Also flag the stale file that older setup wrote to.
  list.push({
    name: "Claude Code (legacy stray file)",
    config: path.join(home, ".claude", "claude_desktop_config.json"),
    format: "mcpServers",
  });
  list.push({
    name: "Continue (VS Code)",
    config: path.join(home, ".continue", "config.json"),
    format: "continue",
  });
  return list.filter((c) => {
    if (c.format === "claude-cli") return true;
    return fs.existsSync(c.config);
  });
}

function claudeCliHasDiscord() {
  const cmd = process.platform === "win32" ? "claude.cmd" : "claude";
  try {
    const out = execFileSync(cmd, ["mcp", "list"], { encoding: "utf8" });
    return /\bdiscord\b/.test(out);
  } catch {
    return false;
  }
}

function hasDiscordEntry(client) {
  if (client.format === "claude-cli") return claudeCliHasDiscord();
  try {
    const cfg = JSON.parse(fs.readFileSync(client.config, "utf8"));
    if (client.format === "mcpServers") {
      return Boolean(cfg?.mcpServers?.discord);
    }
    return Boolean(
      cfg?.experimental?.modelContextProtocolServers?.some?.((s) => s?.name === "discord"),
    );
  } catch {
    return false;
  }
}

function removeDiscordEntry(client) {
  if (client.format === "claude-cli") {
    const cmd = process.platform === "win32" ? "claude.cmd" : "claude";
    execFileSync(cmd, ["mcp", "remove", "discord", "--scope", "user"], {
      stdio: "inherit",
    });
    return;
  }
  const cfg = JSON.parse(fs.readFileSync(client.config, "utf8"));
  if (client.format === "mcpServers") {
    if (cfg?.mcpServers) delete cfg.mcpServers.discord;
    if (cfg?.mcpServers && Object.keys(cfg.mcpServers).length === 0) delete cfg.mcpServers;
  } else if (client.format === "continue") {
    if (Array.isArray(cfg?.experimental?.modelContextProtocolServers)) {
      cfg.experimental.modelContextProtocolServers =
        cfg.experimental.modelContextProtocolServers.filter((s) => s?.name !== "discord");
      if (cfg.experimental.modelContextProtocolServers.length === 0) {
        delete cfg.experimental.modelContextProtocolServers;
      }
    }
  }
  fs.writeFileSync(client.config, JSON.stringify(cfg, null, 2));
}

async function main() {
  console.log(`
╔══════════════════════════════════════════╗
║        DiscordMCP  Uninstall             ║
╚══════════════════════════════════════════╝
`);

  const clients = candidateClients().filter(hasDiscordEntry);

  if (clients.length === 0) {
    console.log('No "discord" MCP entry found in any known client config. Nothing to do.');
    return;
  }

  const picks = await checkbox({
    message: 'Remove the "discord" MCP entry from which clients?  (SPACE to toggle, ENTER to confirm)',
    choices: clients.map((c) => ({
      name: `${c.name}  →  ${c.config}`,
      value: c,
      checked: true,
    })),
    required: false,
  });

  if (picks.length === 0) {
    console.log("Nothing selected. Bye.");
    return;
  }

  const ok = await confirm({ message: `Remove from ${picks.length} client(s)?`, default: true });
  if (!ok) return;

  for (const c of picks) {
    try {
      removeDiscordEntry(c);
      console.log(`✓ Removed from ${c.name}`);
    } catch (err) {
      console.error(`✗ ${c.name}: ${err.message}`);
    }
  }
  console.log("\nDone. Restart the affected AI client(s) so they drop the stale MCP entry.");
}

main().catch((err) => {
  if (err?.name === "ExitPromptError") {
    console.log("\nCancelled.");
    process.exit(0);
  }
  console.error("uninstall failed:", err);
  process.exit(1);
});
