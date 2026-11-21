// "Güncelleme" panel: check GitHub for a newer release, install it, wait for the restart.

import { api, ApiError } from "./api";
import { confirmDialog, errorMessage, h } from "./ui";

const RESTART_TIMEOUT_MS = 5 * 60_000;

export function createUpdatePanel(): HTMLElement {
  const status = h("div", { class: "update-status" });
  const checkButton = h("button", { type: "button", class: "btn", onclick: () => void check() }, "Güncellemeleri denetle");
  const panel = h(
    "div",
    { class: "update-panel" },
    h("p", { class: "muted" }, "Yeni sürümü internetten indirir ve programı yeniden başlatır. Veriler korunur."),
    checkButton,
    status,
  );

  function show(kind: "plain" | "error" | "success", ...content: (Node | string)[]) {
    status.className = kind === "plain" ? "update-status" : `update-status notice notice-${kind}`;
    status.replaceChildren(...content);
  }

  async function check() {
    checkButton.disabled = true;
    show("plain", "Denetleniyor…");
    try {
      const info = await api.checkUpdate();
      if (!info.available) {
        show("success", `Program güncel. Sürüm: ${info.current}`);
        return;
      }
      show(
        "plain",
        h("div", { class: "strong" }, `Yeni sürüm var: ${info.latest} (şu anki: ${info.current})`),
        info.notes ? h("pre", { class: "update-notes" }, info.notes) : "",
        h("button", { type: "button", class: "btn btn-primary", onclick: () => void install(info.latest) }, "Güncelle ve yeniden başlat"),
      );
    } catch (e) {
      show("error", errorMessage(e));
    } finally {
      checkButton.disabled = false;
    }
  }

  async function install(latest: string) {
    const ok = await confirmDialog(
      `Sürüm ${latest} indirilip kurulacak. Program birkaç saniye kapanıp yeniden açılacak. Yarım kalan sipariş kaybolmaz. Devam edilsin mi?`,
      "Güncelle",
      false,
    );
    if (!ok) return;
    checkButton.disabled = true;
    show("plain", "İndiriliyor ve doğrulanıyor… Bu işlem internet hızına göre birkaç dakika sürebilir.");
    try {
      let version = latest;
      try {
        version = (await api.installUpdate()).version;
      } catch (e) {
        // A lost connection (status 0) does not mean the update failed: wait for the new version.
        if (!(e instanceof ApiError && e.status === 0)) throw e;
      }
      show("plain", `Sürüm ${version} kuruluyor. Program yeniden başlıyor…`);
      await waitForVersion(version);
      location.reload();
    } catch (e) {
      show("error", errorMessage(e));
      checkButton.disabled = false;
    }
  }

  return panel;
}

/** Polls /api/health until the new version answers. */
async function waitForVersion(version: string) {
  const deadline = Date.now() + RESTART_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      if ((await api.health()).version === version) return;
    } catch {
      // the server is restarting: keep waiting
    }
  }
  throw new Error("Güncelleme bitmedi veya program yeniden başlamadı. Tezgah.exe'yi kapatıp yeniden açın.");
}
