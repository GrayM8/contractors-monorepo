import Phaser from "phaser";
import { NetworkManager } from "../network/NetworkManager.js";

export class EndScene extends Phaser.Scene {
  constructor() {
    super({ key: "EndScene" });
  }

  create() {
    const network = NetworkManager.getInstance();

    this.add
      .text(600, 350, "Game Over", {
        fontSize: "36px",
        color: "#ff4444",
      })
      .setOrigin(0.5);

    this.add
      .text(600, 420, `Final Round: ${network.roomState?.roundNumber ?? "?"}`, {
        fontSize: "18px",
        color: "#aaaaaa",
      })
      .setOrigin(0.5);

    network.onPhaseChange((phase) => {
      if (phase === "LOBBY") {
        this.scene.start("LobbyScene");
      }
    });
  }
}
