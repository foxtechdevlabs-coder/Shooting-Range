import { createApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { closeDb, getSqlite } from './db/connection.js';
import { runAutomaticBackup } from './services/backup.js';
// Run migrations on startup
console.log('[DB] Running migrations...');
runMigrations();
console.log('[DB] Migrations complete.');
const app = createApp();
const server = app.listen(config.port, config.host, () => {
    console.log(`[SERVER] Listening on http://${config.host}:${config.port}`);
    console.log(`[SERVER] Database: ${config.dbPath}`);
});
void runAutomaticBackup().catch((error) => console.error('[BACKUP] Daily backup failed:', error));
const backupTimer = setInterval(() => {
    void runAutomaticBackup().catch((error) => console.error('[BACKUP] Daily backup failed:', error));
}, 60 * 60 * 1000);
backupTimer.unref();
// Graceful shutdown
let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    console.log(`[SERVER] ${signal} received, shutting down...`);
    clearInterval(backupTimer);
    server.close();
    try {
        await runAutomaticBackup(true);
    }
    catch (error) {
        console.error('[BACKUP] Shutdown backup failed:', error);
    }
    finally {
        try {
            getSqlite().pragma('wal_checkpoint(TRUNCATE)');
        }
        catch { /* The database may have been reset. */ }
        closeDb();
        process.exit(0);
    }
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
//# sourceMappingURL=index.js.map