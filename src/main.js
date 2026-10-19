import "./style.css";
import { Game } from "./game.js";

function boot() {
  try {
    window.__chromaLine = new Game();
  } catch (error) {
    console.error("CHROMA / LINE failed to initialise:", error);
    const bootEl = document.querySelector("#boot");
    if (bootEl) {
      bootEl.innerHTML =
        '<span style="max-width:420px;text-align:center;line-height:2;letter-spacing:.16em">WEBGL COULD NOT START<br/>PLEASE ENABLE HARDWARE ACCELERATION AND RELOAD</span>';
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
