import Phaser from "phaser";
import { NetworkManager } from "../network/NetworkManager.js";
import { getItemCardInfo, getContractCardInfo } from "../data/cards.js";

const CARD_W = 160;
const CARD_H = 100;
const CARD_GAP = 20;
const CARD_Y = 300;
const CONTRACT_Y = 500;

export class TableScene extends Phaser.Scene {
  private network!: NetworkManager;
  private itemButtons: Phaser.GameObjects.Container[] = [];
  private contractContainer: Phaser.GameObjects.Container | null = null;
  private acceptBtn: Phaser.GameObjects.Container | null = null;
  private refuseBtn: Phaser.GameObjects.Container | null = null;
  private statusText!: Phaser.GameObjects.Text;
  private resolveText: Phaser.GameObjects.Text | null = null;
  private revealBanner: Phaser.GameObjects.Text | null = null;
  private phaseText!: Phaser.GameObjects.Text;
  private selectedItemId: string = "";
  private hasBuiltUI = false;

  constructor() {
    super({ key: "TableScene" });
  }

  create() {
    this.network = NetworkManager.getInstance();
    this.itemButtons = [];
    this.contractContainer = null;
    this.acceptBtn = null;
    this.refuseBtn = null;
    this.resolveText = null;
    this.revealBanner = null;
    this.selectedItemId = "";
    this.hasBuiltUI = false;

    // Title
    this.phaseText = this.add.text(600, 40, "", {
      fontSize: "28px", color: "#ffcc00",
    }).setOrigin(0.5);

    this.add.text(600, 80, "Choose your loadout", {
      fontSize: "16px", color: "#888888",
    }).setOrigin(0.5);

    // Status
    this.statusText = this.add.text(600, 700, "", {
      fontSize: "16px", color: "#aaaaaa",
    }).setOrigin(0.5);

    // Phase change listener
    this.network.onPhaseChange((phase) => {
      if (phase === "FIGHT") {
        this.scene.start("FightScene");
      } else if (phase === "END") {
        this.scene.start("EndScene");
      } else if (phase === "LOBBY") {
        this.scene.start("LobbyScene");
      }
    });
  }

  update() {
    const state = this.network.roomState;
    if (!state) return;

    const local = state.players.get(this.network.sessionId);
    if (!local) return;

    // Update phase title
    if (state.phase === "CARD") {
      this.phaseText.setText(`CARD PHASE — Round ${state.roundNumber}`);
    } else if (state.phase === "LOCK") {
      this.phaseText.setText(`LOCKED IN — Round ${state.roundNumber}`);
    } else if (state.phase === "RESOLVE") {
      this.phaseText.setText(`RESOLVE — Round ${state.roundNumber}`);
    }

    // Build item/contract UI once we have card data
    if (!this.hasBuiltUI && local.handItemCardIds.length > 0) {
      this.buildCardUI(local);
      this.hasBuiltUI = true;
    }

    // Update selection highlights
    this.updateHighlights(local);

    // Update status
    if (local.locked) {
      const itemInfo = getItemCardInfo(local.selectedItemId);
      const contractAccepted = local.acceptedContractId !== "";
      this.statusText.setText(
        `LOCKED — Item: ${itemInfo?.name ?? "None"} | Contract: ${contractAccepted ? "Accepted" : "Refused"}`
      );
      this.statusText.setColor("#00ff00");
    } else {
      const timer = (state.timerRemainingMs / 1000).toFixed(0);
      this.statusText.setText(`Time remaining: ${timer}s — Select item & accept/refuse contract`);
      this.statusText.setColor("#aaaaaa");
    }

    // Show resolve outcome
    if (state.phase === "RESOLVE" && !this.resolveText) {
      this.resolveText = this.add.text(600, 640, local.resolveOutcome || "No contract", {
        fontSize: "20px",
        color: local.resolveOutcome?.startsWith("SUCCESS") ? "#00ff00" : "#ff6666",
        fontStyle: "bold",
      }).setOrigin(0.5);
    }

    // Show reveal banner if cards are revealed
    if (local.revealCards && !this.revealBanner) {
      this.revealBanner = this.add.text(600, 130, "YOUR CARDS ARE VISIBLE TO ALL PLAYERS", {
        fontSize: "14px", color: "#ff4444", fontStyle: "bold",
        backgroundColor: "#330000", padding: { x: 12, y: 4 },
      }).setOrigin(0.5);
    }
  }

  // ── Build card UI ──────────────────────────────────────────

  private buildCardUI(local: { handItemCardIds: string[]; offeredContractId: string; contractForged: boolean; contractTargetName: string }) {
    const count = local.handItemCardIds.length;
    const totalWidth = count * CARD_W + (count - 1) * CARD_GAP;
    const startX = (1200 - totalWidth) / 2 + CARD_W / 2;

    // Item cards
    this.add.text(600, CARD_Y - 80, "ITEM CARDS (select one)", {
      fontSize: "14px", color: "#888888",
    }).setOrigin(0.5);

    local.handItemCardIds.forEach((itemId, i) => {
      const x = startX + i * (CARD_W + CARD_GAP);
      const info = getItemCardInfo(itemId);
      const container = this.createCardButton(
        x, CARD_Y, CARD_W, CARD_H,
        info?.name ?? itemId,
        info?.description ?? "",
        0x334455,
        () => this.onSelectItem(itemId)
      );
      this.itemButtons.push(container);
    });

    // Contract card
    const contractInfo = getContractCardInfo(local.offeredContractId);
    if (contractInfo) {
      this.add.text(600, CONTRACT_Y - 80, "CONTRACT", {
        fontSize: "14px", color: "#888888",
      }).setOrigin(0.5);

      const tierColor = contractInfo.tier === 3 ? 0x662222 : contractInfo.tier === 2 ? 0x555522 : 0x335533;
      let title = `[T${contractInfo.tier}] ${contractInfo.name}`;
      if (local.contractForged) title += " (FORGED)";

      let bodyText = contractInfo.actionText;
      if (local.contractTargetName) {
        bodyText += `\nTarget: ${local.contractTargetName}`;
      }
      bodyText += `\nReward: ${contractInfo.rewardText}`;
      bodyText += `\nPenalty: ${contractInfo.penaltyText}`;

      this.contractContainer = this.createCardButton(
        600, CONTRACT_Y, 360, 120,
        title, bodyText, tierColor,
        () => {} // no action on click
      );

      // Accept / Refuse buttons
      this.acceptBtn = this.createActionButton(480, CONTRACT_Y + 90, "ACCEPT", 0x225522, () => {
        this.network.sendAcceptContract();
      });

      if (!local.contractForged) {
        this.refuseBtn = this.createActionButton(720, CONTRACT_Y + 90, "REFUSE", 0x552222, () => {
          this.network.sendRefuseContract();
        });
      }
    }
  }

  private createCardButton(
    x: number, y: number, w: number, h: number,
    title: string, body: string, bgColor: number,
    onClick: () => void
  ): Phaser.GameObjects.Container {
    const bg = this.add.rectangle(0, 0, w, h, bgColor).setStrokeStyle(2, 0x666666);
    bg.setInteractive({ useHandCursor: true });
    bg.on("pointerdown", onClick);

    const titleText = this.add.text(0, -h / 2 + 14, title, {
      fontSize: "12px", color: "#ffffff", fontStyle: "bold",
      wordWrap: { width: w - 16 }, align: "center",
    }).setOrigin(0.5, 0);

    const bodyText = this.add.text(0, -h / 2 + 34, body, {
      fontSize: "10px", color: "#bbbbbb",
      wordWrap: { width: w - 16 }, align: "center",
    }).setOrigin(0.5, 0);

    const container = this.add.container(x, y, [bg, titleText, bodyText]);
    return container;
  }

  private createActionButton(
    x: number, y: number, label: string, bgColor: number,
    onClick: () => void
  ): Phaser.GameObjects.Container {
    const bg = this.add.rectangle(0, 0, 100, 36, bgColor).setStrokeStyle(2, 0x888888);
    bg.setInteractive({ useHandCursor: true });
    bg.on("pointerdown", onClick);

    const text = this.add.text(0, 0, label, {
      fontSize: "14px", color: "#ffffff", fontStyle: "bold",
    }).setOrigin(0.5);

    return this.add.container(x, y, [bg, text]);
  }

  private onSelectItem(itemId: string) {
    const local = this.network.roomState?.players.get(this.network.sessionId);
    if (!local || local.locked) return;
    this.selectedItemId = itemId;
    this.network.sendSelectItem(itemId);
  }

  // ── Highlight selected item ────────────────────────────────

  private updateHighlights(local: { selectedItemId: string; handItemCardIds: string[]; locked: boolean }) {
    const selectedId = local.selectedItemId || this.selectedItemId;

    this.itemButtons.forEach((container, i) => {
      const bg = container.getAt(0) as Phaser.GameObjects.Rectangle;
      const itemId = local.handItemCardIds[i];
      if (itemId === selectedId) {
        bg.setStrokeStyle(3, 0x00ff00);
      } else {
        bg.setStrokeStyle(2, 0x666666);
      }

      if (local.locked) {
        bg.setAlpha(itemId === selectedId ? 1 : 0.4);
      }
    });

    // Dim accept/refuse when locked
    if (local.locked) {
      this.acceptBtn?.setAlpha(0.4);
      this.refuseBtn?.setAlpha(0.4);
    }
  }
}
