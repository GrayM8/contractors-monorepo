import { Schema, type, MapSchema, filter } from "@colyseus/schema";

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

  // Non-synced fields for server-side movement tracking
  _moveX: number = 0;
  _moveY: number = 0;
}

export class MatchState extends Schema {
  @type("string")  phase: string = Phase.LOBBY;
  @type("number")  roundNumber: number = 0;
  @type("number")  heat: number = 0;
  @type("number")  timerRemainingMs: number = 0;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
