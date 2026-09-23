# DiscordMCP

MCP-сервер, который даёт Claude и другим ИИ доступ к твоему Discord: читать каналы, писать сообщения, работать с личками, реакциями и т.д. Работает через **user-токен** (self-bot) с помощью `discord.js-selfbot-v13`.

> ⚠️ **Осторожно.** Использование self-bot нарушает Discord ToS. Discord может забанить аккаунт. Используй на свой страх и риск, лучше на второстепенном аккаунте. Никому не показывай свой токен — он даёт полный контроль над аккаунтом.

## Что умеет

| Инструмент | Что делает |
|---|---|
| `who_am_i` | показывает залогиненный аккаунт |
| `list_servers` | список всех серверов |
| `get_server_info` | инфа о сервере |
| `list_channels` | текстовые каналы сервера |
| `read_messages` | читает последние N сообщений в канале |
| `send_message` | отправляет сообщение (можно как reply) |
| `edit_message` | редактирует своё сообщение |
| `delete_message` | удаляет сообщение |
| `list_dms` | список открытых личек и групп |
| `open_dm` | открывает личку с юзером по ID |
| `get_user_info` | инфа о юзере |
| `search_messages` | ищет подстроку в последних сообщениях канала |
| `add_reaction` | ставит реакцию |
| `set_status` | меняет статус (online/idle/dnd/invisible) |

## Установка

```bash
git clone https://github.com/Ernest1101/DiscordMCP.git
cd DiscordMCP
npm install
npm run build
```

## Получение user-токена

1. Открой Discord в браузере.
2. F12 → вкладка **Network**.
3. Обнови страницу, найди любой запрос к `discord.com/api/...`.
4. В заголовках запроса скопируй значение `authorization` — это и есть твой токен.

Никогда не публикуй этот токен и не давай его никому.

## Настройка

Скопируй `.env.example` в `.env` и вставь токен:

```
DISCORD_TOKEN=твой_токен_сюда
```

## Подключение к Claude Desktop

Открой конфиг Claude Desktop:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Добавь в `mcpServers`:

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["C:\\путь\\к\\DiscordMCP\\dist\\index.js"],
      "env": {
        "DISCORD_TOKEN": "твой_токен_сюда"
      }
    }
  }
}
```

Перезапусти Claude Desktop. В списке инструментов появится `discord`.

## Подключение к Claude Code

```bash
claude mcp add discord -- node C:\путь\к\DiscordMCP\dist\index.js
```

Токен подхватится из `.env` в папке проекта, либо задай его через `--env DISCORD_TOKEN=...`.

## Подключение к другим ИИ (Cursor, Cline, любой MCP-клиент)

Сервер общается по stdio через стандарт MCP. Любой клиент, поддерживающий MCP, запускает его так же:

```
command: node
args:    ["dist/index.js"]
env:     DISCORD_TOKEN=...
```

## Разработка

```bash
npm run dev        # tsc в watch-режиме
npm start          # запуск собранной версии
```

## Примеры промптов для Claude

- «Покажи список серверов»
- «Прочитай последние 20 сообщений в канале 123456789»
- «Отправь "привет" в канал 123456789»
- «Найди в канале 123456789 все упоминания слова "deploy"»
- «Открой личку с юзером 987654321 и отправь ему "тест"»

## Лицензия

MIT
