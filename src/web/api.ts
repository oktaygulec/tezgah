// Thin fetch wrapper: every failure becomes an ApiError with a Turkish message.

import type {
  ImportResult,
  NewOrderLine,
  Order,
  OrderWithLines,
  Product,
  ProductInput,
  Settings,
  HealthResponse,
  LowStockItem,
  SalesReport,
  PrinterList,
  PrintLabelInput,
  UpdateInfo,
} from "../shared/types";
import type { StockMode, StockMovement } from "../shared/stock";
import type { PeriodKind } from "../shared/report";

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
  createProduct: (input: ProductInput, initialStock = 0) =>
    request<Product>("POST", "/api/products", { ...input, stock_qty: initialStock }),
  adjustStock: (id: number, body: { mode: StockMode; quantity: number; note: string }) =>
    request<Product>("POST", `/api/products/${id}/stock`, body),
  stockMovements: (id: number) => request<StockMovement[]>("GET", `/api/products/${id}/stock`),
  lowStock: () => request<LowStockItem[]>("GET", "/api/stock/low"),
  salesReport: (period: PeriodKind, date: string) =>
    request<SalesReport>("GET", `/api/reports/sales?period=${period}&date=${date}`),
  receiveStock: (lines: { product_id: number; quantity: number }[], note: string) =>
    request<{ products: number; pieces: number }>("POST", "/api/stock/receive", { lines, note }),
  updateProduct: (id: number, input: ProductInput) => request<Product>("PUT", `/api/products/${id}`, input),
  deleteProduct: (id: number) => request<{ ok: true }>("DELETE", `/api/products/${id}`),
  nextBarcode: () => request<{ barcode: string }>("GET", "/api/barcode/next"),
  importCsv: (text: string) => request<ImportResult>("POST", "/api/products/import", undefined, text),
  orders: (day?: string) => request<Order[]>("GET", day ? `/api/orders?day=${day}` : "/api/orders"),
  order: (id: number) => request<OrderWithLines>("GET", `/api/orders/${id}`),
  deleteOrder: (id: number) => request<{ ok: true }>("DELETE", `/api/orders/${id}`),
  cancelOrder: (id: number) => request<OrderWithLines>("POST", `/api/orders/${id}/cancel`),
  createOrder: (lines: NewOrderLine[]) => request<OrderWithLines>("POST", "/api/orders", { lines }),
  settings: () => request<Settings>("GET", "/api/settings"),
  saveSettings: (s: Settings) => request<Settings>("PUT", "/api/settings", s),
  printers: () => request<PrinterList>("GET", "/api/printers"),
  print: (labels: PrintLabelInput[]) => request<{ ok: true; count: number }>("POST", "/api/print", { labels }),
  health: () => request<HealthResponse>("GET", "/api/health"),
  checkUpdate: () => request<UpdateInfo>("GET", "/api/update"),
  installUpdate: () => request<{ ok: true; version: string }>("POST", "/api/update"),
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
