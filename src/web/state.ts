// App-wide state: the current settings, with change listeners.

import { DEFAULT_SETTINGS, type Settings } from "../shared/types";

let current: Settings = { ...DEFAULT_SETTINGS };
const listeners: ((s: Settings) => void)[] = [];

export const getSettings = () => current;

export function setSettings(s: Settings) {
  current = s;
  for (const fn of listeners) fn(s);
}

export function onSettingsChange(fn: (s: Settings) => void) {
  listeners.push(fn);
}
