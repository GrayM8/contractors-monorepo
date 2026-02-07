import Phaser from "phaser";
import { LobbyScene } from "./scenes/LobbyScene.js";
import { TableScene } from "./scenes/TableScene.js";
import { FightScene } from "./scenes/FightScene.js";
import { EndScene } from "./scenes/EndScene.js";
import { NetworkManager } from "./network/NetworkManager.js";

// Connect to server
const network = NetworkManager.getInstance();
network.connect();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-container",
  width: 1200,
  height: 800,
  backgroundColor: "#1a1a2e",
  scene: [LobbyScene, TableScene, FightScene, EndScene],
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
});

// Store network reference on the game registry for scenes to access
game.registry.set("network", network);

// HUD update loop
function updateHUD() {
  const state = network.roomState;
  const phaseEl = document.getElementById("hud-phase");
  const roundEl = document.getElementById("hud-round");
  const heatEl = document.getElementById("hud-heat");
  const timerEl = document.getElementById("hud-timer");

  const ammoEl = document.getElementById("hud-ammo");
  const hpEl = document.getElementById("hud-hp");

  if (state) {
    if (phaseEl) phaseEl.textContent = state.phase;
    if (roundEl) roundEl.textContent = String(state.roundNumber);
    if (heatEl) heatEl.textContent = String(Math.round(state.heat));
    if (timerEl) timerEl.textContent = (state.timerRemainingMs / 1000).toFixed(1) + "s";

    const contractRowEl = document.getElementById("hud-contract-row");
    const contractEl = document.getElementById("hud-contract");

    const local = state.players.get(network.sessionId);
    if (local) {
      if (ammoEl) ammoEl.textContent = String(local.ammo);
      if (hpEl) hpEl.textContent = String(local.hp);

      // Show contract action text during FIGHT
      if (local.contractActionText && state.phase === "FIGHT") {
        if (contractRowEl) contractRowEl.style.display = "block";
        if (contractEl) contractEl.textContent = local.contractActionText;
      } else {
        if (contractRowEl) contractRowEl.style.display = "none";
      }
    }
  }
  requestAnimationFrame(updateHUD);
}
updateHUD();
