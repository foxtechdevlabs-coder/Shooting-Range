import { createApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { runShutdownBackup, startAutoBackup } from './services/autoBackup.js';
// Run migrations on startup
console.log('[DB] Running migrations...');
runMigrations();
console.log('[DB] Migrations complete.');
const app = createApp();
const server = app.listen(config.port, config.host, () => {
    console.log(`[SERVER] Listening on http://${config.host}:${config.port}`);
    console.log(`[SERVER] Database: ${config.dbPath}`);
});
startAutoBackup();
// Graceful shutdown
let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    console.log(`[SERVER] ${signal} received, shutting down...`);
    server.close();
    server.closeAllConnections();
    try {
        await runShutdownBackup();
    }
    finally {
        process.exit(0);
    }
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('beforeExit', () => { void runShutdownBackup(); });
//# sourceMappingURL=index.js.map