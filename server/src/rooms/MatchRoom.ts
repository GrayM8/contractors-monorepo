import { Room, Client } from "@colyseus/core";
import { MatchState, Phase, PlayerState, CopState } from "../schema/MatchState.js";

const TOTAL_ROUNDS = 8;
const FIGHT_DURATION_MS = 120_000;
const TICK_RATE = 20; // Hz
const TICK_INTERVAL = 1000 / TICK_RATE;
const PLAYER_SPEED = 200; // pixels per second
const MAP_WIDTH = 1200;
const MAP_HEIGHT = 800;

// Shooting
const FIRE_COOLDOWN_MS = 150;
const SHOT_DAMAGE = 10;
const SHOT_RANGE = 400;
const SHOT_HALF_ANGLE = 0.08; // ~4.5 degrees half-cone

// Cops
const COP_BASE_SPAWN_INTERVAL_MS = 5000; // base interval between spawns
const COP_MIN_SPAWN_INTERVAL_MS = 1000;
const COP_ARREST_RADIUS = 30;
const COP_HP = 50;
const COP_SPEED = 80;

interface InputMessage {
  moveX: number;
  moveY: number;
  aimAngle: number;
  shooting: boolean;
  seq: number;
}

export class MatchRoom extends Room<MatchState> {
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private phaseTimeout: ReturnType<typeof setTimeout> | null = null;
  private nextCopId = 0;
  private timeSinceLastCopSpawn = 0;

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
        this.state.timerRemainingMs = 5000;
        this.phaseTimeout = setTimeout(() => this.transitionTo(Phase.LOCK), 5000);
        break;

      case Phase.LOCK:
        this.state.timerRemainingMs = 3000;
        this.phaseTimeout = setTimeout(() => this.transitionTo(Phase.FIGHT), 3000);
        break;

      case Phase.FIGHT:
        this.startFight();
        break;

      case Phase.RESOLVE:
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
        this.clearCops();
        console.log("[MatchRoom] Game ended");
        break;
    }
  }

  private startFight() {
    this.state.timerRemainingMs = FIGHT_DURATION_MS;
    this.state.heat = 0;
    this.timeSinceLastCopSpawn = 0;
    this.clearCops();

    // Reset player positions for the fight
    this.state.players.forEach((player) => {
      if (player.role !== "spectator") {
        player.alive = true;
        player.role = "player";
        player.hp = 100;
        player.ammo = 30;
        player._moveX = 0;
        player._moveY = 0;
        player._lastFireTime = 0;
        player.shooting = false;
        player.x = MAP_WIDTH / 2 + (Math.random() - 0.5) * 400;
        player.y = MAP_HEIGHT / 2 + (Math.random() - 0.5) * 400;
      }
    });

    this.tickInterval = setInterval(() => this.tick(), TICK_INTERVAL);
  }

  // ── Main tick ──────────────────────────────────────────────

  private tick() {
    const dt = TICK_INTERVAL / 1000;
    const now = Date.now();

    // Decrement timer
    this.state.timerRemainingMs -= TICK_INTERVAL;

    // Increment heat
    this.state.heat = Math.min(100, this.state.heat + dt * 0.5);

    // Process player movement & shooting
    this.state.players.forEach((player) => {
      if (!player.alive || player.role !== "player") return;

      // Movement
      const dx = player._moveX * PLAYER_SPEED * dt;
      const dy = player._moveY * PLAYER_SPEED * dt;
      player.x = Math.max(0, Math.min(MAP_WIDTH, player.x + dx));
      player.y = Math.max(0, Math.min(MAP_HEIGHT, player.y + dy));

      // Hitscan shooting
      if (player.shooting && player.ammo > 0 && now - player._lastFireTime >= FIRE_COOLDOWN_MS) {
        player._lastFireTime = now;
        player.ammo--;
        this.processShot(player);
      }
    });

    // Cop AI
    this.tickCops(dt);

    // Spawn cops based on heat
    this.timeSinceLastCopSpawn += TICK_INTERVAL;
    const spawnInterval = Math.max(
      COP_MIN_SPAWN_INTERVAL_MS,
      COP_BASE_SPAWN_INTERVAL_MS - this.state.heat * 30
    );
    if (this.timeSinceLastCopSpawn >= spawnInterval) {
      this.timeSinceLastCopSpawn = 0;
      this.spawnCop();
    }

    // Check end conditions
    const alivePlayers = Array.from(this.state.players.values()).filter(
      (p) => p.role === "player" && p.alive
    );

    if (alivePlayers.length <= 1) {
      // Last player standing = traitor victory → end match immediately
      this.state.timerRemainingMs = 0;
      if (alivePlayers.length === 1) {
        console.log(`[MatchRoom] ${alivePlayers[0].name} is the last one standing!`);
      }
      this.transitionTo(Phase.END);
      return;
    }

    if (this.state.timerRemainingMs <= 0) {
      // Timer expired, survivors proceed to resolve
      this.state.timerRemainingMs = 0;
      this.transitionTo(Phase.RESOLVE);
      return;
    }
  }

  // ── Hitscan shooting ──────────────────────────────────────

  private processShot(shooter: PlayerState) {
    const aimCos = Math.cos(shooter.aim);
    const aimSin = Math.sin(shooter.aim);

    // Check against all other alive players
    this.state.players.forEach((target) => {
      if (target.id === shooter.id || !target.alive || target.role !== "player") return;

      const dx = target.x - shooter.x;
      const dy = target.y - shooter.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > SHOT_RANGE || dist < 1) return;

      // Check if target is within the shot cone
      const angleToTarget = Math.atan2(dy, dx);
      let angleDiff = angleToTarget - shooter.aim;
      // Normalize to [-PI, PI]
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      if (Math.abs(angleDiff) <= SHOT_HALF_ANGLE) {
        this.applyDamage(target, SHOT_DAMAGE);
      }
    });

    // Check against cops too
    this.state.cops.forEach((cop, copId) => {
      const dx = cop.x - shooter.x;
      const dy = cop.y - shooter.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > SHOT_RANGE || dist < 1) return;

      const angleToTarget = Math.atan2(dy, dx);
      let angleDiff = angleToTarget - shooter.aim;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      if (Math.abs(angleDiff) <= SHOT_HALF_ANGLE) {
        cop.hp -= SHOT_DAMAGE;
        if (cop.hp <= 0) {
          this.state.cops.delete(copId);
        }
      }
    });
  }

  private applyDamage(target: PlayerState, damage: number) {
    target.hp -= damage;
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.role = "spectator";
      target._moveX = 0;
      target._moveY = 0;
      target.shooting = false;
      console.log(`[MatchRoom] ${target.name} was killed`);
    }
  }

  // ── Cops AI ────────────────────────────────────────────────

  private spawnCop() {
    const cop = new CopState();
    cop.id = `cop_${this.nextCopId++}`;
    cop.hp = COP_HP;
    cop.speed = COP_SPEED;

    // Spawn at a random map edge
    const edge = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0: cop.x = 0;         cop.y = Math.random() * MAP_HEIGHT; break; // left
      case 1: cop.x = MAP_WIDTH;  cop.y = Math.random() * MAP_HEIGHT; break; // right
      case 2: cop.x = Math.random() * MAP_WIDTH; cop.y = 0;          break; // top
      case 3: cop.x = Math.random() * MAP_WIDTH; cop.y = MAP_HEIGHT;  break; // bottom
    }

    this.state.cops.set(cop.id, cop);
  }

  private tickCops(dt: number) {
    const alivePlayers = Array.from(this.state.players.values()).filter(
      (p) => p.role === "player" && p.alive
    );
    if (alivePlayers.length === 0) return;

    this.state.cops.forEach((cop, copId) => {
      // Find nearest alive player
      let nearest: PlayerState | null = null;
      let nearestDist = Infinity;
      for (const p of alivePlayers) {
        const dx = p.x - cop.x;
        const dy = p.y - cop.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = p;
        }
      }

      if (!nearest) return;

      // Move toward nearest player
      const dx = nearest.x - cop.x;
      const dy = nearest.y - cop.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 1) {
        cop.x += (dx / dist) * cop.speed * dt;
        cop.y += (dy / dist) * cop.speed * dt;
      }

      // Arrest check
      if (dist <= COP_ARREST_RADIUS) {
        nearest.alive = false;
        nearest.role = "spectator";
        nearest._moveX = 0;
        nearest._moveY = 0;
        nearest.shooting = false;
        console.log(`[MatchRoom] ${nearest.name} was arrested by ${copId}`);
      }
    });
  }

  private clearCops() {
    this.state.cops.forEach((_cop, id) => {
      this.state.cops.delete(id);
    });
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
      player.role = "player";
      player.hp = 100;
      player.ammo = 30;
      player.shooting = false;
      player._moveX = 0;
      player._moveY = 0;
      player._lastFireTime = 0;
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
