import { Client, Room } from "colyseus.js";

export interface RoomState {
  phase: string;
  roundNumber: number;
  heat: number;
  timerRemainingMs: number;
  players: Map<string, PlayerData>;
  cops: Map<string, CopData>;
}

export interface PlayerData {
  id: string;
  name: string;
  alive: boolean;
  role: string;
  hp: number;
  ammo: number;
  x: number;
  y: number;
  aim: number;
  shooting: boolean;
  lastInputSeq: number;
}

export interface CopData {
  id: string;
  x: number;
  y: number;
  hp: number;
  speed: number;
}

type PhaseChangeCallback = (phase: string) => void;

export class NetworkManager {
  private static instance: NetworkManager;
  private client: Client;
  private room: Room | null = null;

  public roomState: RoomState | null = null;
  public sessionId: string = "";

  private phaseCallbacks: PhaseChangeCallback[] = [];

  private constructor() {
    this.client = new Client("ws://localhost:3000");
  }

  static getInstance(): NetworkManager {
    if (!NetworkManager.instance) {
      NetworkManager.instance = new NetworkManager();
    }
    return NetworkManager.instance;
  }

  onPhaseChange(cb: PhaseChangeCallback) {
    this.phaseCallbacks.push(cb);
  }

  async connect() {
    try {
      this.room = await this.client.joinOrCreate("match", {
        name: `Player_${Math.random().toString(36).slice(2, 6)}`,
      });
      this.sessionId = this.room.sessionId;
      console.log("[Network] Joined room", this.room.id);

      this.roomState = {
        phase: "LOBBY",
        roundNumber: 0,
        heat: 0,
        timerRemainingMs: 0,
        players: new Map(),
        cops: new Map(),
      };

      // Scalar state listeners
      this.room.state.listen("phase", (value: string) => {
        if (this.roomState) this.roomState.phase = value;
        this.phaseCallbacks.forEach((cb) => cb(value));
      });
      this.room.state.listen("roundNumber", (value: number) => {
        if (this.roomState) this.roomState.roundNumber = value;
      });
      this.room.state.listen("heat", (value: number) => {
        if (this.roomState) this.roomState.heat = value;
      });
      this.room.state.listen("timerRemainingMs", (value: number) => {
        if (this.roomState) this.roomState.timerRemainingMs = value;
      });

      // Player map
      this.room.state.players.onAdd((player: any, key: string) => {
        const pd: PlayerData = {
          id: player.id,
          name: player.name,
          alive: player.alive,
          role: player.role,
          hp: player.hp,
          ammo: player.ammo,
          x: player.x,
          y: player.y,
          aim: player.aim,
          shooting: player.shooting,
          lastInputSeq: player.lastInputSeq,
        };
        this.roomState!.players.set(key, pd);

        player.listen("x", (val: number) => { pd.x = val; });
        player.listen("y", (val: number) => { pd.y = val; });
        player.listen("aim", (val: number) => { pd.aim = val; });
        player.listen("hp", (val: number) => { pd.hp = val; });
        player.listen("ammo", (val: number) => { pd.ammo = val; });
        player.listen("alive", (val: boolean) => { pd.alive = val; });
        player.listen("shooting", (val: boolean) => { pd.shooting = val; });
        player.listen("role", (val: string) => { pd.role = val; });
        player.listen("lastInputSeq", (val: number) => { pd.lastInputSeq = val; });
      });

      this.room.state.players.onRemove((_player: any, key: string) => {
        this.roomState!.players.delete(key);
      });

      // Cops map
      this.room.state.cops.onAdd((cop: any, key: string) => {
        const cd: CopData = {
          id: cop.id,
          x: cop.x,
          y: cop.y,
          hp: cop.hp,
          speed: cop.speed,
        };
        this.roomState!.cops.set(key, cd);

        cop.listen("x", (val: number) => { cd.x = val; });
        cop.listen("y", (val: number) => { cd.y = val; });
        cop.listen("hp", (val: number) => { cd.hp = val; });
      });

      this.room.state.cops.onRemove((_cop: any, key: string) => {
        this.roomState!.cops.delete(key);
      });
    } catch (err) {
      console.error("[Network] Failed to connect:", err);
    }
  }

  sendInput(input: {
    moveX: number;
    moveY: number;
    aimAngle: number;
    shooting: boolean;
    seq: number;
  }) {
    this.room?.send("input", input);
  }

  getRoom(): Room | null {
    return this.room;
  }
}
