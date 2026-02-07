import { Room, Client } from "@colyseus/core";
import { ArraySchema } from "@colyseus/schema";
import { MatchState, Phase, PlayerState, CopState } from "../schema/MatchState.js";
import {
  dealItemCards, pickRandomContract, getItemCard, getContractCard,
  type ContractCard,
} from "../data/cards.js";

const TOTAL_ROUNDS = 8;
const FIGHT_DURATION_MS = 120_000;
const CARD_PHASE_MS = 15_000;
const LOCK_PHASE_MS = 5_000;
const RESOLVE_PHASE_MS = 5_000;
const TICK_RATE = 20;
const TICK_INTERVAL = 1000 / TICK_RATE;
const BASE_PLAYER_SPEED = 200;
const MAP_WIDTH = 1200;
const MAP_HEIGHT = 800;
const BASE_HP = 100;
const BASE_AMMO = 30;

// Shooting
const FIRE_COOLDOWN_MS = 150;
const SHOT_DAMAGE = 10;
const SHOT_RANGE = 400;
const SHOT_HALF_ANGLE = 0.08;

// Cops
const COP_BASE_SPAWN_INTERVAL_MS = 5000;
const COP_MIN_SPAWN_INTERVAL_MS = 1000;
const COP_ARREST_RADIUS = 30;
const COP_HP = 50;
const COP_SPEED = 80;

// Player-controlled cop stats
const PLAYER_COP_HP = 30;
const PLAYER_COP_SPEED = 60;
const COP_ARREST_GRACE_MS = 5000; // no arrests in first 5s

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
  private fightElapsedMs = 0;

  onCreate() {
    this.setState(new MatchState());
    this.state.phase = Phase.LOBBY;
    this.state.roundNumber = 0;
    this.state.heat = 0;
    this.state.timerRemainingMs = 0;

    // ── Combat input ─────────────────────────────────────────
    this.onMessage("input", (client, msg: InputMessage) => {
      this.handleInput(client, msg);
    });

    // ── Card/contract messages ───────────────────────────────
    this.onMessage("loadout.selectItem", (client, msg: { itemId: string }) => {
      this.handleSelectItem(client, msg.itemId);
    });
    this.onMessage("loadout.acceptContract", (client) => {
      this.handleAcceptContract(client);
    });
    this.onMessage("contract.refuse", (client) => {
      this.handleRefuseContract(client);
    });

    // ── Cop spectator opt-in ─────────────────────────────────
    this.onMessage("spectator.optCop", (client) => {
      this.handleOptCop(client);
    });
    this.onMessage("cop.input", (client, msg: InputMessage) => {
      this.handleCopInput(client, msg);
    });
    this.onMessage("cop.arrest", (client) => {
      this.handleCopArrest(client);
    });

    // ── Trading messages ─────────────────────────────────────
    this.onMessage("trade.offer", (client, msg: { toSessionId: string; offeredItemCardId: string }) => {
      this.handleTradeOffer(client, msg.toSessionId, msg.offeredItemCardId);
    });
    this.onMessage("trade.respond", (client, msg: { fromSessionId: string; accept: boolean; requestedItemCardId?: string }) => {
      this.handleTradeRespond(client, msg.fromSessionId, msg.accept, msg.requestedItemCardId);
    });

    console.log("[MatchRoom] Created");
  }

  onJoin(client: Client, options: { name?: string }) {
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = options.name || `Player_${client.sessionId.slice(0, 4)}`;
    player.alive = true;
    player.role = "player";
    player.hp = BASE_HP;
    player.ammo = BASE_AMMO;
    player.x = MAP_WIDTH / 2 + (Math.random() - 0.5) * 200;
    player.y = MAP_HEIGHT / 2 + (Math.random() - 0.5) * 200;

    this.state.players.set(client.sessionId, player);
    console.log(`[MatchRoom] ${player.name} joined (${client.sessionId})`);

    if (this.state.phase === Phase.LOBBY && this.state.players.size >= 2) {
      this.startGame();
    }
  }

  onLeave(client: Client) {
    // Remove any cop they control
    const player = this.state.players.get(client.sessionId);
    if (player?.controlledCopId) {
      this.state.cops.delete(player.controlledCopId);
    }
    this.state.players.delete(client.sessionId);
    console.log(`[MatchRoom] ${client.sessionId} left`);
  }

  onDispose() {
    this.clearTimers();
    console.log("[MatchRoom] Disposed");
  }

  // ══════════════════════════════════════════════════════════
  //  GAME FLOW
  // ══════════════════════════════════════════════════════════

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
      case Phase.CARD:    this.beginCardPhase(); break;
      case Phase.LOCK:    this.beginLockPhase(); break;
      case Phase.FIGHT:   this.startFight(); break;
      case Phase.RESOLVE: this.beginResolvePhase(); break;
      case Phase.END:
        this.state.timerRemainingMs = 0;
        this.clearCops();
        console.log("[MatchRoom] Game ended");
        break;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  CARD PHASE
  // ══════════════════════════════════════════════════════════

  private beginCardPhase() {
    this.state.timerRemainingMs = CARD_PHASE_MS;

    this.state.players.forEach((player) => {
      // Clear previous round card state
      player.selectedItemId = "";
      player.acceptedContractId = "";
      player.offeredContractId = "";
      player.locked = false;
      player.contractActionText = "";
      player.contractTargetName = "";
      player.contractForged = false;
      player.resolveOutcome = "";
      player.tradedThisRound = false;
      player.pendingTradeFromId = "";
      player.pendingTradeOfferedItemId = "";
      player.controlledCopId = "";

      // Apply revealCards from previous round modifier
      player.revealCards = player._nextRevealCards;
      player._nextRevealCards = false;

      if (player.role === "spectator") return; // spectators get cop opt-in instead

      // Deal 4 random item cards
      const items = dealItemCards(4);
      player.handItemCardIds = new ArraySchema<string>(...items.map((i) => i.id));

      // Deal 1 contract based on round tier
      const contract = pickRandomContract(this.state.roundNumber);
      player.offeredContractId = contract.id;
      player.contractForged = contract.forged;

      // Assign target if needed
      if (contract.needsTarget) {
        const otherPlayers = Array.from(this.state.players.values()).filter(
          (p) => p.id !== player.id && p.role === "player"
        );
        if (otherPlayers.length > 0) {
          const target = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
          player._contractTargetId = target.id;
          player.contractTargetName = target.name;
        }
      } else {
        player._contractTargetId = "";
        player.contractTargetName = "";
      }
    });

    this.phaseTimeout = setTimeout(() => this.transitionTo(Phase.LOCK), CARD_PHASE_MS);
  }

  // ══════════════════════════════════════════════════════════
  //  LOCK PHASE
  // ══════════════════════════════════════════════════════════

  private beginLockPhase() {
    this.state.timerRemainingMs = LOCK_PHASE_MS;

    this.state.players.forEach((player) => {
      if (player.role === "spectator") return;

      if (!player.selectedItemId && player.handItemCardIds.length > 0) {
        player.selectedItemId = player.handItemCardIds.at(0) ?? "";
      }

      if (!player.locked) {
        if (player.contractForged && player.offeredContractId) {
          player.acceptedContractId = player.offeredContractId;
        }
      }

      player.locked = true;
      // Clear any pending trade
      player.pendingTradeFromId = "";
      player.pendingTradeOfferedItemId = "";
    });

    this.phaseTimeout = setTimeout(() => this.transitionTo(Phase.FIGHT), LOCK_PHASE_MS);
  }

  // ══════════════════════════════════════════════════════════
  //  CARD/CONTRACT MESSAGE HANDLERS
  // ══════════════════════════════════════════════════════════

  private handleSelectItem(client: Client, itemId: string) {
    if (this.state.phase !== Phase.CARD && this.state.phase !== Phase.LOCK) return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.role === "spectator" || player.locked) return;
    if (!player.handItemCardIds.includes(itemId)) return;
    player.selectedItemId = itemId;
  }

  private handleAcceptContract(client: Client) {
    if (this.state.phase !== Phase.CARD && this.state.phase !== Phase.LOCK) return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.role === "spectator" || player.locked) return;
    if (!player.offeredContractId) return;

    player.acceptedContractId = player.offeredContractId;
    player.locked = true;
    if (!player.selectedItemId && player.handItemCardIds.length > 0) {
      player.selectedItemId = player.handItemCardIds.at(0) ?? "";
    }
  }

  private handleRefuseContract(client: Client) {
    if (this.state.phase !== Phase.CARD && this.state.phase !== Phase.LOCK) return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.role === "spectator" || player.locked) return;
    if (player.contractForged) return;

    player.acceptedContractId = "";
    player.locked = true;
    if (!player.selectedItemId && player.handItemCardIds.length > 0) {
      player.selectedItemId = player.handItemCardIds.at(0) ?? "";
    }
  }

  // ══════════════════════════════════════════════════════════
  //  SPECTATOR COP OPT-IN
  // ══════════════════════════════════════════════════════════

  private handleOptCop(client: Client) {
    if (this.state.phase !== Phase.CARD && this.state.phase !== Phase.LOCK) return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.role !== "spectator") return;
    player.wantsCopNextFight = !player.wantsCopNextFight;
    console.log(`[MatchRoom] ${player.name} toggled cop opt-in: ${player.wantsCopNextFight}`);
  }

  private handleCopInput(client: Client, msg: InputMessage) {
    if (this.state.phase !== Phase.FIGHT) return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.role !== "cop" || !player.controlledCopId) return;

    const cop = this.state.cops.get(player.controlledCopId);
    if (!cop) return;

    // Store move direction on the player (we'll apply to cop in tick)
    player._moveX = Math.max(-1, Math.min(1, msg.moveX));
    player._moveY = Math.max(-1, Math.min(1, msg.moveY));
    player.aim = msg.aimAngle;
  }

  private handleCopArrest(client: Client) {
    if (this.state.phase !== Phase.FIGHT) return;
    if (this.fightElapsedMs < COP_ARREST_GRACE_MS) return; // grace period

    const player = this.state.players.get(client.sessionId);
    if (!player || player.role !== "cop" || !player.controlledCopId) return;

    const cop = this.state.cops.get(player.controlledCopId);
    if (!cop) return;

    // Find nearest alive player within arrest radius
    const alivePlayers = Array.from(this.state.players.values()).filter(
      (p) => p.role === "player" && p.alive
    );

    for (const target of alivePlayers) {
      const dx = target.x - cop.x;
      const dy = target.y - cop.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= COP_ARREST_RADIUS) {
        // Can't arrest same player twice per round
        if (player._copArrestedIds.has(target.id)) continue;

        player._copArrestedIds.add(target.id);
        target.alive = false;
        target.role = "spectator";
        target._moveX = 0;
        target._moveY = 0;
        target.shooting = false;
        console.log(`[MatchRoom] ${target.name} arrested by cop-player ${player.name}`);
        return; // one arrest per attempt
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  //  TRADING
  // ══════════════════════════════════════════════════════════

  private handleTradeOffer(client: Client, toSessionId: string, offeredItemCardId: string) {
    if (this.state.phase !== Phase.CARD) return;
    const from = this.state.players.get(client.sessionId);
    const to = this.state.players.get(toSessionId);
    if (!from || !to) return;
    if (from.role === "spectator" || to.role === "spectator") return;
    if (from.tradedThisRound || to.tradedThisRound) return;
    if (from.locked || to.locked) return;
    if (!from.handItemCardIds.includes(offeredItemCardId)) return;
    // Don't allow offering to yourself
    if (client.sessionId === toSessionId) return;
    // Clear any existing pending trade on target
    to.pendingTradeFromId = client.sessionId;
    to.pendingTradeOfferedItemId = offeredItemCardId;
    console.log(`[MatchRoom] ${from.name} offered ${offeredItemCardId} to ${to.name}`);
  }

  private handleTradeRespond(client: Client, fromSessionId: string, accept: boolean, requestedItemCardId?: string) {
    if (this.state.phase !== Phase.CARD) return;
    const to = this.state.players.get(client.sessionId);
    const from = this.state.players.get(fromSessionId);
    if (!to || !from) return;

    // Validate this is the pending trade
    if (to.pendingTradeFromId !== fromSessionId) return;
    if (to.tradedThisRound || from.tradedThisRound) return;
    if (to.locked || from.locked) return;

    const offeredItemId = to.pendingTradeOfferedItemId;

    // Clear pending regardless
    to.pendingTradeFromId = "";
    to.pendingTradeOfferedItemId = "";

    if (!accept || !requestedItemCardId) return;

    // Validate both items still in hands
    if (!from.handItemCardIds.includes(offeredItemId)) return;
    if (!to.handItemCardIds.includes(requestedItemCardId)) return;

    // Swap the cards
    const fromIdx = from.handItemCardIds.indexOf(offeredItemId);
    const toIdx = to.handItemCardIds.indexOf(requestedItemCardId);

    from.handItemCardIds[fromIdx] = requestedItemCardId;
    to.handItemCardIds[toIdx] = offeredItemId;

    // Clear selections if traded card was selected
    if (from.selectedItemId === offeredItemId) from.selectedItemId = "";
    if (to.selectedItemId === requestedItemCardId) to.selectedItemId = "";

    from.tradedThisRound = true;
    to.tradedThisRound = true;

    console.log(`[MatchRoom] Trade complete: ${from.name} gave ${offeredItemId}, got ${requestedItemCardId} from ${to.name}`);
  }

  // ══════════════════════════════════════════════════════════
  //  FIGHT PHASE
  // ══════════════════════════════════════════════════════════

  private startFight() {
    this.state.timerRemainingMs = FIGHT_DURATION_MS;
    this.state.heat = 0;
    this.timeSinceLastCopSpawn = 0;
    this.fightElapsedMs = 0;
    this.clearCops();

    this.state.players.forEach((player) => {
      // Spawn player-controlled cops for spectators who opted in
      if (player.role === "spectator" && player.wantsCopNextFight) {
        this.spawnPlayerCop(player);
        player.wantsCopNextFight = false;
        return;
      }

      if (player.role === "spectator") return;

      player.alive = true;
      player.role = "player";
      player._moveX = 0;
      player._moveY = 0;
      player._lastFireTime = 0;
      player.shooting = false;
      player.x = MAP_WIDTH / 2 + (Math.random() - 0.5) * 400;
      player.y = MAP_HEIGHT / 2 + (Math.random() - 0.5) * 400;

      // Reset combat metrics
      player._distanceMoved = 0;
      player._ammoSpent = 0;
      player._friendlyFireDamage = 0;
      player._enemyDamage = 0;
      player._kills = 0;
      player._killsByTargetId = new Map();
      player._damageByTargetId = new Map();

      // Apply next-round modifiers
      const hpMul = player._nextHpMul;
      const ammoMul = player._nextAmmoMul;
      const speedMul = player._nextSpeedMul;
      player._nextHpMul = 1;
      player._nextAmmoMul = 1;
      player._nextSpeedMul = 1;

      let hp = BASE_HP;
      let ammo = BASE_AMMO;
      let speedMultiplier = 1;

      const item = getItemCard(player.selectedItemId);
      if (item) {
        hp += item.hpBonus;
        ammo += item.ammoBonus;
        speedMultiplier *= item.speedMul;
      }

      hp = Math.round(hp * hpMul);
      ammo = Math.round(ammo * ammoMul);
      speedMultiplier *= speedMul;

      player.hp = Math.max(1, hp);
      player.ammo = Math.max(0, ammo);
      player._speedMul = speedMultiplier;

      // Set contract action text
      if (player.acceptedContractId) {
        const contract = getContractCard(player.acceptedContractId);
        if (contract) {
          let text = contract.actionText;
          if (contract.needsTarget && player.contractTargetName) {
            text += ` (Target: ${player.contractTargetName})`;
          }
          player.contractActionText = text;
        }
      } else {
        player.contractActionText = "";
      }
    });

    this.tickInterval = setInterval(() => this.tick(), TICK_INTERVAL);
  }

  private spawnPlayerCop(player: PlayerState) {
    const cop = new CopState();
    cop.id = `pcop_${this.nextCopId++}`;
    cop.hp = PLAYER_COP_HP;
    cop.speed = PLAYER_COP_SPEED;
    cop.controllerId = player.id;

    // Spawn at random edge
    const edge = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0: cop.x = 0;         cop.y = Math.random() * MAP_HEIGHT; break;
      case 1: cop.x = MAP_WIDTH;  cop.y = Math.random() * MAP_HEIGHT; break;
      case 2: cop.x = Math.random() * MAP_WIDTH; cop.y = 0;          break;
      case 3: cop.x = Math.random() * MAP_WIDTH; cop.y = MAP_HEIGHT;  break;
    }

    this.state.cops.set(cop.id, cop);
    player.role = "cop";
    player.controlledCopId = cop.id;
    player._copArrestedIds = new Set();
    player._moveX = 0;
    player._moveY = 0;
    console.log(`[MatchRoom] ${player.name} spawned as player-cop: ${cop.id}`);
  }

  // ══════════════════════════════════════════════════════════
  //  MAIN TICK
  // ══════════════════════════════════════════════════════════

  private tick() {
    const dt = TICK_INTERVAL / 1000;
    const now = Date.now();

    this.state.timerRemainingMs -= TICK_INTERVAL;
    this.fightElapsedMs += TICK_INTERVAL;
    this.state.heat = Math.min(100, this.state.heat + dt * 0.5);

    // Process players
    this.state.players.forEach((player) => {
      if (!player.alive || player.role !== "player") return;

      const speed = BASE_PLAYER_SPEED * player._speedMul;
      const dx = player._moveX * speed * dt;
      const dy = player._moveY * speed * dt;
      const oldX = player.x;
      const oldY = player.y;
      player.x = Math.max(0, Math.min(MAP_WIDTH, player.x + dx));
      player.y = Math.max(0, Math.min(MAP_HEIGHT, player.y + dy));

      const movedX = player.x - oldX;
      const movedY = player.y - oldY;
      player._distanceMoved += Math.sqrt(movedX * movedX + movedY * movedY);

      if (player.shooting && player.ammo > 0 && now - player._lastFireTime >= FIRE_COOLDOWN_MS) {
        player._lastFireTime = now;
        player.ammo--;
        player._ammoSpent++;
        this.processShot(player);
      }
    });

    // Process player-controlled cops (movement only, arrest is manual via message)
    this.state.players.forEach((player) => {
      if (player.role !== "cop" || !player.controlledCopId) return;
      const cop = this.state.cops.get(player.controlledCopId);
      if (!cop) return;

      const dx = player._moveX * cop.speed * dt;
      const dy = player._moveY * cop.speed * dt;
      cop.x = Math.max(0, Math.min(MAP_WIDTH, cop.x + dx));
      cop.y = Math.max(0, Math.min(MAP_HEIGHT, cop.y + dy));
    });

    // AI cops
    this.tickCops(dt);

    // Cop spawning
    this.timeSinceLastCopSpawn += TICK_INTERVAL;
    const spawnInterval = Math.max(
      COP_MIN_SPAWN_INTERVAL_MS,
      COP_BASE_SPAWN_INTERVAL_MS - this.state.heat * 30
    );
    if (this.timeSinceLastCopSpawn >= spawnInterval) {
      this.timeSinceLastCopSpawn = 0;
      this.spawnCop();
    }

    // End conditions
    const alivePlayers = Array.from(this.state.players.values()).filter(
      (p) => p.role === "player" && p.alive
    );

    if (alivePlayers.length <= 1) {
      this.state.timerRemainingMs = 0;
      if (alivePlayers.length === 1) {
        console.log(`[MatchRoom] ${alivePlayers[0].name} is the last one standing!`);
      }
      this.transitionTo(Phase.END);
      return;
    }

    if (this.state.timerRemainingMs <= 0) {
      this.state.timerRemainingMs = 0;
      this.transitionTo(Phase.RESOLVE);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  RESOLVE PHASE
  // ══════════════════════════════════════════════════════════

  private beginResolvePhase() {
    this.state.timerRemainingMs = RESOLVE_PHASE_MS;
    this.clearCops();

    // Revert cop-role players to spectators
    this.state.players.forEach((player) => {
      if (player.role === "cop") {
        player.role = "spectator";
        player.controlledCopId = "";
      }
    });

    // Evaluate contracts
    this.state.players.forEach((player) => {
      if (player.role === "spectator" && !player.acceptedContractId) {
        player.resolveOutcome = "";
        return;
      }
      if (!player.acceptedContractId) {
        player.resolveOutcome = "No contract";
        return;
      }

      const contract = getContractCard(player.acceptedContractId);
      if (!contract) {
        player.resolveOutcome = "Invalid contract";
        return;
      }

      const success = this.evaluateContract(player, contract);

      if (success) {
        this.applyReward(player, contract);
        player.resolveOutcome = `SUCCESS: ${contract.name} — ${this.rewardText(contract)}`;
      } else {
        this.applyPenalty(player, contract);
        player.resolveOutcome = `FAILED: ${contract.name} — ${this.penaltyText(contract)}`;
      }

      console.log(`[MatchRoom] ${player.name}: ${player.resolveOutcome}`);
    });

    this.phaseTimeout = setTimeout(() => {
      if (this.state.roundNumber >= TOTAL_ROUNDS) {
        this.transitionTo(Phase.END);
      } else {
        this.state.roundNumber++;
        this.resetPlayersForRound();
        this.transitionTo(Phase.CARD);
      }
    }, RESOLVE_PHASE_MS);
  }

  private evaluateContract(player: PlayerState, contract: ContractCard): boolean {
    switch (contract.conditionType) {
      case "MOVE_DISTANCE":     return player._distanceMoved >= contract.threshold;
      case "ENEMY_DAMAGE_ZERO": return player._enemyDamage === 0;
      case "AMMO_SPENT":        return player._ammoSpent >= contract.threshold;
      case "FRIENDLY_FIRE":     return player._friendlyFireDamage >= contract.threshold;
      case "DAMAGE_TARGET":     return (player._damageByTargetId.get(player._contractTargetId) ?? 0) >= contract.threshold;
      case "KILL_TEAMMATE":     return player._kills >= 1;
      case "KILL_TARGET":       return (player._killsByTargetId.get(player._contractTargetId) ?? 0) >= 1;
      default:                  return false;
    }
  }

  private applyReward(player: PlayerState, contract: ContractCard) {
    switch (contract.rewardType) {
      case "HP_BOOST":    player._nextHpMul = 1 + contract.rewardValue; break;
      case "AMMO_BOOST":  player._nextAmmoMul = 1 + contract.rewardValue; break;
      case "SPEED_BOOST": player._nextSpeedMul = 1 + contract.rewardValue; break;
    }
  }

  private applyPenalty(player: PlayerState, contract: ContractCard) {
    switch (contract.penaltyType) {
      case "AMMO_CUT":       player._nextAmmoMul = 1 - contract.penaltyValue; break;
      case "REVEAL_CARDS":   player._nextRevealCards = true; break;
      case "SLOT_REDUCTION": player._nextAmmoMul = 0.8; break;
    }
  }

  private rewardText(c: ContractCard): string {
    switch (c.rewardType) {
      case "HP_BOOST":    return `+${Math.round(c.rewardValue * 100)}% HP next round`;
      case "AMMO_BOOST":  return `+${Math.round(c.rewardValue * 100)}% ammo next round`;
      case "SPEED_BOOST": return `+${Math.round(c.rewardValue * 100)}% speed next round`;
    }
  }

  private penaltyText(c: ContractCard): string {
    switch (c.penaltyType) {
      case "AMMO_CUT":       return `-${Math.round(c.penaltyValue * 100)}% ammo next round`;
      case "REVEAL_CARDS":   return "Cards revealed next round";
      case "SLOT_REDUCTION": return "-20% ammo next round";
    }
  }

  // ══════════════════════════════════════════════════════════
  //  HITSCAN SHOOTING
  // ══════════════════════════════════════════════════════════

  private processShot(shooter: PlayerState) {
    this.state.players.forEach((target) => {
      if (target.id === shooter.id || !target.alive || target.role !== "player") return;

      const dx = target.x - shooter.x;
      const dy = target.y - shooter.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > SHOT_RANGE || dist < 1) return;

      let angleDiff = Math.atan2(dy, dx) - shooter.aim;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      if (Math.abs(angleDiff) <= SHOT_HALF_ANGLE) {
        shooter._enemyDamage += SHOT_DAMAGE;
        shooter._friendlyFireDamage += SHOT_DAMAGE;
        shooter._damageByTargetId.set(target.id, (shooter._damageByTargetId.get(target.id) ?? 0) + SHOT_DAMAGE);

        const wasAlive = target.alive;
        this.applyDamage(target, SHOT_DAMAGE);

        if (wasAlive && !target.alive) {
          shooter._kills++;
          shooter._killsByTargetId.set(target.id, (shooter._killsByTargetId.get(target.id) ?? 0) + 1);
        }
      }
    });

    // Cops
    this.state.cops.forEach((cop, copId) => {
      const dx = cop.x - shooter.x;
      const dy = cop.y - shooter.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > SHOT_RANGE || dist < 1) return;

      let angleDiff = Math.atan2(dy, dx) - shooter.aim;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      if (Math.abs(angleDiff) <= SHOT_HALF_ANGLE) {
        cop.hp -= SHOT_DAMAGE;
        if (cop.hp <= 0) {
          // If player-controlled cop dies, revert controller to spectator
          if (cop.controllerId) {
            const ctrl = this.state.players.get(cop.controllerId);
            if (ctrl) {
              ctrl.role = "spectator";
              ctrl.controlledCopId = "";
            }
          }
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

  // ══════════════════════════════════════════════════════════
  //  COPS AI (only for AI cops, skip player-controlled)
  // ══════════════════════════════════════════════════════════

  private spawnCop() {
    const cop = new CopState();
    cop.id = `cop_${this.nextCopId++}`;
    cop.hp = COP_HP;
    cop.speed = COP_SPEED;
    cop.controllerId = "";

    const edge = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0: cop.x = 0;         cop.y = Math.random() * MAP_HEIGHT; break;
      case 1: cop.x = MAP_WIDTH;  cop.y = Math.random() * MAP_HEIGHT; break;
      case 2: cop.x = Math.random() * MAP_WIDTH; cop.y = 0;          break;
      case 3: cop.x = Math.random() * MAP_WIDTH; cop.y = MAP_HEIGHT;  break;
    }

    this.state.cops.set(cop.id, cop);
  }

  private tickCops(dt: number) {
    const alivePlayers = Array.from(this.state.players.values()).filter(
      (p) => p.role === "player" && p.alive
    );
    if (alivePlayers.length === 0) return;

    this.state.cops.forEach((cop, copId) => {
      if (cop.controllerId) return; // skip player-controlled cops

      let nearest: PlayerState | null = null;
      let nearestDist = Infinity;
      for (const p of alivePlayers) {
        const dx = p.x - cop.x;
        const dy = p.y - cop.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < nearestDist) { nearestDist = d; nearest = p; }
      }
      if (!nearest) return;

      const dx = nearest.x - cop.x;
      const dy = nearest.y - cop.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 1) {
        cop.x += (dx / dist) * cop.speed * dt;
        cop.y += (dy / dist) * cop.speed * dt;
      }

      if (dist <= COP_ARREST_RADIUS) {
        nearest.alive = false;
        nearest.role = "spectator";
        nearest._moveX = 0;
        nearest._moveY = 0;
        nearest.shooting = false;
        console.log(`[MatchRoom] ${nearest.name} arrested by AI cop ${copId}`);
      }
    });
  }

  private clearCops() {
    const ids = Array.from(this.state.cops.keys());
    for (const id of ids) this.state.cops.delete(id);

    // Revert any cop-role players
    this.state.players.forEach((player) => {
      if (player.role === "cop") {
        player.role = "spectator";
        player.controlledCopId = "";
      }
    });
  }

  // ══════════════════════════════════════════════════════════
  //  INPUT HANDLING
  // ══════════════════════════════════════════════════════════

  private handleInput(client: Client, msg: InputMessage) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (this.state.phase !== Phase.FIGHT) return;

    // Route cop inputs to cop.input handler instead
    if (player.role === "cop") return;

    if (!player.alive || player.role !== "player") return;

    player._moveX = Math.max(-1, Math.min(1, msg.moveX));
    player._moveY = Math.max(-1, Math.min(1, msg.moveY));
    player.aim = msg.aimAngle;
    player.shooting = msg.shooting;
    player.lastInputSeq = msg.seq;
  }

  // ══════════════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════════════

  private resetPlayersForRound() {
    this.state.players.forEach((player) => {
      player.alive = true;
      player.role = "player";
      player.hp = BASE_HP;
      player.ammo = BASE_AMMO;
      player.shooting = false;
      player._moveX = 0;
      player._moveY = 0;
      player._lastFireTime = 0;
      player._speedMul = 1;
      player.controlledCopId = "";
      player.wantsCopNextFight = false;
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
