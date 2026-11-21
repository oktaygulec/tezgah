// Ayarlar: shop name, label size and layout, printer, database backup, update.

import { SETTING_LABELS, SETTING_RANGES, validateSettings, type NumericSettingKey, type Settings } from "../../shared/types";
import { api } from "../api";
import { getSettings, setSettings } from "../state";
import { errorMessage, h, run, toast, type Screen } from "../ui";
import { createUpdatePanel } from "../updater";
import { labelPreview, printDirect } from "./labels";

const PREVIEW_PRODUCT = { barcode: "2000000000015", name: "Örnek Ürün Adı Uzun Olabilir", price_kurus: 12950 };

type NumberKey = NumericSettingKey;

/** [setting, input step] */
const LABEL_FIELDS: [NumberKey, number][] = [
  ["label_width_mm", 1],
  ["label_height_mm", 1],
  ["label_margin_mm", 0.5],
  ["barcode_height_mm", 1],
  ["name_font_pt", 0.5],
  ["price_font_pt", 1],
  ["digits_font_pt", 0.5],
];
const PRINTER_FIELDS: [NumberKey, number][] = [
  ["label_gap_mm", 0.5],
  ["print_density", 1],
  ["print_speed", 1],
  ["print_offset_x_mm", 0.5],
  ["print_offset_y_mm", 0.5],
];
const NO_PRINTER = "";

export function createSettingsScreen(): Screen {
  const shopName = h("input", { class: "input", maxLength: 100 });
  const numbers = new Map<NumberKey, HTMLInputElement>();
  const showName = h("input", { type: "checkbox" });
  const showPrice = h("input", { type: "checkbox" });
  const preview = h("div", { class: "label-preview" });
  const formError = h("div", { class: "form-error", role: "alert" });
  const versionText = h("div", {});
  const printerSelect = h("select", { class: "input" });
  const rotate = h("input", { type: "checkbox" });
  const printerStatus = h("div", { class: "muted small" });

  for (const [key, step] of [...LABEL_FIELDS, ...PRINTER_FIELDS]) {
    const [min, max] = SETTING_RANGES[key];
    numbers.set(key, h("input", { class: "input input-number", type: "number", min, max, step }));
  }

  const numberField = ([key]: [NumberKey, number]) =>
    h("label", { class: "field field-inline" }, h("span", {}, SETTING_LABELS[key]), numbers.get(key)!);

  /** Fills the printer list; the saved printer stays selectable even when Windows does not list it now. */
  async function loadPrinters(selected: string) {
    printerStatus.textContent = "Yazıcılar okunuyor…";
    let names: string[] = [];
    try {
      const list = await api.printers();
      names = list.printers;
      printerStatus.textContent = names.length ? `${names.length} yazıcı bulundu.` : "Bilgisayarda yazıcı bulunamadı.";
    } catch (e) {
      printerStatus.textContent = errorMessage(e);
    }
    const options = [h("option", { value: NO_PRINTER }, "Yazıcı yok: tarayıcının yazdırma penceresi kullanılır")];
    for (const name of names) options.push(h("option", { value: name }, name));
    if (selected && !names.includes(selected)) options.push(h("option", { value: selected }, `${selected} (şu an bulunamadı)`));
    printerSelect.replaceChildren(...options);
    printerSelect.value = selected;
  }

  function fill(s: Settings) {
    shopName.value = s.shop_name;
    for (const [key, input] of numbers) input.value = String(s[key]);
    showName.checked = s.show_name;
    showPrice.checked = s.show_price;
    rotate.checked = s.print_rotate_180;
  }

  function readForm(): Settings {
    const s: Settings = {
      ...getSettings(),
      shop_name: shopName.value.trim(),
      show_name: showName.checked,
      show_price: showPrice.checked,
      printer_name: printerSelect.value,
      print_rotate_180: rotate.checked,
    };
    for (const [key, input] of numbers) s[key] = Number(input.value.replace(",", "."));
    return s;
  }

  async function saveForm() {
    setSettings(await api.saveSettings(readForm()));
  }

  /** Saves the form, then prints one sample label to the chosen printer. */
  async function testPrint() {
    formError.textContent = "";
    if (!printerSelect.value) {
      formError.textContent = "Deneme için önce bir yazıcı seçin.";
      return;
    }
    try {
      await saveForm();
      await printDirect([{ product: PREVIEW_PRODUCT, copies: 1 }]);
      toast("Deneme etiketi yazıcıya gönderildi.", "success");
    } catch (err) {
      formError.textContent = errorMessage(err);
    }
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
      await saveForm();
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
    ...LABEL_FIELDS.map(numberField),
    h("label", { class: "check" }, showName, " Ürün adını göster"),
    h("label", { class: "check" }, showPrice, " Fiyatı göster"),
    h("h2", {}, "Yazıcı"),
    h(
      "p",
      { class: "muted small" },
      "Yazıcı seçilirse Etiket ekranındaki Yazdır düğmesi etiketleri pencere açmadan doğrudan yazıcıya gönderir. " +
        "TSPL dilini anlayan termal yazıcılar içindir (Xprinter, TSC ve benzerleri).",
    ),
    h(
      "label",
      { class: "field" },
      h("span", {}, "Etiket yazıcısı"),
      h("div", { class: "row" }, printerSelect, h("button", { type: "button", class: "btn", onclick: () => run(() => loadPrinters(printerSelect.value)) }, "Yenile")),
    ),
    printerStatus,
    ...PRINTER_FIELDS.map(numberField),
    h("label", { class: "check" }, rotate, " Etiketi 180° çevir (baskı ters çıkıyorsa)"),
    h("div", { class: "row" }, h("button", { type: "button", class: "btn", onclick: () => run(testPrint) }, "Kaydet ve deneme etiketi yazdır")),
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
        await loadPrinters(getSettings().printer_name);
      }),
  };
}
