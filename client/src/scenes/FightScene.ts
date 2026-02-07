import Phaser from "phaser";
import { NetworkManager } from "../network/NetworkManager.js";

const INPUT_SEND_RATE = 1000 / 30; // 30 Hz

export class FightScene extends Phaser.Scene {
  private network!: NetworkManager;
  private keys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private playerGraphics = new Map<string, Phaser.GameObjects.Arc>();
  private aimLines = new Map<string, Phaser.GameObjects.Line>();
  private inputSeq = 0;
  private lastInputTime = 0;

  constructor() {
    super({ key: "FightScene" });
  }

  create() {
    this.network = NetworkManager.getInstance();
    this.playerGraphics.clear();
    this.aimLines.clear();
    this.inputSeq = 0;
    this.lastInputTime = 0;

    // Draw arena border
    const border = this.add.rectangle(600, 400, 1200, 800);
    border.setStrokeStyle(2, 0x444444);

    // Setup keyboard
    this.keys = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    // Phase change listener
    this.network.onPhaseChange((phase) => {
      if (phase === "RESOLVE" || phase === "CARD" || phase === "LOCK") {
        this.scene.start("TableScene");
      } else if (phase === "END") {
        this.scene.start("EndScene");
      } else if (phase === "LOBBY") {
        this.scene.start("LobbyScene");
      }
    });
  }

  update(time: number, _delta: number) {
    const state = this.network.roomState;
    if (!state) return;

    // Send input at 30 Hz
    if (time - this.lastInputTime >= INPUT_SEND_RATE) {
      this.lastInputTime = time;
      this.sendInput();
    }

    // Render players
    this.renderPlayers(state);
  }

  private sendInput() {
    const moveX = (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0);
    const moveY = (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0);

    const pointer = this.input.activePointer;
    const aimAngle = Math.atan2(
      pointer.worldY - (this.network.roomState?.players.get(this.network.sessionId)?.y ?? 400),
      pointer.worldX - (this.network.roomState?.players.get(this.network.sessionId)?.x ?? 600)
    );

    const shooting = pointer.isDown;

    this.inputSeq++;
    this.network.sendInput({
      moveX,
      moveY,
      aimAngle,
      shooting,
      seq: this.inputSeq,
    });
  }

  private renderPlayers(state: { players: Map<string, any> }) {
    const seenIds = new Set<string>();

    state.players.forEach((player, id) => {
      seenIds.add(id);

      // Player circle
      let circle = this.playerGraphics.get(id);
      if (!circle) {
        const isLocal = id === this.network.sessionId;
        circle = this.add.circle(player.x, player.y, 16, isLocal ? 0x00ff00 : 0xff4444);
        if (isLocal) {
          circle.setStrokeStyle(3, 0xffffff);
        }
        this.playerGraphics.set(id, circle);
      }

      circle.setPosition(player.x, player.y);
      circle.setAlpha(player.alive ? 1 : 0.3);

      // Aim line
      let aimLine = this.aimLines.get(id);
      const lineLen = 30;
      const endX = player.x + Math.cos(player.aim) * lineLen;
      const endY = player.y + Math.sin(player.aim) * lineLen;

      if (!aimLine) {
        aimLine = this.add.line(0, 0, player.x, player.y, endX, endY, 0xffffff, 0.6);
        aimLine.setOrigin(0, 0);
        this.aimLines.set(id, aimLine);
      } else {
        aimLine.setTo(player.x, player.y, endX, endY);
      }
    });

    // Remove graphics for players that left
    for (const [id, gfx] of this.playerGraphics) {
      if (!seenIds.has(id)) {
        gfx.destroy();
        this.playerGraphics.delete(id);
        this.aimLines.get(id)?.destroy();
        this.aimLines.delete(id);
      }
    }
  }
}
