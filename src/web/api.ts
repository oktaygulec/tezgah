// Thin fetch wrapper: every failure becomes an ApiError with a Turkish message.

import type {
  ImportResult,
  NewOrderLine,
  Order,
  OrderWithLines,
  Product,
  ProductInput,
  Settings,
} from "../shared/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, rawBody?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, "Sunucuya bağlanılamadı. Tezgah penceresi açık mı?");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(res.status, `Sunucudan beklenmeyen yanıt (${res.status}).`);
  }
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string })?.error ?? `Sunucu hatası (${res.status}).`);
  }
  return data as T;
}

export const api = {
  products: () => request<Product[]>("GET", "/api/products"),
  productByBarcode: (barcode: string) =>
    request<Product>("GET", `/api/products/by-barcode/${encodeURIComponent(barcode)}`),
  createProduct: (input: ProductInput) => request<Product>("POST", "/api/products", input),
  updateProduct: (id: number, input: ProductInput) => request<Product>("PUT", `/api/products/${id}`, input),
  deleteProduct: (id: number) => request<{ ok: true }>("DELETE", `/api/products/${id}`),
  nextBarcode: () => request<{ barcode: string }>("GET", "/api/barcode/next"),
  importCsv: (text: string) => request<ImportResult>("POST", "/api/products/import", undefined, text),
  orders: (day?: string) => request<Order[]>("GET", day ? `/api/orders?day=${day}` : "/api/orders"),
  order: (id: number) => request<OrderWithLines>("GET", `/api/orders/${id}`),
  createOrder: (lines: NewOrderLine[]) => request<OrderWithLines>("POST", "/api/orders", { lines }),
  settings: () => request<Settings>("GET", "/api/settings"),
  saveSettings: (s: Settings) => request<Settings>("PUT", "/api/settings", s),
};

/** Looks up a barcode; null when it is not registered. Other errors are thrown. */
export async function findProduct(barcode: string): Promise<Product | null> {
  try {
    return await api.productByBarcode(barcode);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
