import Phaser from "phaser";
import { NetworkManager } from "../network/NetworkManager.js";

export class LobbyScene extends Phaser.Scene {
  private network!: NetworkManager;

  constructor() {
    super({ key: "LobbyScene" });
  }

  create() {
    this.network = NetworkManager.getInstance();

    this.add
      .text(600, 350, "Contractors on the Run!", {
        fontSize: "32px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this.add
      .text(600, 420, "Waiting for players...", {
        fontSize: "18px",
        color: "#aaaaaa",
      })
      .setOrigin(0.5);

    // Listen for phase changes to switch scenes
    this.network.onPhaseChange((phase) => {
      if (phase === "CARD" || phase === "LOCK") {
        this.scene.start("TableScene");
      } else if (phase === "FIGHT") {
        this.scene.start("FightScene");
      } else if (phase === "END") {
        this.scene.start("EndScene");
      }
    });
  }
}
