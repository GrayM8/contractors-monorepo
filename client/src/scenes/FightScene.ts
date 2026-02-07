import Phaser from "phaser";
import { NetworkManager, PlayerData, CopData } from "../network/NetworkManager.js";

const INPUT_SEND_RATE = 1000 / 30; // 30 Hz
const PLAYER_RADIUS = 16;
const COP_RADIUS = 14;
const HP_BAR_WIDTH = 36;
const HP_BAR_HEIGHT = 4;
const HP_BAR_OFFSET_Y = -24;

export class FightScene extends Phaser.Scene {
  private network!: NetworkManager;
  private keys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

  // Player visuals
  private playerCircles = new Map<string, Phaser.GameObjects.Arc>();
  private aimLines = new Map<string, Phaser.GameObjects.Line>();
  private hpBarBgs = new Map<string, Phaser.GameObjects.Rectangle>();
  private hpBarFills = new Map<string, Phaser.GameObjects.Rectangle>();
  private nameTexts = new Map<string, Phaser.GameObjects.Text>();

  // Cop visuals
  private copCircles = new Map<string, Phaser.GameObjects.Arc>();

  // Death overlay
  private deathOverlay: Phaser.GameObjects.Rectangle | null = null;
  private deathText: Phaser.GameObjects.Text | null = null;
  private spectateText: Phaser.GameObjects.Text | null = null;

  // Cop mode overlay
  private copModeText: Phaser.GameObjects.Text | null = null;
  private copArrestText: Phaser.GameObjects.Text | null = null;

  private inputSeq = 0;
  private lastInputTime = 0;

  constructor() {
    super({ key: "FightScene" });
  }

  create() {
    this.network = NetworkManager.getInstance();
    this.clearAllVisuals();
    this.inputSeq = 0;
    this.lastInputTime = 0;

    // Arena border
    this.add.rectangle(600, 400, 1200, 800).setStrokeStyle(2, 0x444444);

    // Keyboard
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

    const localPlayer = state.players.get(this.network.sessionId);
    if (!localPlayer) return;

    const isCop = localPlayer.role === "cop";
    const isAlive = localPlayer.alive;
    const isSpectator = localPlayer.role === "spectator";

    // Send inputs if alive player or cop
    if ((isAlive || isCop) && time - this.lastInputTime >= INPUT_SEND_RATE) {
      this.lastInputTime = time;
      if (isCop) {
        this.sendCopInput(localPlayer);
      } else {
        this.sendInput();
      }
    }

    // Handle cop arrest on click
    if (isCop && this.input.activePointer.isDown) {
      this.network.sendCopArrest();
    }

    this.renderPlayers(state.players);
    this.renderCops(state.cops, localPlayer);

    if (isCop) {
      this.updateCopOverlay();
      // Hide death overlay if showing
      this.clearDeathOverlay();
    } else if (!isAlive || isSpectator) {
      this.updateDeathOverlay(state.players);
      this.clearCopOverlay();
    } else {
      this.clearDeathOverlay();
      this.clearCopOverlay();
    }
  }

  // ── Input ──────────────────────────────────────────────────

  private sendInput() {
    const localPlayer = this.network.roomState?.players.get(this.network.sessionId);
    const moveX = (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0);
    const moveY = (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0);

    const pointer = this.input.activePointer;
    const px = localPlayer?.x ?? 600;
    const py = localPlayer?.y ?? 400;
    const aimAngle = Math.atan2(pointer.worldY - py, pointer.worldX - px);

    this.inputSeq++;
    this.network.sendInput({
      moveX,
      moveY,
      aimAngle,
      shooting: pointer.isDown,
      seq: this.inputSeq,
    });
  }

  private sendCopInput(localPlayer: PlayerData) {
    const moveX = (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0);
    const moveY = (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0);

    // Aim from the controlled cop's position
    const cop = this.network.roomState?.cops.get(localPlayer.controlledCopId);
    const cx = cop?.x ?? 600;
    const cy = cop?.y ?? 400;
    const pointer = this.input.activePointer;
    const aimAngle = Math.atan2(pointer.worldY - cy, pointer.worldX - cx);

    this.inputSeq++;
    this.network.sendCopInput({
      moveX,
      moveY,
      aimAngle,
      shooting: false,
      seq: this.inputSeq,
    });
  }

  // ── Player rendering ───────────────────────────────────────

  private renderPlayers(players: Map<string, PlayerData>) {
    const seenIds = new Set<string>();

    players.forEach((player, id) => {
      // Don't render cop-role players as player circles
      if (player.role === "cop") return;

      seenIds.add(id);
      const isLocal = id === this.network.sessionId;

      // Circle
      let circle = this.playerCircles.get(id);
      if (!circle) {
        circle = this.add.circle(player.x, player.y, PLAYER_RADIUS, isLocal ? 0x00ff00 : 0xff4444);
        if (isLocal) circle.setStrokeStyle(3, 0xffffff);
        circle.setDepth(10);
        this.playerCircles.set(id, circle);
      }
      circle.setPosition(player.x, player.y);
      circle.setAlpha(player.alive ? 1 : 0.2);

      // Aim line (only for alive players)
      let aimLine = this.aimLines.get(id);
      if (player.alive) {
        const lineLen = 30;
        const endX = player.x + Math.cos(player.aim) * lineLen;
        const endY = player.y + Math.sin(player.aim) * lineLen;
        if (!aimLine) {
          aimLine = this.add.line(0, 0, player.x, player.y, endX, endY, 0xffffff, 0.6);
          aimLine.setOrigin(0, 0).setDepth(11);
          this.aimLines.set(id, aimLine);
        } else {
          aimLine.setTo(player.x, player.y, endX, endY);
          aimLine.setAlpha(0.6);
        }
      } else if (aimLine) {
        aimLine.setAlpha(0);
      }

      // HP bar background
      let hpBg = this.hpBarBgs.get(id);
      if (!hpBg) {
        hpBg = this.add.rectangle(player.x, player.y + HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x333333);
        hpBg.setDepth(12);
        this.hpBarBgs.set(id, hpBg);
      }
      hpBg.setPosition(player.x, player.y + HP_BAR_OFFSET_Y);
      hpBg.setAlpha(player.alive ? 1 : 0);

      // HP bar fill
      let hpFill = this.hpBarFills.get(id);
      const hpRatio = Math.max(0, player.hp / 100);
      const fillWidth = HP_BAR_WIDTH * hpRatio;
      const fillColor = hpRatio > 0.5 ? 0x00ff00 : hpRatio > 0.25 ? 0xffaa00 : 0xff0000;
      if (!hpFill) {
        hpFill = this.add.rectangle(player.x, player.y + HP_BAR_OFFSET_Y, fillWidth, HP_BAR_HEIGHT, fillColor);
        hpFill.setDepth(13);
        this.hpBarFills.set(id, hpFill);
      }
      hpFill.setSize(fillWidth, HP_BAR_HEIGHT);
      hpFill.setPosition(
        player.x - (HP_BAR_WIDTH - fillWidth) / 2,
        player.y + HP_BAR_OFFSET_Y
      );
      hpFill.setFillStyle(fillColor);
      hpFill.setAlpha(player.alive ? 1 : 0);

      // Name text
      let nameText = this.nameTexts.get(id);
      if (!nameText) {
        nameText = this.add.text(player.x, player.y + HP_BAR_OFFSET_Y - 10, player.name, {
          fontSize: "10px",
          color: "#cccccc",
        }).setOrigin(0.5).setDepth(12);
        this.nameTexts.set(id, nameText);
      }
      nameText.setPosition(player.x, player.y + HP_BAR_OFFSET_Y - 10);
      nameText.setAlpha(player.alive ? 0.8 : 0.3);
    });

    // Cleanup removed players
    for (const [id] of this.playerCircles) {
      if (!seenIds.has(id)) this.removePlayerVisuals(id);
    }
  }

  private removePlayerVisuals(id: string) {
    this.playerCircles.get(id)?.destroy();
    this.playerCircles.delete(id);
    this.aimLines.get(id)?.destroy();
    this.aimLines.delete(id);
    this.hpBarBgs.get(id)?.destroy();
    this.hpBarBgs.delete(id);
    this.hpBarFills.get(id)?.destroy();
    this.hpBarFills.delete(id);
    this.nameTexts.get(id)?.destroy();
    this.nameTexts.delete(id);
  }

  // ── Cop rendering ──────────────────────────────────────────

  private renderCops(cops: Map<string, CopData>, localPlayer: PlayerData) {
    const seenIds = new Set<string>();

    cops.forEach((cop, id) => {
      seenIds.add(id);

      const isControlled = localPlayer.role === "cop" && localPlayer.controlledCopId === id;

      let circle = this.copCircles.get(id);
      if (!circle) {
        circle = this.add.circle(cop.x, cop.y, COP_RADIUS, isControlled ? 0x44aaff : 0x4444ff);
        circle.setStrokeStyle(isControlled ? 3 : 2, isControlled ? 0xffffff : 0x8888ff);
        circle.setDepth(10);
        this.copCircles.set(id, circle);
      }
      circle.setPosition(cop.x, cop.y);

      // Update color in case controllerId changed
      if (isControlled) {
        circle.setFillStyle(0x44aaff);
        circle.setStrokeStyle(3, 0xffffff);
      } else if (cop.controllerId) {
        // Player-controlled cop (other player)
        circle.setFillStyle(0x6644cc);
        circle.setStrokeStyle(2, 0x9988ff);
      } else {
        circle.setFillStyle(0x4444ff);
        circle.setStrokeStyle(2, 0x8888ff);
      }
    });

    // Cleanup removed cops
    for (const [id, gfx] of this.copCircles) {
      if (!seenIds.has(id)) {
        gfx.destroy();
        this.copCircles.delete(id);
      }
    }
  }

  // ── Cop mode overlay ─────────────────────────────────────

  private updateCopOverlay() {
    if (!this.copModeText) {
      this.copModeText = this.add.text(600, 40, "COP MODE", {
        fontSize: "24px", color: "#44aaff", fontStyle: "bold",
        backgroundColor: "#001133", padding: { x: 16, y: 6 },
      }).setOrigin(0.5).setDepth(51);

      this.copArrestText = this.add.text(600, 72, "WASD to move | LMB to arrest nearby player", {
        fontSize: "12px", color: "#8888cc",
      }).setOrigin(0.5).setDepth(51);
    }
  }

  private clearCopOverlay() {
    if (this.copModeText) {
      this.copModeText.destroy();
      this.copModeText = null;
    }
    if (this.copArrestText) {
      this.copArrestText.destroy();
      this.copArrestText = null;
    }
  }

  // ── Death overlay & spectate ───────────────────────────────

  private updateDeathOverlay(players: Map<string, PlayerData>) {
    if (!this.deathOverlay) {
      this.deathOverlay = this.add.rectangle(600, 400, 1200, 800, 0x000000, 0.4);
      this.deathOverlay.setDepth(50);

      this.deathText = this.add.text(600, 80, "YOU ARE DEAD", {
        fontSize: "36px",
        color: "#ff4444",
        fontStyle: "bold",
      }).setOrigin(0.5).setDepth(51);

      this.spectateText = this.add.text(600, 120, "Spectating...", {
        fontSize: "16px",
        color: "#aaaaaa",
      }).setOrigin(0.5).setDepth(51);
    }

    // Spectate: follow nearest alive player
    let nearestAlive: PlayerData | null = null;
    let nearestDist = Infinity;
    const localPlayer = players.get(this.network.sessionId);
    const myX = localPlayer?.x ?? 600;
    const myY = localPlayer?.y ?? 400;

    players.forEach((p) => {
      if (!p.alive || p.id === this.network.sessionId) return;
      const dx = p.x - myX;
      const dy = p.y - myY;
      const d = dx * dx + dy * dy;
      if (d < nearestDist) {
        nearestDist = d;
        nearestAlive = p;
      }
    });

    if (nearestAlive && this.spectateText) {
      this.spectateText.setText(`Spectating: ${(nearestAlive as PlayerData).name}`);
    }
  }

  private clearDeathOverlay() {
    if (this.deathOverlay) {
      this.deathOverlay.destroy();
      this.deathOverlay = null;
      this.deathText?.destroy();
      this.deathText = null;
      this.spectateText?.destroy();
      this.spectateText = null;
    }
  }

  // ── Cleanup ────────────────────────────────────────────────

  private clearAllVisuals() {
    for (const [id] of this.playerCircles) this.removePlayerVisuals(id);
    for (const [, gfx] of this.copCircles) gfx.destroy();
    this.copCircles.clear();
    this.clearDeathOverlay();
    this.clearCopOverlay();
  }
}
