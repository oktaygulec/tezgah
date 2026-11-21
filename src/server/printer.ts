// Sends raw printer data (TSPL) to an installed printer, without any print dialog.
// Windows: the print spooler with the "RAW" data type (the printer driver is skipped).
// macOS / Linux: CUPS `lp -o raw`.

import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrinterList } from "../shared/types";

/** For tests: when set, print jobs are appended to this file instead of a printer. */
const TEST_FILE = process.env.TEZGAH_PRINT_TO_FILE;
export const TEST_PRINTER = "Test dosyası (TEZGAH_PRINT_TO_FILE)";


/** Runs a PowerShell script. Parameters go in environment variables, so nothing needs quoting. */
async function powershell(script: string, env: Record<string, string> = {}): Promise<string> {
  const wrapped = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
${script}
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}`;
  const encoded = Buffer.from(wrapped, "utf16le").toString("base64");
  const proc = Bun.spawn(
    ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    // windowsHide: no console window flashes on the screen for each print job.
    { env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true },
  );
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) {
    // PowerShell can add CLIXML progress records to stderr; keep only the plain message lines.
    const message = err
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.startsWith("#< CLIXML") && !l.startsWith("<Objs"))
      .join(" ")
      .trim();
    throw new Error(message || `PowerShell çıkış kodu ${code}`);
  }
  return out;
}

async function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(err.trim() || `${cmd[0]} çıkış kodu ${code}`);
  return out;
}

const LIST_SCRIPT = `
Add-Type -AssemblyName System.Drawing
$default = (New-Object System.Drawing.Printing.PrinterSettings).PrinterName
$names = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ForEach-Object { [string]$_ })
ConvertTo-Json -Compress -InputObject @{ printers = $names; default = $default }
`;

export async function listPrinters(): Promise<PrinterList> {
  const result: PrinterList = { printers: [], default: null };
  if (process.platform === "win32") {
    const parsed = JSON.parse((await powershell(LIST_SCRIPT)).trim()) as { printers: string[] | string | null; default: string | null };
    result.printers = parsed.printers === null ? [] : Array.isArray(parsed.printers) ? parsed.printers : [parsed.printers];
    result.default = parsed.default || null;
  } else {
    try {
      result.printers = (await run(["lpstat", "-e"])).split("\n").map((l) => l.trim()).filter(Boolean);
      result.default = /:\s*(.+)$/.exec((await run(["lpstat", "-d"])).trim())?.[1] ?? null;
    } catch {
      // no CUPS printers configured
    }
  }
  if (TEST_FILE) result.printers.push(TEST_PRINTER);
  return result;
}

// Microsoft's documented way to send raw bytes to a printer (KB 322091), compiled at run time.
const RAW_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class TezgahRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string Name;
    [MarshalAs(UnmanagedType.LPWStr)] public string OutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string DataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo info);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
  static Exception Fail(string step) { return new Exception(step + ": " + new Win32Exception(Marshal.GetLastWin32Error()).Message); }
  public static void Send(string printer, string document, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw Fail("Yazıcı açılamadı");
    try {
      DocInfo info = new DocInfo();
      info.Name = document;
      info.DataType = "RAW";
      if (StartDocPrinter(h, 1, info) == 0) throw Fail("Yazdırma işi başlatılamadı");
      try {
        if (!StartPagePrinter(h)) throw Fail("Sayfa başlatılamadı");
        int written;
        if (!WritePrinter(h, data, data.Length, out written)) throw Fail("Yazıcıya veri gönderilemedi");
        if (written != data.Length) throw new Exception("Yazıcıya verinin bir kısmı gönderilemedi.");
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[TezgahRawPrinter]::Send($env:TEZGAH_PRINTER, 'Tezgah etiket', [System.IO.File]::ReadAllBytes($env:TEZGAH_PRINT_FILE))
`;

/** Sends raw bytes to the printer as one print job. */
export async function sendRaw(printer: string, data: Uint8Array): Promise<void> {
  if (TEST_FILE && printer === TEST_PRINTER) {
    appendFileSync(TEST_FILE, data);
    return;
  }
  const file = path.join(tmpdir(), `tezgah-${process.pid}-${Date.now()}.prn`);
  writeFileSync(file, data);
  try {
    if (process.platform === "win32") {
      await powershell(RAW_SCRIPT, { TEZGAH_PRINTER: printer, TEZGAH_PRINT_FILE: file });
    } else {
      await run(["lp", "-d", printer, "-o", "raw", "-t", "Tezgah etiket", file]);
    }
  } finally {
    rmSync(file, { force: true });
  }
}
