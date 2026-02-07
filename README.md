# Contractors on the Run!

Multiplayer top-down game built with **Colyseus** (server) and **Phaser 3** (client) in a **pnpm workspaces** monorepo.

## How to Run

```bash
# Install dependencies
pnpm install

# Start server + client concurrently
pnpm dev
```

- **Server** runs at `http://localhost:3000` (Colyseus WebSocket)
- **Client** runs at `http://localhost:5173` (Vite dev server)

Open two browser tabs to `http://localhost:5173` — the game starts when 2 players join.

### Individual commands

```bash
pnpm dev:server   # server only
pnpm dev:client   # client only
pnpm build        # production build both
```

## Project Structure

```
├── client/             # Vite + Phaser 3 client
│   └── src/
│       ├── main.ts
│       ├── network/    # Colyseus client connection
│       └── scenes/     # Phaser scenes (Lobby, Table, Fight, End)
├── server/             # Node + Colyseus server
│   └── src/
│       ├── index.ts
│       ├── rooms/      # MatchRoom game logic
│       └── schema/     # Colyseus state schema
├── pnpm-workspace.yaml
├── tsconfig.base.json  # Shared TS config
└── package.json        # Root scripts
```

## Game Flow

8 rounds of: **CARD** → **LOCK** → **FIGHT** (120s, 20Hz tick) → **RESOLVE**

During FIGHT, use **WASD** to move and **mouse** to aim. Left-click to shoot (stubbed).
