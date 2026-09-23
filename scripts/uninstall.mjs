#!/usr/bin/env node
// Remove the "discord" MCP entry from installed AI-client configs.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkbox, confirm } from "@inquirer/prompts";

const home = os.homedir();

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
  list.push({
    name: "Claude Code",
    config: path.join(home, ".claude", "claude_desktop_config.json"),
    format: "mcpServers",
  });
  list.push({
    name: "Continue (VS Code)",
    config: path.join(home, ".continue", "config.json"),
    format: "continue",
  });
  return list.filter((c) => fs.existsSync(c.config));
}

function hasDiscordEntry(client) {
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
