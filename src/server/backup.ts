import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { backupStamp } from "../shared/time";

export const KEEP_BACKUPS = 30;
const BACKUP_NAME = /^tezgah-\d{8}-\d{6}\.db$/;

/** Writes a consistent copy of the open database to backups/ and keeps the newest 30. */
export function backupDatabase(db: Database, dataDir: string): string {
  const dir = path.join(dataDir, "backups");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `tezgah-${backupStamp()}.db`);
  if (!existsSync(file)) {
    // VACUUM INTO makes a clean, complete copy even while the database is open.
    db.query("VACUUM INTO ?").run(file);
  }
  pruneBackups(dir);
  return file;
}

export function pruneBackups(dir: string, keep = KEEP_BACKUPS): string[] {
  const old = readdirSync(dir)
    .filter((name) => BACKUP_NAME.test(name))
    .sort() // names hold the timestamp, so name order is time order
    .reverse()
    .slice(keep);
  for (const name of old) rmSync(path.join(dir, name));
  return old;
}
