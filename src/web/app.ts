// App shell: loads settings, builds the screens and switches tabs by URL hash.
// Seven main tabs; Yönetim opens a second row with Ürünler, Toplu Fiyat, Kategoriler, Etiket and Raporlar.

import { api } from "./api";
import { createLabelsScreen } from "./screens/labels";
import { createOrdersScreen } from "./screens/orders";
import { createPriceScreen } from "./screens/price";
import { createProductsScreen } from "./screens/products";
import { createSaleScreen } from "./screens/sale";
import { createSettingsScreen } from "./screens/settings";
import { createStockInScreen } from "./screens/stockIn";
import { createLowStockScreen } from "./screens/lowStock";
import { createReportsScreen } from "./screens/reports";
import { createCategoriesScreen } from "./screens/categories";
import { createBulkPricesScreen } from "./screens/bulkPrices";
import { stayConnected } from "./live";
import { loadCategories, onSettingsChange, setSettings } from "./state";
import { errorMessage, run, setActiveScanInput, toast, type Screen } from "./ui";

window.addEventListener("error", (e) => toast(`Beklenmeyen hata: ${e.message}`, "error"));
window.addEventListener("unhandledrejection", (e) => toast(`Beklenmeyen hata: ${errorMessage(e.reason)}`, "error"));

const screens: Screen[] = [
  createSaleScreen(),
  createPriceScreen(),
  createOrdersScreen(),
  createStockInScreen(),
  createLowStockScreen(),
  createProductsScreen(),
  createBulkPricesScreen(),
  createCategoriesScreen(),
  createLabelsScreen(),
  createReportsScreen(),
  createSettingsScreen(),
];

/** Screens under the Yönetim tab, in sub-menu order. */
const MANAGEMENT = ["urunler", "toplu-fiyat", "kategoriler", "etiket", "raporlar"];
let lastManagement = MANAGEMENT[0]!;

const container = document.getElementById("screens")!;
const subtabs = document.getElementById("subtabs")!;
for (const screen of screens) {
  screen.el.hidden = true;
  container.append(screen.el);
}

function showScreen() {
  let id = location.hash.slice(1);
  if (id === "fiyat") id = "sorgula"; // old name of Ürün Sorgula
  if (id === "siparisler") id = "satislar"; // old name of Satışlar
  if (id === "yonetim") id = lastManagement;
  const screen = screens.find((s) => s.id === id) ?? screens[0]!;
  const inManagement = MANAGEMENT.includes(screen.id);
  if (inManagement) lastManagement = screen.id;
  for (const s of screens) s.el.hidden = s !== screen;
  for (const tab of document.querySelectorAll<HTMLAnchorElement>("#tabs a")) {
    tab.classList.toggle("active", tab.dataset.screen === (inManagement ? "yonetim" : screen.id));
  }
  subtabs.hidden = !inManagement;
  for (const tab of subtabs.querySelectorAll<HTMLAnchorElement>("a")) tab.classList.toggle("active", tab.dataset.screen === screen.id);
  setActiveScanInput(screen.scanInput ?? null);
  void screen.show();
}

onSettingsChange((s) => {
  document.getElementById("shop-name")!.textContent = s.shop_name || "Tezgah";
  document.title = s.shop_name && s.shop_name !== "Tezgah" ? `${s.shop_name} – Tezgah` : "Tezgah";
});

window.addEventListener("hashchange", showScreen);
stayConnected();
// Load settings and categories first: label previews and product forms use them.
void run(async () => {
  const [settings] = await Promise.all([api.settings(), loadCategories()]);
  setSettings(settings);
}).finally(showScreen);
