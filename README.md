<p align="center">
  <img src="assets/banner.jpg" alt="DiscordMCP" width="100%">
</p>

<h1 align="center">DiscordMCP</h1>

<p align="center">
  <b>Discord MCP server</b> — let Claude and other AI clients control your Discord account
</p>

<p align="center">
  <a href="#installation"><img src="https://img.shields.io/badge/node-%E2%89%A518-5FA04E?logo=node.js&logoColor=white" alt="node"></a>
  <a href="#"><img src="https://img.shields.io/badge/MCP-compatible-000?logo=anthropic&logoColor=white" alt="mcp"></a>
  <a href="#"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
</p>

---

An MCP server that gives Claude and other AI assistants access to your Discord: read channels, send messages, manage DMs, react, search, and more. Works via a **user token** (self-bot) powered by `discord.js-selfbot-v13`.

> ⚠️ **Heads-up.** Self-botting violates Discord's ToS. Your account can get banned. Use at your own risk — ideally on a secondary account. Never share your token, it grants full control over the account.

## Features

| Tool | What it does |
|---|---|
| `who_am_i` | Show the logged-in account |
| `list_servers` | List every guild the account is in |
| `get_server_info` | Details for a specific guild |
| `list_channels` | List text channels in a guild |
| `read_messages` | Read the last N messages in a channel |
| `send_message` | Send a message (can reply to another one) |
| `edit_message` | Edit a message you sent |
| `delete_message` | Delete a message |
| `list_dms` | List open DMs and group DMs |
| `open_dm` | Open a DM with a user by ID |
| `get_user_info` | Look up a user by ID |
| `search_messages` | Search a channel's recent messages for a substring |
| `add_reaction` | React to a message |
| `set_status` | Change presence (online/idle/dnd/invisible) |

## Installation

```bash
git clone https://github.com/Ernest1101/DiscordMCP.git
cd DiscordMCP
npm install
npm run build
```

## Getting your user token

1. Open Discord in a browser.
2. F12 → **Network** tab.
3. Reload the page and pick any request to `discord.com/api/...`.
4. Copy the `authorization` header value — that's your token.

Never publish this token and never share it with anyone.

## Configuration

Copy `.env.example` to `.env` and paste your token:

```
DISCORD_TOKEN=your_token_here
```

## Claude Desktop setup

Open the Claude Desktop config:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Add this under `mcpServers`:

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["C:\\path\\to\\DiscordMCP\\dist\\index.js"],
      "env": {
        "DISCORD_TOKEN": "your_token_here"
      }
    }
  }
}
```

Restart Claude Desktop — the `discord` tool set will show up in the tools list.

## Claude Code setup

```bash
claude mcp add discord -- node C:\path\to\DiscordMCP\dist\index.js
```

The token will be picked up from `.env` in the project folder, or pass it via `--env DISCORD_TOKEN=...`.

## Other MCP clients (Cursor, Cline, etc.)

The server speaks the standard MCP stdio protocol. Any MCP client launches it the same way:

```
command: node
args:    ["dist/index.js"]
env:     DISCORD_TOKEN=...
```

## Development

```bash
npm run dev        # tsc in watch mode
npm start          # run the built server
```

## Example prompts for Claude

- "List all my Discord servers"
- "Read the last 20 messages from channel 123456789"
- "Send 'hello' to channel 123456789"
- "Search channel 123456789 for messages mentioning 'deploy'"
- "Open a DM with user 987654321 and send them 'test'"

## License

MIT
