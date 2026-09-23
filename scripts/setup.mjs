#!/usr/bin/env node
// DiscordMCP interactive setup wizard.
//
// - Scans your LOCAL Discord desktop client for tokens (Windows-first: %APPDATA%\discord\...)
// - Decrypts DPAPI-protected tokens on modern Discord builds
// - Verifies each candidate via Discord's /users/@me — lets you pick by username, not by blob
// - Writes the chosen token to DiscordMCP/.env (never sent anywhere)
// - Detects installed AI clients (Claude Desktop, Cursor, Continue) and installs the MCP config

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { select, checkbox, confirm, input, password } from "@inquirer/prompts";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const isWindows = process.platform === "win32";

const DISCORD_VARIANTS = ["discord", "discordcanary", "discordptb", "discorddevelopment"];
const TOKEN_REGEX =
  /(?:dQw4w9WgXcQ:[A-Za-z0-9+/=]{20,}|mfa\.[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{24,26}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,})/g;

function banner() {
  console.log(`
╔══════════════════════════════════════════╗
║           DiscordMCP  Setup              ║
║      https://github.com/Ernest1101       ║
╚══════════════════════════════════════════╝
`);
}

function scanForTokens() {
  const results = []; // {token, encrypted, variant}
  const seen = new Set();
  if (!isWindows || !process.env.APPDATA) return results;

  for (const variant of DISCORD_VARIANTS) {
    const dir = path.join(process.env.APPDATA, variant, "Local Storage", "leveldb");
    if (!fs.existsSync(dir)) continue;
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".log") && !file.endsWith(".ldb")) continue;
      let buf;
      try {
        buf = fs.readFileSync(path.join(dir, file), "utf8");
      } catch {
        continue;
      }
      for (const match of buf.matchAll(TOKEN_REGEX)) {
        const token = match[0];
        const key = variant + "::" + token;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          token,
          encrypted: token.startsWith("dQw4w9WgXcQ:"),
          variant,
        });
      }
    }
  }
  return results;
}

function getMasterKey(variant) {
  if (!isWindows) return null;
  const localState = path.join(process.env.APPDATA, variant, "Local State");
  if (!fs.existsSync(localState)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(localState, "utf8"));
  } catch {
    return null;
  }
  const encKeyB64 = raw?.os_crypt?.encrypted_key;
  if (!encKeyB64) return null;
  const encKey = Buffer.from(encKeyB64, "base64").subarray(5); // strip "DPAPI" magic
  const psScript = `
Add-Type -AssemblyName System.Security;
$b = [Convert]::FromBase64String("${encKey.toString("base64")}");
$d = [Security.Cryptography.ProtectedData]::Unprotect($b, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser);
[Convert]::ToBase64String($d);
`.trim();
  try {
    const out = execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      psScript,
    ]).toString().trim();
    return Buffer.from(out, "base64");
  } catch {
    return null;
  }
}

function decryptToken(encToken, key) {
  const raw = Buffer.from(encToken.replace("dQw4w9WgXcQ:", ""), "base64");
  if (raw.length < 3 + 12 + 16) throw new Error("payload too small");
  const iv = raw.subarray(3, 15);
  const tag = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(15, raw.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

async function verifyToken(token) {
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: token },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      id: data.id,
      username: data.username,
      display: data.global_name || data.username,
    };
  } catch {
    return null;
  }
}

function detectAiClients() {
  const clients = [];
  const home = os.homedir();

  const claudeDir =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Claude")
      : path.join(process.env.APPDATA || "", "Claude");
  if (fs.existsSync(claudeDir)) {
    clients.push({
      name: "Claude Desktop",
      config: path.join(claudeDir, "claude_desktop_config.json"),
      format: "mcpServers",
    });
  }

  const cursorDir = path.join(home, ".cursor");
  if (fs.existsSync(cursorDir)) {
    clients.push({
      name: "Cursor",
      config: path.join(cursorDir, "mcp.json"),
      format: "mcpServers",
    });
  }

  const claudeCodeDir = path.join(home, ".claude");
  if (fs.existsSync(claudeCodeDir)) {
    clients.push({
      name: "Claude Code",
      config: path.join(claudeCodeDir, "claude_desktop_config.json"),
      format: "mcpServers",
    });
  }

  const continueDir = path.join(home, ".continue");
  if (fs.existsSync(continueDir)) {
    clients.push({
      name: "Continue (VS Code)",
      config: path.join(continueDir, "config.json"),
      format: "continue",
    });
  }

  return clients;
}

function installMcpConfig(client, serverPath) {
  let cfg = {};
  if (fs.existsSync(client.config)) {
    try {
      cfg = JSON.parse(fs.readFileSync(client.config, "utf8"));
    } catch {
      // corrupted / non-JSON — start fresh but back up
      const backup = client.config + ".bak-" + Date.now();
      fs.copyFileSync(client.config, backup);
      console.log(`  ⚠ existing config was not valid JSON; backed up to ${backup}`);
      cfg = {};
    }
  }

  if (client.format === "mcpServers") {
    cfg.mcpServers ??= {};
    cfg.mcpServers.discord = {
      command: "node",
      args: [serverPath],
    };
  } else if (client.format === "continue") {
    cfg.experimental ??= {};
    cfg.experimental.modelContextProtocolServers ??= [];
    cfg.experimental.modelContextProtocolServers =
      cfg.experimental.modelContextProtocolServers.filter((s) => s?.name !== "discord");
    cfg.experimental.modelContextProtocolServers.push({
      name: "discord",
      transport: { type: "stdio", command: "node", args: [serverPath] },
    });
  }

  fs.mkdirSync(path.dirname(client.config), { recursive: true });
  fs.writeFileSync(client.config, JSON.stringify(cfg, null, 2));
}

async function findAccounts() {
  console.log("• Scanning Discord desktop client…");
  const raw = scanForTokens();
  if (raw.length === 0) {
    console.log("  (no candidates found in %APPDATA%\\discord — Discord may not be installed here)");
    return [];
  }
  console.log(`  found ${raw.length} candidate blob(s), verifying…`);

  const keyCache = {};
  const plaintextTokens = [];
  for (const item of raw) {
    if (!item.encrypted) {
      plaintextTokens.push({ token: item.token, variant: item.variant });
      continue;
    }
    if (!(item.variant in keyCache)) keyCache[item.variant] = getMasterKey(item.variant);
    const key = keyCache[item.variant];
    if (!key) continue;
    try {
      const plain = decryptToken(item.token, key);
      plaintextTokens.push({ token: plain, variant: item.variant });
    } catch {
      // skip broken payloads
    }
  }

  // dedupe
  const uniq = new Map();
  for (const t of plaintextTokens) if (!uniq.has(t.token)) uniq.set(t.token, t);

  const verified = [];
  for (const { token, variant } of uniq.values()) {
    process.stdout.write("  .");
    const info = await verifyToken(token);
    if (info) verified.push({ token, variant, ...info });
  }
  process.stdout.write("\n");
  return verified;
}

async function main() {
  banner();

  if (!isWindows) {
    console.log("Automatic token detection currently only works on Windows.");
    console.log("On other platforms, paste your token manually below.\n");
  }

  const verified = isWindows ? await findAccounts() : [];

  let chosenToken;
  if (verified.length === 0) {
    console.log("\nNo accounts detected automatically.");
    const manual = await password({
      message: "Paste your Discord user token:",
      mask: "•",
    });
    const info = await verifyToken(manual.trim());
    if (!info) {
      console.error("❌ That token did not verify against Discord. Aborting.");
      process.exit(1);
    }
    console.log(`✓ Verified as ${info.username} (${info.id})`);
    chosenToken = manual.trim();
  } else if (verified.length === 1) {
    const v = verified[0];
    const ok = await confirm({
      message: `Use ${v.display} (${v.username}, id ${v.id}) from ${v.variant}?`,
      default: true,
    });
    if (!ok) {
      console.log("Cancelled.");
      process.exit(0);
    }
    chosenToken = v.token;
  } else {
    const idx = await select({
      message: `Found ${verified.length} accounts. Pick one:`,
      choices: verified.map((v, i) => ({
        name: `${v.display}  (@${v.username}, id ${v.id}, ${v.variant})`,
        value: i,
      })),
    });
    chosenToken = verified[idx].token;
  }

  // Write .env
  const envPath = path.join(projectRoot, ".env");
  if (fs.existsSync(envPath)) {
    const overwrite = await confirm({
      message: `${envPath} already exists. Overwrite?`,
      default: true,
    });
    if (!overwrite) {
      console.log("Kept existing .env.");
    } else {
      fs.writeFileSync(envPath, `DISCORD_TOKEN=${chosenToken}\n`);
      console.log(`✓ Wrote token to ${envPath}`);
    }
  } else {
    fs.writeFileSync(envPath, `DISCORD_TOKEN=${chosenToken}\n`);
    console.log(`✓ Wrote token to ${envPath}`);
  }

  // Build if dist/index.js doesn't exist yet
  const serverPath = path.join(projectRoot, "dist", "index.js");
  if (!fs.existsSync(serverPath)) {
    const build = await confirm({
      message: "dist/index.js not found. Run `npm run build` now?",
      default: true,
    });
    if (build) {
      try {
        execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
          stdio: "inherit",
          cwd: projectRoot,
        });
      } catch (err) {
        console.error("Build failed. Fix the error, then re-run `npm run setup`.");
        process.exit(1);
      }
    }
  }

  // Detect AI clients
  console.log("\n• Looking for installed AI clients…");
  const clients = detectAiClients();
  if (clients.length === 0) {
    console.log("  no supported AI client detected — add the MCP manually (see README).");
    return;
  }
  console.log(`  found: ${clients.map((c) => c.name).join(", ")}`);

  const picks = await checkbox({
    message: "Install DiscordMCP into which clients?",
    choices: clients.map((c) => ({
      name: `${c.name}  →  ${c.config}`,
      value: c,
      checked: true,
    })),
  });

  for (const c of picks) {
    try {
      installMcpConfig(c, serverPath);
      console.log(`✓ Added "discord" MCP to ${c.name}`);
    } catch (err) {
      console.error(`✗ Failed for ${c.name}:`, err.message);
    }
  }

  console.log(`
✨ Done. Restart the AI client(s) above, then try:
   "list my Discord servers"
   "read the last 20 messages in channel <id>"
`);
}

main().catch((err) => {
  if (err?.name === "ExitPromptError") {
    console.log("\nCancelled.");
    process.exit(0);
  }
  console.error("setup failed:", err);
  process.exit(1);
});
