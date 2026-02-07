import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export enum Phase {
  LOBBY   = "LOBBY",
  CARD    = "CARD",
  LOCK    = "LOCK",
  FIGHT   = "FIGHT",
  RESOLVE = "RESOLVE",
  END     = "END",
}

export class PlayerState extends Schema {
  @type("string")  id: string = "";
  @type("string")  name: string = "";
  @type("boolean") alive: boolean = true;
  @type("string")  role: string = "player"; // "player" | "spectator" | "cop"
  @type("number")  hp: number = 100;
  @type("number")  ammo: number = 30;
  @type("number")  x: number = 0;
  @type("number")  y: number = 0;
  @type("number")  aim: number = 0;
  @type("boolean") shooting: boolean = false;
  @type("number")  lastInputSeq: number = 0;

  // ── Card/contract state (synced) ───────────────────────────
  @type(["string"]) handItemCardIds = new ArraySchema<string>();
  @type("string")   offeredContractId: string = "";
  @type("string")   selectedItemId: string = "";
  @type("string")   acceptedContractId: string = "";
  @type("boolean")  locked: boolean = false;
  @type("string")   contractActionText: string = "";
  @type("boolean")  revealCards: boolean = false;
  @type("string")   contractTargetName: string = "";
  @type("boolean")  contractForged: boolean = false;
  @type("string")   resolveOutcome: string = "";

  // ── Cop-spectator fields (synced) ──────────────────────────
  @type("boolean")  wantsCopNextFight: boolean = false;
  @type("string")   controlledCopId: string = "";  // id of the cop this player controls

  // ── Trading fields (synced) ────────────────────────────────
  @type("boolean")  tradedThisRound: boolean = false;
  @type("string")   pendingTradeFromId: string = "";       // sessionId of offerer
  @type("string")   pendingTradeOfferedItemId: string = ""; // item being offered to us

  // ── Non-synced server-side fields ──────────────────────────
  _moveX: number = 0;
  _moveY: number = 0;
  _lastFireTime: number = 0;

  // Per-round combat metrics
  _distanceMoved: number = 0;
  _ammoSpent: number = 0;
  _friendlyFireDamage: number = 0;
  _enemyDamage: number = 0;
  _kills: number = 0;
  _killsByTargetId: Map<string, number> = new Map();
  _damageByTargetId: Map<string, number> = new Map();

  // Contract assigned target
  _contractTargetId: string = "";

  // Next-round modifiers
  _nextHpMul: number = 1;
  _nextAmmoMul: number = 1;
  _nextSpeedMul: number = 1;
  _nextRevealCards: boolean = false;

  // Current round effective speed multiplier
  _speedMul: number = 1;

  // Cop arrest tracking (server-only): set of player IDs already arrested this round
  _copArrestedIds: Set<string> = new Set();
}

export class CopState extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hp: number = 50;
  @type("number") speed: number = 80;
  @type("string") controllerId: string = ""; // sessionId of controlling player, "" = AI
}

export class MatchState extends Schema {
  @type("string")  phase: string = Phase.LOBBY;
  @type("number")  roundNumber: number = 0;
  @type("number")  heat: number = 0;
  @type("number")  timerRemainingMs: number = 0;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: CopState })    cops    = new MapSchema<CopState>();
}
