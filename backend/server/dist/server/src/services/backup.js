import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { getSqlite } from '../db/connection.js';
export function defaultBackupFolder() {
    const row = getSqlite().prepare("SELECT value FROM settings WHERE key = 'backup_folder'").get();
    return row?.value || path.join(config.dataDir, 'backups');
}
export function validateBackupFolder(folder) {
    if (!path.isAbsolute(folder) || folder.split(/[\\/]+/).includes('..')) {
        throw Object.assign(new Error('Backup destination must be an absolute folder path without traversal.'), { status: 400, code: 'INVALID_BACKUP_PATH' });
    }
    let stat;
    try {
        stat = fs.statSync(folder);
        fs.accessSync(folder, fs.constants.W_OK);
    }
    catch {
        throw Object.assign(new Error('Backup destination folder does not exist or is not writable.'), { status: 400, code: 'BACKUP_FOLDER_UNAVAILABLE' });
    }
    if (!stat.isDirectory()) {
        throw Object.assign(new Error('Backup destination must be an existing folder.'), { status: 400, code: 'INVALID_BACKUP_PATH' });
    }
    return path.resolve(folder);
}
function backupFileName(date = new Date()) {
    const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-').replace('Z', '');
    return `shootingrange-backup-${stamp}.db`;
}
export async function createDatabaseBackup(folder, updateManualTimestamp = false) {
    if (!fs.existsSync(folder) && path.resolve(folder) === path.join(config.dataDir, 'backups')) {
        fs.mkdirSync(folder, { recursive: true });
    }
    const destination = validateBackupFolder(folder);
    const filename = backupFileName();
    const finalPath = path.join(destination, filename);
    const tempPath = path.join(destination, `.${filename}.${randomUUID()}.tmp`);
    try {
        await getSqlite().backup(tempPath);
        fs.renameSync(tempPath, finalPath);
        if (updateManualTimestamp) {
            getSqlite().prepare(`INSERT INTO settings (key, value) VALUES ('last_manual_backup_at', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(new Date().toISOString());
        }
        pruneBackups(destination);
        return { path: finalPath, filename, createdAt: new Date().toISOString() };
    }
    catch (error) {
        if (fs.existsSync(tempPath))
            fs.rmSync(tempPath, { force: true });
        throw Object.assign(new Error(`Backup failed: ${error instanceof Error ? error.message : 'destination write failed'}`), { status: 500, code: 'BACKUP_FAILED' });
    }
}
export function pruneBackups(folder) {
    const candidates = fs.readdirSync(folder)
        .filter((file) => /^shootingrange-backup-\d{8}-\d{6}\.db$/.test(file))
        .map((file) => ({ file, mtime: fs.statSync(path.join(folder, file)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    for (const item of candidates.slice(14))
        fs.rmSync(path.join(folder, item.file), { force: true });
}
export function getBackupStatus() {
    const db = getSqlite();
    const values = Object.fromEntries(db.prepare(`SELECT key, value FROM settings WHERE key IN
    ('last_manual_backup_at', 'last_auto_backup_at', 'last_automatic_backup_at', 'last_auto_backup_error', 'next_auto_backup_check_at')`).all().map((row) => [row.key, row.value]));
    const lastManualBackupAt = values.last_manual_backup_at ?? null;
    const checkIntervalMs = Math.max(1, Number(process.env.AUTO_BACKUP_CHECK_MINUTES ?? 15)) * 60_000;
    return {
        lastManualBackupAt,
        hoursSinceManualBackup: lastManualBackupAt ? Math.max(0, (Date.now() - Date.parse(lastManualBackupAt)) / 3600000) : null,
        lastAutomaticBackupAt: values.last_auto_backup_at ?? values.last_automatic_backup_at ?? null,
        lastAutoBackupAt: values.last_auto_backup_at ?? values.last_automatic_backup_at ?? null,
        lastAutoBackupError: values.last_auto_backup_error || null,
        nextScheduledCheckAt: values.next_auto_backup_check_at ?? new Date(Date.now() + checkIntervalMs).toISOString(),
        backupFolder: defaultBackupFolder(),
    };
}
export async function runAutomaticBackup(force = false) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const value = getSqlite().prepare("SELECT value FROM settings WHERE key = 'last_automatic_backup_at'").get();
    if (!force && value?.value.slice(0, 10) === today)
        return null;
    const result = await createDatabaseBackup(defaultBackupFolder());
    getSqlite().prepare(`INSERT INTO settings (key, value) VALUES ('last_automatic_backup_at', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(result.createdAt);
    return result;
}
//# sourceMappingURL=backup.js.map