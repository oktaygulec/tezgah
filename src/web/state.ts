// App-wide state: the current settings (with change listeners) and the category list.

import { DEFAULT_SETTINGS, type Category, type Settings } from "../shared/types";
import { api } from "./api";

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

let categories: Category[] = [];

export const getCategories = () => categories;

/** Reads the categories again (after a change in Kategoriler) and returns them. */
export async function loadCategories(): Promise<Category[]> {
  categories = await api.categories();
  return categories;
}

export function categoryOf(categoryId: number | null): Category | null {
  return categoryId === null ? null : (categories.find((c) => c.id === categoryId) ?? null);
}
