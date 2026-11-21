// Ayarlar: label size and layout, shop name, database backup download.

import { SETTING_LABELS, SETTING_RANGES, validateSettings, type NumericSettingKey, type Settings } from "../../shared/types";
import { api } from "../api";
import { getSettings, setSettings } from "../state";
import { h, run, toast, type Screen } from "../ui";
import { createUpdatePanel } from "../updater";
import { labelPreview } from "./labels";

const PREVIEW_PRODUCT = { barcode: "2000000000015", name: "Örnek Ürün Adı Uzun Olabilir", price_kurus: 12950 };

type NumberKey = NumericSettingKey;

/** [setting, input step] */
const NUMBER_FIELDS: [NumberKey, number][] = [
  ["label_width_mm", 1],
  ["label_height_mm", 1],
  ["label_margin_mm", 0.5],
  ["barcode_height_mm", 1],
  ["name_font_pt", 0.5],
  ["price_font_pt", 1],
  ["digits_font_pt", 0.5],
];

export function createSettingsScreen(): Screen {
  const shopName = h("input", { class: "input", maxLength: 100 });
  const numbers = new Map<NumberKey, HTMLInputElement>();
  const showName = h("input", { type: "checkbox" });
  const showPrice = h("input", { type: "checkbox" });
  const preview = h("div", { class: "label-preview" });
  const formError = h("div", { class: "form-error", role: "alert" });
  const versionText = h("div", {});

  for (const [key] of NUMBER_FIELDS) {
    const [min, max] = SETTING_RANGES[key];
    numbers.set(key, h("input", { class: "input input-number", type: "number", min, max }));
  }

  function fill(s: Settings) {
    shopName.value = s.shop_name;
    for (const [key, input] of numbers) input.value = String(s[key]);
    showName.checked = s.show_name;
    showPrice.checked = s.show_price;
  }

  function readForm(): Settings {
    const s: Settings = { ...getSettings(), shop_name: shopName.value.trim(), show_name: showName.checked, show_price: showPrice.checked };
    for (const [key, input] of numbers) s[key] = Number(input.value.replace(",", "."));
    return s;
  }

  /** Live preview of the values in the form (not yet saved). */
  function renderPreview() {
    const s = readForm();
    const error = validateSettings(s);
    preview.replaceChildren(
      h("div", { class: "muted" }, "Önizleme (gerçek boyut):"),
      error ? h("div", { class: "form-error" }, error) : labelPreview(PREVIEW_PRODUCT, s),
    );
  }

  async function save(e: Event) {
    e.preventDefault();
    formError.textContent = "";
    try {
      setSettings(await api.saveSettings(readForm()));
      toast("Ayarlar kaydedildi.", "success");
      renderPreview();
    } catch (err) {
      formError.textContent = (err as Error).message;
    }
  }

  const form = h(
    "form",
    { class: "form settings-form", onsubmit: save },
    h("h2", {}, "Dükkan"),
    h("label", { class: "field" }, h("span", {}, "Dükkan adı"), shopName),
    h("h2", {}, "Etiket"),
    ...NUMBER_FIELDS.map(([key, step]) => {
      const input = numbers.get(key)!;
      input.step = String(step);
      return h("label", { class: "field field-inline" }, h("span", {}, SETTING_LABELS[key]), input);
    }),
    h("label", { class: "check" }, showName, " Ürün adını göster"),
    h("label", { class: "check" }, showPrice, " Fiyatı göster"),
    formError,
    h("div", { class: "row" }, h("button", { type: "submit", class: "btn btn-primary" }, "Kaydet")),
    h("h2", {}, "Yedek"),
    h("p", { class: "muted" }, "Veritabanının şu anki hâlini bilgisayarınıza indirir."),
    h("a", { class: "btn", href: "/api/backup", download: "" }, "Veritabanı yedeği indir"),
    h("h2", {}, "Güncelleme"),
    versionText,
    createUpdatePanel(),
  );

  form.addEventListener("input", renderPreview);
  const el = h("section", { class: "screen screen-settings" }, form, preview);

  return {
    id: "ayarlar",
    el,
    show: () =>
      run(async () => {
        setSettings(await api.settings());
        versionText.textContent = `Kurulu sürüm: ${(await api.health()).version}`;
        fill(getSettings());
        renderPreview();
      }),
  };
}
