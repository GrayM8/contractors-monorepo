import { Room, Client } from "@colyseus/core";
import { MatchState, Phase, PlayerState } from "../schema/MatchState.js";

const TOTAL_ROUNDS = 8;
const FIGHT_DURATION_MS = 120_000;
const TICK_RATE = 20; // Hz
const TICK_INTERVAL = 1000 / TICK_RATE;
const PLAYER_SPEED = 200; // pixels per second
const MAP_WIDTH = 1200;
const MAP_HEIGHT = 800;

interface InputMessage {
  moveX: number;   // -1, 0, or 1
  moveY: number;   // -1, 0, or 1
  aimAngle: number;
  shooting: boolean;
  seq: number;
}

export class MatchRoom extends Room<MatchState> {
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private phaseTimeout: ReturnType<typeof setTimeout> | null = null;

  onCreate() {
    this.setState(new MatchState());
    this.state.phase = Phase.LOBBY;
    this.state.roundNumber = 0;
    this.state.heat = 0;
    this.state.timerRemainingMs = 0;

    this.onMessage("input", (client, msg: InputMessage) => {
      this.handleInput(client, msg);
    });

    console.log("[MatchRoom] Created");
  }

  onJoin(client: Client, options: { name?: string }) {
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = options.name || `Player_${client.sessionId.slice(0, 4)}`;
    player.alive = true;
    player.role = "player";
    player.hp = 100;
    player.ammo = 30;
    player.x = MAP_WIDTH / 2 + (Math.random() - 0.5) * 200;
    player.y = MAP_HEIGHT / 2 + (Math.random() - 0.5) * 200;
    player.aim = 0;
    player.shooting = false;
    player.lastInputSeq = 0;

    this.state.players.set(client.sessionId, player);
    console.log(`[MatchRoom] ${player.name} joined (${client.sessionId})`);

    // Start the game when 2+ players are in the lobby
    if (this.state.phase === Phase.LOBBY && this.state.players.size >= 2) {
      this.startGame();
    }
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    console.log(`[MatchRoom] ${client.sessionId} left`);
  }

  onDispose() {
    this.clearTimers();
    console.log("[MatchRoom] Disposed");
  }

  // ── Game flow ──────────────────────────────────────────────

  private startGame() {
    console.log("[MatchRoom] Starting game");
    this.state.roundNumber = 1;
    this.transitionTo(Phase.CARD);
  }

  private transitionTo(phase: Phase) {
    this.clearTimers();
    this.state.phase = phase;
    console.log(`[MatchRoom] Phase -> ${phase} (round ${this.state.roundNumber})`);

    switch (phase) {
      case Phase.CARD:
        // Card selection phase – 5 seconds placeholder
        this.state.timerRemainingMs = 5000;
        this.phaseTimeout = setTimeout(() => this.transitionTo(Phase.LOCK), 5000);
        break;

      case Phase.LOCK:
        // Lock-in phase – 3 seconds placeholder
        this.state.timerRemainingMs = 3000;
        this.phaseTimeout = setTimeout(() => this.transitionTo(Phase.FIGHT), 3000);
        break;

      case Phase.FIGHT:
        this.startFight();
        break;

      case Phase.RESOLVE:
        // Resolve phase – 3 seconds, then next round or end
        this.state.timerRemainingMs = 3000;
        this.phaseTimeout = setTimeout(() => {
          if (this.state.roundNumber >= TOTAL_ROUNDS) {
            this.transitionTo(Phase.END);
          } else {
            this.state.roundNumber++;
            this.resetPlayersForRound();
            this.transitionTo(Phase.CARD);
          }
        }, 3000);
        break;

      case Phase.END:
        this.state.timerRemainingMs = 0;
        console.log("[MatchRoom] Game ended");
        break;
    }
  }

  private startFight() {
    this.state.timerRemainingMs = FIGHT_DURATION_MS;
    this.state.heat = 0;

    // Reset player positions for the fight
    this.state.players.forEach((player) => {
      if (player.role === "player") {
        player.alive = true;
        player.hp = 100;
        player.x = MAP_WIDTH / 2 + (Math.random() - 0.5) * 400;
        player.y = MAP_HEIGHT / 2 + (Math.random() - 0.5) * 400;
      }
    });

    // 20 Hz server tick
    this.tickInterval = setInterval(() => this.tick(), TICK_INTERVAL);
  }

  private tick() {
    const dt = TICK_INTERVAL / 1000; // seconds

    // Decrement timer
    this.state.timerRemainingMs -= TICK_INTERVAL;

    // Check end conditions
    const alivePlayers = Array.from(this.state.players.values()).filter(
      (p) => p.role === "player" && p.alive
    );

    if (this.state.timerRemainingMs <= 0 || alivePlayers.length <= 1) {
      this.state.timerRemainingMs = 0;
      this.transitionTo(Phase.RESOLVE);
      return;
    }

    // Apply movement for alive players
    this.state.players.forEach((player) => {
      if (!player.alive || player.role !== "player") return;

      // moveX/moveY are stored as the latest input direction
      const dx = player._moveX * PLAYER_SPEED * dt;
      const dy = player._moveY * PLAYER_SPEED * dt;

      player.x = Math.max(0, Math.min(MAP_WIDTH, player.x + dx));
      player.y = Math.max(0, Math.min(MAP_HEIGHT, player.y + dy));
    });

    // Increment heat slowly during fight
    this.state.heat = Math.min(100, this.state.heat + dt * 0.5);
  }

  // ── Input handling ─────────────────────────────────────────

  private handleInput(client: Client, msg: InputMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive || player.role !== "player") return;
    if (this.state.phase !== Phase.FIGHT) return;

    player._moveX = Math.max(-1, Math.min(1, msg.moveX));
    player._moveY = Math.max(-1, Math.min(1, msg.moveY));
    player.aim = msg.aimAngle;
    player.shooting = msg.shooting;
    player.lastInputSeq = msg.seq;
  }

  // ── Helpers ────────────────────────────────────────────────

  private resetPlayersForRound() {
    this.state.players.forEach((player) => {
      player.alive = true;
      player.hp = 100;
      player.ammo = 30;
      player.shooting = false;
    });
  }

  private clearTimers() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.phaseTimeout) {
      clearTimeout(this.phaseTimeout);
      this.phaseTimeout = null;
    }
  }
}
