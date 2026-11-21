// Keeps a WebSocket open to the server. The server counts these connections as open Tezgah
// windows and stops when the last one closes (see src/server/desktop.ts).

const RETRY_MS = 2000;
/** A restart after an update takes a few seconds. Show the banner only after a longer loss. */
const BANNER_AFTER_MS = 15_000;

export function stayConnected(): void {
  let lostAt: number | null = null;
  let banner: HTMLElement | null = null;

  function connect() {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`);
    ws.onopen = () => {
      lostAt = null;
      banner?.remove();
      banner = null;
    };
    ws.onclose = () => {
      lostAt ??= Date.now();
      if (!banner && Date.now() - lostAt >= BANNER_AFTER_MS) {
        banner = document.createElement("div");
        banner.className = "offline-banner no-print";
        banner.setAttribute("role", "alert");
        banner.textContent = "Tezgah programı kapandı. Bu pencereyi kapatın ve Tezgah'ı yeniden açın.";
        document.body.append(banner);
      }
      setTimeout(connect, RETRY_MS);
    };
  }
  connect();
}
