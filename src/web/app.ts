// App shell: loads settings, builds the screens and switches tabs by URL hash.

import { api } from "./api";
import { createLabelsScreen } from "./screens/labels";
import { createOrdersScreen } from "./screens/orders";
import { createPriceScreen } from "./screens/price";
import { createProductsScreen } from "./screens/products";
import { createSaleScreen } from "./screens/sale";
import { createSettingsScreen } from "./screens/settings";
import { onSettingsChange, setSettings } from "./state";
import { errorMessage, run, setActiveScanInput, toast, type Screen } from "./ui";

window.addEventListener("error", (e) => toast(`Beklenmeyen hata: ${e.message}`, "error"));
window.addEventListener("unhandledrejection", (e) => toast(`Beklenmeyen hata: ${errorMessage(e.reason)}`, "error"));

const screens: Screen[] = [
  createSaleScreen(),
  createPriceScreen(),
  createProductsScreen(),
  createLabelsScreen(),
  createOrdersScreen(),
  createSettingsScreen(),
];

const container = document.getElementById("screens")!;
for (const screen of screens) {
  screen.el.hidden = true;
  container.append(screen.el);
}

function showScreen() {
  const id = location.hash.slice(1);
  const screen = screens.find((s) => s.id === id) ?? screens[0]!;
  for (const s of screens) s.el.hidden = s !== screen;
  for (const tab of document.querySelectorAll<HTMLAnchorElement>("#tabs a")) {
    tab.classList.toggle("active", tab.dataset.screen === screen.id);
  }
  setActiveScanInput(screen.scanInput ?? null);
  void screen.show();
}

onSettingsChange((s) => {
  document.getElementById("shop-name")!.textContent = s.shop_name || "Tezgah";
  document.title = s.shop_name && s.shop_name !== "Tezgah" ? `${s.shop_name} – Tezgah` : "Tezgah";
});

window.addEventListener("hashchange", showScreen);
// Load settings first so that label previews use them.
void run(async () => setSettings(await api.settings())).finally(showScreen);
