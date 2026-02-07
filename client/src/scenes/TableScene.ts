import Phaser from "phaser";
import { NetworkManager } from "../network/NetworkManager.js";

export class TableScene extends Phaser.Scene {
  private network!: NetworkManager;

  constructor() {
    super({ key: "TableScene" });
  }

  create() {
    this.network = NetworkManager.getInstance();

    this.add
      .text(600, 350, "Table Phase", {
        fontSize: "28px",
        color: "#ffcc00",
      })
      .setOrigin(0.5);

    const subText = this.add
      .text(600, 400, "", {
        fontSize: "18px",
        color: "#aaaaaa",
      })
      .setOrigin(0.5);

    this.network.onPhaseChange((phase) => {
      if (phase === "CARD") {
        subText.setText("Select your card...");
      } else if (phase === "LOCK") {
        subText.setText("Lock in!");
      } else if (phase === "FIGHT") {
        this.scene.start("FightScene");
      } else if (phase === "END") {
        this.scene.start("EndScene");
      } else if (phase === "LOBBY") {
        this.scene.start("LobbyScene");
      }
    });
  }
}
