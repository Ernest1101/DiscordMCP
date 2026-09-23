#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client, TextChannel, DMChannel, Message } from "discord.js-selfbot-v13";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import {
  loadSafetyConfig,
  scrubOutbound,
  scrubInbound,
  SafetyError,
} from "./safety.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

for (const candidate of [
  path.join(projectRoot, ".env"),
  path.join(process.cwd(), ".env"),
]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

if (!process.env.DISCORD_TOKEN && process.env.DISCORD_TOKEN_FILE) {
  try {
    const p = process.env.DISCORD_TOKEN_FILE;
    process.env.DISCORD_TOKEN = fs.readFileSync(p, "utf8").trim();
  } catch (err: any) {
    console.error(`[discord-mcp] failed to read DISCORD_TOKEN_FILE: ${err?.message ?? err}`);
  }
}

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error(
    "[discord-mcp] DISCORD_TOKEN not found. Options:\n" +
    `  1) create ${path.join(projectRoot, ".env")} with a line DISCORD_TOKEN=your_token\n` +
    "  2) set env var DISCORD_TOKEN_FILE to a file containing just the token\n" +
    "  3) export DISCORD_TOKEN before launching the server",
  );
  process.exit(1);
}

const safetyConfig = loadSafetyConfig();
console.error(
  `[discord-mcp] safety filter: mode=${safetyConfig.mode}, custom-words=${safetyConfig.customWords.length}${safetyConfig.logFile ? `, log=${safetyConfig.logFile}` : ""}`,
);

const client = new Client({
  checkUpdate: false,
} as any);

let ready = false;
const readyPromise = new Promise<void>((resolve) => {
  client.once("ready", () => {
    ready = true;
    console.error(`[discord-mcp] logged in as ${client.user?.tag}`);
    resolve();
  });
});

client.login(TOKEN).catch((err) => {
  console.error("[discord-mcp] login failed:", err);
  process.exit(1);
});

async function ensureReady() {
  if (!ready) await readyPromise;
}

function truncate(s: string, n = 500): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatMessage(m: Message): string {
  const author = m.author ? `${m.author.username}#${m.author.discriminator ?? "0"}` : "unknown";
  const time = m.createdAt.toISOString();
  const attachments = m.attachments.size
    ? ` [attachments: ${[...m.attachments.values()].map((a) => a.url).join(", ")}]`
    : "";
  const reply = m.reference?.messageId ? ` [reply→${m.reference.messageId}]` : "";
  return `[${time}] ${author} (${m.id})${reply}: ${truncate(m.content, 2000)}${attachments}`;
}

const server = new Server(
  { name: "discord-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const tools = [
  {
    name: "list_servers",
    description: "List every Discord guild (server) the account is a member of.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_server_info",
    description: "Get details for one guild: name, owner, member count, channel count.",
    inputSchema: {
      type: "object",
      properties: { server_id: { type: "string", description: "Guild ID" } },
      required: ["server_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_channels",
    description: "List all text channels in a guild.",
    inputSchema: {
      type: "object",
      properties: { server_id: { type: "string", description: "Guild ID" } },
      required: ["server_id"],
      additionalProperties: false,
    },
  },
  {
    name: "read_messages",
    description: "Read the last N messages in a text channel (default 30, max 100).",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Channel ID" },
        limit: { type: "number", description: "1..100", default: 30 },
      },
      required: ["channel_id"],
      additionalProperties: false,
    },
  },
  {
    name: "send_message",
    description: "Send a text message to a channel or DM. Returns the created message ID.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string" },
        content: { type: "string" },
        reply_to: { type: "string", description: "Optional message ID to reply to" },
      },
      required: ["channel_id", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_message",
    description: "Edit a message the account previously sent.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string" },
        message_id: { type: "string" },
        new_content: { type: "string" },
      },
      required: ["channel_id", "message_id", "new_content"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_message",
    description: "Delete a message (must be authored by this account, or you must have Manage Messages).",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string" },
        message_id: { type: "string" },
      },
      required: ["channel_id", "message_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_dms",
    description: "List open DM and group-DM channels.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "open_dm",
    description: "Open (or fetch) the DM channel with a specific user ID.",
    inputSchema: {
      type: "object",
      properties: { user_id: { type: "string" } },
      required: ["user_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_user_info",
    description: "Look up a Discord user by ID.",
    inputSchema: {
      type: "object",
      properties: { user_id: { type: "string" } },
      required: ["user_id"],
      additionalProperties: false,
    },
  },
  {
    name: "search_messages",
    description: "Search recent messages in a channel for a substring (case-insensitive).",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string" },
        query: { type: "string" },
        limit: { type: "number", description: "How many recent messages to scan (max 100)", default: 100 },
      },
      required: ["channel_id", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "who_am_i",
    description: "Return the logged-in Discord account.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "add_reaction",
    description: "Add an emoji reaction to a message.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string" },
        message_id: { type: "string" },
        emoji: { type: "string", description: "Unicode emoji or name:id for custom" },
      },
      required: ["channel_id", "message_id", "emoji"],
      additionalProperties: false,
    },
  },
  {
    name: "set_status",
    description: "Set presence status: online | idle | dnd | invisible.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["online", "idle", "dnd", "invisible"] },
      },
      required: ["status"],
      additionalProperties: false,
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  await ensureReady();
  const { name, arguments: args = {} } = req.params;
  const a = args as Record<string, any>;

  try {
    switch (name) {
      case "who_am_i": {
        const u = client.user!;
        return text(`${u.username}#${u.discriminator ?? "0"} (id: ${u.id})`);
      }

      case "list_servers": {
        const lines = [...client.guilds.cache.values()].map(
          (g) => `- ${g.name} (id: ${g.id}, members: ${g.memberCount})`,
        );
        return text(lines.length ? lines.join("\n") : "no guilds");
      }

      case "get_server_info": {
        const g = await client.guilds.fetch(a.server_id);
        const owner = await g.fetchOwner();
        return text(
          `Name: ${g.name}\nID: ${g.id}\nOwner: ${owner.user.username} (${owner.user.id})\nMembers: ${g.memberCount}\nChannels: ${g.channels.cache.size}\nCreated: ${g.createdAt.toISOString()}`,
        );
      }

      case "list_channels": {
        const g = await client.guilds.fetch(a.server_id);
        const chans = await g.channels.fetch();
        const lines = [...chans.values()]
          .filter((c) => c && (c.type === "GUILD_TEXT" || c.type === "GUILD_NEWS"))
          .map((c) => `- #${c!.name} (id: ${c!.id}, type: ${c!.type})`);
        return text(lines.length ? lines.join("\n") : "no text channels");
      }

      case "read_messages": {
        const limit = Math.min(Math.max(Number(a.limit ?? 30), 1), 100);
        const ch = await client.channels.fetch(a.channel_id);
        if (!ch || !("messages" in ch)) throw new Error("Channel is not a text channel");
        const msgs = await (ch as TextChannel).messages.fetch({ limit });
        const lines = [...msgs.values()].reverse().map(formatMessage);
        const out = lines.length ? lines.join("\n") : "no messages";
        return text(scrubInbound(out, safetyConfig));
      }

      case "send_message": {
        const content = scrubOutbound(String(a.content), safetyConfig);
        const ch = await client.channels.fetch(a.channel_id);
        if (!ch || !("send" in ch)) throw new Error("Channel does not support sending");
        const sent = await (ch as TextChannel).send({
          content,
          ...(a.reply_to ? { reply: { messageReference: a.reply_to } } : {}),
        } as any);
        return text(`sent id=${sent.id}`);
      }

      case "edit_message": {
        const newContent = scrubOutbound(String(a.new_content), safetyConfig);
        const ch = await client.channels.fetch(a.channel_id);
        if (!ch || !("messages" in ch)) throw new Error("Channel is not a text channel");
        const m = await (ch as TextChannel).messages.fetch(a.message_id);
        await m.edit(newContent);
        return text(`edited id=${m.id}`);
      }

      case "delete_message": {
        const ch = await client.channels.fetch(a.channel_id);
        if (!ch || !("messages" in ch)) throw new Error("Channel is not a text channel");
        const m = await (ch as TextChannel).messages.fetch(a.message_id);
        await m.delete();
        return text(`deleted id=${a.message_id}`);
      }

      case "list_dms": {
        const chans = [...client.channels.cache.values()].filter(
          (c: any) => c.type === "DM" || c.type === "GROUP_DM",
        );
        const lines = chans.map((c: any) => {
          if (c.type === "DM") {
            const u = c.recipient;
            return `- DM with ${u?.username ?? "?"} (channel: ${c.id}, user: ${u?.id ?? "?"})`;
          }
          return `- Group "${c.name ?? "unnamed"}" (channel: ${c.id})`;
        });
        return text(lines.length ? lines.join("\n") : "no open DMs");
      }

      case "open_dm": {
        const u = await client.users.fetch(a.user_id);
        const dm = await u.createDM();
        return text(`DM channel id=${dm.id}`);
      }

      case "get_user_info": {
        const u = await client.users.fetch(a.user_id);
        return text(
          `Username: ${u.username}\nID: ${u.id}\nBot: ${u.bot}\nCreated: ${u.createdAt.toISOString()}\nAvatar: ${u.displayAvatarURL()}`,
        );
      }

      case "search_messages": {
        const limit = Math.min(Math.max(Number(a.limit ?? 100), 1), 100);
        const ch = await client.channels.fetch(a.channel_id);
        if (!ch || !("messages" in ch)) throw new Error("Channel is not a text channel");
        const msgs = await (ch as TextChannel).messages.fetch({ limit });
        const q = String(a.query).toLowerCase();
        const hits = [...msgs.values()]
          .filter((m) => m.content.toLowerCase().includes(q))
          .reverse()
          .map(formatMessage);
        const out = hits.length ? hits.join("\n") : `no matches for "${a.query}"`;
        return text(scrubInbound(out, safetyConfig));
      }

      case "add_reaction": {
        const ch = await client.channels.fetch(a.channel_id);
        if (!ch || !("messages" in ch)) throw new Error("Channel is not a text channel");
        const m = await (ch as TextChannel).messages.fetch(a.message_id);
        await m.react(a.emoji);
        return text(`reacted ${a.emoji} on ${m.id}`);
      }

      case "set_status": {
        client.user!.setStatus(a.status);
        return text(`status=${a.status}`);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return text(`ERROR: ${err?.message ?? String(err)}`, true);
  }
});

function text(body: string, isError = false) {
  return {
    content: [{ type: "text", text: body }],
    isError,
  };
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[discord-mcp] MCP server ready on stdio");
}

main().catch((err) => {
  console.error("[discord-mcp] fatal:", err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await client.destroy();
  process.exit(0);
});
