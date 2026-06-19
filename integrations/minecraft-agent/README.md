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

After the status check says the bot is in the world, run one low-risk action replay:

```bash
npm run smoke:minecraft-agent:safe
```

This sends `stop and wait safely`, waits for `task_finished`, then prints the latest inventory/status summary. In the app, the same flow is **Market -> MCP -> Minecraft Agent -> Configure -> Safe replay**.

If a `follow me` task does not move the bot, first check whether the bot can actually see you. Set `behavior.owner` (or the app's **Owner** field) to your exact Minecraft username, then bring the bot into your loaded area. With cheats enabled in the LAN world, the fastest first-time fix is:

```text
/tp VirtualLoverBot <your Minecraft name>
```

When Mineflayer can see the live player entity, `follow me` uses pathfinder `GoalFollow`. Some LAN/offline worlds expose the owner in the in-game player list but do not expose a named player entity to Mineflayer. Use the `debug_entities` bridge frame to inspect raw nearby entities; if the owner appears as an unnamed entity, put its id in `behavior.ownerEntityId` or the app's **Owner Entity ID** field. The starter will then treat that entity as the owner and follow it without repeated teleports.

If no player entity or owner entity id is available, `follow me` starts a conservative command-follow fallback: the bot sends `/tp <bot> <owner>` every `behavior.commandFollowIntervalMs` milliseconds until the player entity becomes visible or you tell it to stop.

Resource tasks such as chopping trees work in Minecraft 1.15.1. If the bot is in creative mode, blocks can be dug but no item drops are created; switch the bot/world to survival when you want inventory collection.

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
- sleep in a nearby bed when Minecraft allows sleeping
- attack nearby hostile mobs
- eat held/available food
- go near a named or nearest player

Long-term planning, screenshots, container locking, precise building, and robust crafting are still future layers. The desktop app already sends enough protocol metadata for those to be added without changing the bridge.
