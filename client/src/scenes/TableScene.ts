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

  // Cop opt-in UI
  private copOptBtn: Phaser.GameObjects.Container | null = null;
  private copOptLabel: Phaser.GameObjects.Text | null = null;

  // Trade UI
  private tradeButtons: Phaser.GameObjects.Container[] = [];
  private tradeTargetPanel: Phaser.GameObjects.Container | null = null;
  private tradeIncomingPanel: Phaser.GameObjects.Container | null = null;
  private tradingItemId: string = "";
  private tradeCardButtons: Phaser.GameObjects.Container[] = [];

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
    this.copOptBtn = null;
    this.copOptLabel = null;
    this.tradeButtons = [];
    this.tradeTargetPanel = null;
    this.tradeIncomingPanel = null;
    this.tradingItemId = "";
    this.tradeCardButtons = [];

    // Title
    this.phaseText = this.add.text(600, 40, "", {
      fontSize: "28px", color: "#ffcc00",
    }).setOrigin(0.5);

    this.add.text(600, 80, "Choose your loadout", {
      fontSize: "16px", color: "#888888",
    }).setOrigin(0.5);

    // Status
    this.statusText = this.add.text(600, 750, "", {
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

    // Spectator cop opt-in UI
    if (local.role === "spectator" && (state.phase === "CARD" || state.phase === "LOCK")) {
      this.showCopOptIn(local);
    }

    // Build item/contract UI once we have card data (non-spectators)
    if (!this.hasBuiltUI && local.handItemCardIds.length > 0 && local.role !== "spectator") {
      this.buildCardUI(local);
      this.hasBuiltUI = true;
    }

    // Update selection highlights
    if (this.hasBuiltUI) {
      this.updateHighlights(local);
    }

    // Update status
    if (local.role === "spectator") {
      if (local.wantsCopNextFight) {
        this.statusText.setText("You will play as a COP next fight!");
        this.statusText.setColor("#4488ff");
      } else {
        this.statusText.setText("You are spectating. Opt in as a cop for the next fight.");
        this.statusText.setColor("#888888");
      }
    } else if (local.locked) {
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

    // Incoming trade modal
    this.updateIncomingTrade(local, state);
  }

  // ── Cop opt-in UI ─────────────────────────────────────────

  private showCopOptIn(local: { wantsCopNextFight: boolean }) {
    if (this.copOptBtn) {
      // Update label
      if (this.copOptLabel) {
        this.copOptLabel.setText(local.wantsCopNextFight ? "CANCEL COP" : "OPT IN AS COP");
      }
      const bg = this.copOptBtn.getAt(0) as Phaser.GameObjects.Rectangle;
      bg.setFillStyle(local.wantsCopNextFight ? 0x553322 : 0x224488);
      return;
    }

    const bg = this.add.rectangle(0, 0, 200, 50, 0x224488).setStrokeStyle(2, 0x6688cc);
    bg.setInteractive({ useHandCursor: true });
    bg.on("pointerdown", () => {
      this.network.sendOptCop();
    });

    this.copOptLabel = this.add.text(0, 0, "OPT IN AS COP", {
      fontSize: "16px", color: "#ffffff", fontStyle: "bold",
    }).setOrigin(0.5);

    this.copOptBtn = this.add.container(600, 400, [bg, this.copOptLabel]);
  }

  // ── Build card UI ──────────────────────────────────────────

  private buildCardUI(local: { handItemCardIds: string[]; offeredContractId: string; contractForged: boolean; contractTargetName: string }) {
    const count = local.handItemCardIds.length;
    const totalWidth = count * CARD_W + (count - 1) * CARD_GAP;
    const startX = (1200 - totalWidth) / 2 + CARD_W / 2;

    // Item cards
    this.add.text(600, CARD_Y - 80, "ITEM CARDS (select one — click TRADE to offer)", {
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

      // Trade button under each card
      const tradeBtn = this.createActionButton(x, CARD_Y + CARD_H / 2 + 24, "TRADE", 0x443355, () => {
        this.onStartTrade(itemId);
      });
      this.tradeButtons.push(tradeBtn);
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

  // ── Trading ──────────────────────────────────────────────

  private onStartTrade(itemId: string) {
    const local = this.network.roomState?.players.get(this.network.sessionId);
    if (!local || local.locked || local.tradedThisRound) return;
    if (this.network.roomState?.phase !== "CARD") return;

    this.tradingItemId = itemId;
    this.showTradeTargetPicker();
  }

  private showTradeTargetPicker() {
    this.closeTradeTargetPicker();

    const state = this.network.roomState;
    if (!state) return;

    const otherPlayers: { sessionId: string; name: string }[] = [];
    state.players.forEach((p, sid) => {
      if (sid !== this.network.sessionId && p.role !== "spectator" && !p.tradedThisRound && !p.locked) {
        otherPlayers.push({ sessionId: sid, name: p.name });
      }
    });

    if (otherPlayers.length === 0) return;

    const children: Phaser.GameObjects.GameObject[] = [];

    // Background
    const panelH = 60 + otherPlayers.length * 40;
    const panelBg = this.add.rectangle(0, 0, 240, panelH, 0x222233, 0.95).setStrokeStyle(2, 0x6666aa);
    children.push(panelBg);

    const titleText = this.add.text(0, -panelH / 2 + 16, "Send trade to:", {
      fontSize: "14px", color: "#cccccc", fontStyle: "bold",
    }).setOrigin(0.5, 0);
    children.push(titleText);

    otherPlayers.forEach((p, i) => {
      const btnY = -panelH / 2 + 50 + i * 40;
      const bg = this.add.rectangle(0, btnY, 200, 30, 0x335544).setStrokeStyle(1, 0x669966);
      bg.setInteractive({ useHandCursor: true });
      bg.on("pointerdown", () => {
        this.network.sendTradeOffer(p.sessionId, this.tradingItemId);
        this.closeTradeTargetPicker();
      });
      children.push(bg);

      const txt = this.add.text(0, btnY, p.name, {
        fontSize: "12px", color: "#ffffff",
      }).setOrigin(0.5);
      children.push(txt);
    });

    // Close button
    const closeBtn = this.add.text(100, -panelH / 2 + 4, "X", {
      fontSize: "14px", color: "#ff4444", fontStyle: "bold",
    }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    closeBtn.on("pointerdown", () => this.closeTradeTargetPicker());
    children.push(closeBtn);

    this.tradeTargetPanel = this.add.container(600, 400, children).setDepth(100);
  }

  private closeTradeTargetPicker() {
    if (this.tradeTargetPanel) {
      this.tradeTargetPanel.destroy();
      this.tradeTargetPanel = null;
    }
  }

  // ── Incoming trade modal ──────────────────────────────────

  private updateIncomingTrade(
    local: { pendingTradeFromId: string; pendingTradeOfferedItemId: string; tradedThisRound: boolean; locked: boolean; handItemCardIds: string[] },
    state: { phase: string; players: Map<string, { name: string }> }
  ) {
    if (local.pendingTradeFromId && !local.tradedThisRound && !local.locked && state.phase === "CARD") {
      if (!this.tradeIncomingPanel) {
        this.showIncomingTradeModal(local, state);
      }
    } else {
      this.closeIncomingTrade();
    }
  }

  private showIncomingTradeModal(
    local: { pendingTradeFromId: string; pendingTradeOfferedItemId: string; handItemCardIds: string[] },
    state: { players: Map<string, { name: string }> }
  ) {
    const fromPlayer = state.players.get(local.pendingTradeFromId);
    const offeredInfo = getItemCardInfo(local.pendingTradeOfferedItemId);

    const children: Phaser.GameObjects.GameObject[] = [];
    const cardCount = local.handItemCardIds.length;
    const panelH = 140 + cardCount * 36;

    const panelBg = this.add.rectangle(0, 0, 300, panelH, 0x222233, 0.95).setStrokeStyle(2, 0xaaaa44);
    children.push(panelBg);

    const titleText = this.add.text(0, -panelH / 2 + 14, "INCOMING TRADE", {
      fontSize: "16px", color: "#ffcc00", fontStyle: "bold",
    }).setOrigin(0.5, 0);
    children.push(titleText);

    const offerText = this.add.text(0, -panelH / 2 + 38, `${fromPlayer?.name ?? "?"} offers: ${offeredInfo?.name ?? local.pendingTradeOfferedItemId}`, {
      fontSize: "12px", color: "#cccccc", wordWrap: { width: 270 }, align: "center",
    }).setOrigin(0.5, 0);
    children.push(offerText);

    const pickText = this.add.text(0, -panelH / 2 + 64, "Select a card to trade back:", {
      fontSize: "11px", color: "#999999",
    }).setOrigin(0.5, 0);
    children.push(pickText);

    // Show local cards as trade-back options
    this.tradeCardButtons = [];
    local.handItemCardIds.forEach((cardId, i) => {
      const btnY = -panelH / 2 + 90 + i * 36;
      const info = getItemCardInfo(cardId);
      const bg = this.add.rectangle(0, btnY, 260, 28, 0x334455).setStrokeStyle(1, 0x668899);
      bg.setInteractive({ useHandCursor: true });
      bg.on("pointerdown", () => {
        this.network.sendTradeRespond(local.pendingTradeFromId, true, cardId);
        this.closeIncomingTrade();
      });
      children.push(bg);

      const txt = this.add.text(0, btnY, info?.name ?? cardId, {
        fontSize: "11px", color: "#ffffff",
      }).setOrigin(0.5);
      children.push(txt);
    });

    // Decline button
    const declineY = -panelH / 2 + 90 + cardCount * 36 + 10;
    const declineBg = this.add.rectangle(0, declineY, 120, 30, 0x552222).setStrokeStyle(1, 0x884444);
    declineBg.setInteractive({ useHandCursor: true });
    declineBg.on("pointerdown", () => {
      this.network.sendTradeRespond(local.pendingTradeFromId, false);
      this.closeIncomingTrade();
    });
    children.push(declineBg);

    const declineText = this.add.text(0, declineY, "DECLINE", {
      fontSize: "12px", color: "#ff6666", fontStyle: "bold",
    }).setOrigin(0.5);
    children.push(declineText);

    this.tradeIncomingPanel = this.add.container(600, 400, children).setDepth(100);
  }

  private closeIncomingTrade() {
    if (this.tradeIncomingPanel) {
      this.tradeIncomingPanel.destroy();
      this.tradeIncomingPanel = null;
      this.tradeCardButtons = [];
    }
  }

  // ── Highlight selected item ────────────────────────────────

  private updateHighlights(local: { selectedItemId: string; handItemCardIds: string[]; locked: boolean; tradedThisRound: boolean }) {
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

    // Dim trade buttons when locked or already traded
    this.tradeButtons.forEach((btn) => {
      btn.setAlpha(local.locked || local.tradedThisRound ? 0.3 : 1);
    });

    // Dim accept/refuse when locked
    if (local.locked) {
      this.acceptBtn?.setAlpha(0.4);
      this.refuseBtn?.setAlpha(0.4);
    }
  }
}
