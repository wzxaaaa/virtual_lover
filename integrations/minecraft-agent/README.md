# Virtual Lover Minecraft Agent

This is the local Minecraft body for Virtual Lover. It follows the same bridge idea as `github_girl`'s `game_agent_minecraft`: the desktop app talks to this process over one WebSocket, while this process controls a second Minecraft account with mineflayer.

## Quick Start

1. Install Node.js 20+.
2. Copy `config.example.json` to `config.json`.
3. Open Minecraft Java, enter a single-player world, and choose **Open to LAN**.
4. Put the LAN port into `config.json` under `minecraft.port`.
5. Run `start-windows.cmd`, or run:

```bash
npm install
npm start
```

The bridge listens on `ws://127.0.0.1:48909` by default. Keep the terminal open while playing.

You can also open **Market -> MCP -> Minecraft Agent -> Configure** in Virtual Lover. The panel can generate `config.json`, save the LAN port / bot username / auth mode, show Node/npm/dependency diagnostics, keep the app WebSocket URL in sync with the starter bridge, install dependencies, start/stop the bundled starter, display recent startup logs, recognize `Local game hosted on port XXXXX`, turn common startup errors into repair hints, and confirm whether the bot account has actually joined the Minecraft world.

For a command-line join check, run this from the desktop app root while the starter is running:

```bash
npm run smoke:minecraft-agent:status
```

The smoke output includes `world_join`, live inventory, and the last known position/dimension when the agent reports them.

## Accounts

For LAN/offline testing, `auth: "offline"` and `username: "VirtualLoverBot"` are enough when your server accepts offline players.

For a real Microsoft account, set:

```json
{
  "minecraft": {
    "username": "bot@example.com",
    "auth": "microsoft"
  }
}
```

Mineflayer will open the Microsoft login flow in the terminal/browser.

## Supported Bridge Frames

Desktop app to agent:

- `task`: `{ "type": "task", "task": "...", "task_id": "uuid", "client": { ... } }`
- `query_inventory`: `{ "type": "query_inventory" }`
- `chat`: `{ "type": "chat", "text": "..." }`

Agent to desktop app:

- `agent_hello`
- `agent_status` with `worldJoin`
- `inventory`
- `chat`
- `log`
- `alert`
- `task_finished`

The agent echoes `task_id` on `task_finished`, and declares `virtual-lover-mc-agent/1` capabilities on connect.

## Current Task Coverage

This starter intentionally keeps the physical layer conservative:

- follow or regroup near the owner/nearest player
- stop current movement
- query inventory
- send in-game chat
- mine a few nearby logs or common ores
- attack nearby hostile mobs
- eat held/available food
- go near a named or nearest player

Long-term planning, screenshots, container locking, precise building, and robust crafting are still future layers. The desktop app already sends enough protocol metadata for those to be added without changing the bridge.
