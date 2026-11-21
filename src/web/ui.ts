// Small DOM helpers, toasts, in-page dialogs, error sound and scan-field focus.

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

/** Creates an element. Props starting with "on" become event listeners; "class" sets className. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "class") {
      el.className = String(value);
    } else if (key in el && key !== "list") {
      (el as unknown as Props)[key] = value;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) el.append(typeof child === "number" ? String(child) : child);
  }
  return el;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function toast(message: string, kind: "info" | "error" | "success" = "info", ms = 4000) {
  const box = document.getElementById("toasts")!;
  const item = h("div", { class: `toast toast-${kind}`, role: kind === "error" ? "alert" : "status" }, message);
  box.append(item);
  setTimeout(() => item.remove(), kind === "error" ? Math.max(ms, 7000) : ms);
}

/** Runs an async action and shows any error as a toast. */
export async function run(action: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (e) {
    console.error(e);
    toast(errorMessage(e), "error");
  }
}

/** Opens a modal <dialog>. `build` gets a close function; the promise resolves with the closed value. */
export function openDialog<T>(build: (close: (value: T | null) => void) => Node[]): Promise<T | null> {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog" });
    let result: T | null = null;
    const close = (value: T | null) => {
      result = value;
      dialog.close();
    };
    dialog.append(...build(close));
    // The X sits last in the DOM, so it does not take the first focus from the dialog's own field.
    dialog.append(h("button", { type: "button", class: "dialog-x", title: "Kapat", "aria-label": "Kapat", onclick: () => close(null) }, "×"));
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
      refocusScan();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** In-page yes/no question (instead of window.confirm). */
export function confirmDialog(message: string, okText = "Evet", danger = true): Promise<boolean> {
  return openDialog<boolean>((close) => [
    h("p", { class: "dialog-message" }, message),
    h(
      "div",
      { class: "dialog-actions" },
      h("button", { type: "button", class: "btn", onclick: () => close(false) }, "Vazgeç"),
      h("button", { type: "button", class: danger ? "btn btn-danger" : "btn btn-primary", autofocus: true, onclick: () => close(true) }, okText),
    ),
  ]).then((v) => v === true);
}

let audio: AudioContext | null = null;

/** Short low buzz for an unknown barcode (Web Audio, no sound file). */
export function errorSound() {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "square";
    osc.frequency.value = 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.25);
  } catch (e) {
    toast(`Uyarı sesi çalınamadı: ${errorMessage(e)}`, "error");
  }
}

// ----- scan field focus -----

let activeScanInput: HTMLInputElement | null = null;

/** Sets the scan field that must keep focus (null when the screen has none). */
export function setActiveScanInput(input: HTMLInputElement | null) {
  activeScanInput = input;
  refocusScan();
}

export function refocusScan() {
  const input = activeScanInput;
  if (!input || document.querySelector("dialog[open]") || document.body.classList.contains("printing")) return;
  const current = document.activeElement;
  if (current && current !== input && current.matches("input, textarea, select, [contenteditable]")) return;
  input.focus();
}

document.addEventListener("click", () => setTimeout(refocusScan, 0));
document.addEventListener("focusout", () => setTimeout(refocusScan, 0));

// ----- screens -----

export interface Screen {
  id: string;
  el: HTMLElement;
  /** Called each time the tab is opened. */
  show(): void | Promise<void>;
  /** The scan field that keeps focus on this screen, if any. */
  scanInput?: HTMLInputElement;
}

/** A scan field: calls onScan with the trimmed code when Enter is pressed. */
export function scanField(placeholder: string, onScan: (code: string) => Promise<void>): HTMLInputElement {
  const input = h("input", { class: "input scan-input", placeholder, autocomplete: "off", spellcheck: false });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = input.value.trim();
    input.value = "";
    if (code) void run(() => onScan(code));
  });
  return input;
}
