import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { getSqlite } from '../db/connection.js';
const children = [];
const folders = [];
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function freePort() {
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', resolve);
    });
    const address = probe.address();
    if (!address || typeof address === 'string')
        throw new Error('Could not allocate an integration-test port.');
    await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
    return address.port;
}
async function startServer(dataDir) {
    const port = await freePort();
    const bootstrap = `import('./src/index.ts').then(() => process.on('message', (message) => {
    if (message === 'SIGINT' || message === 'SIGTERM') process.emit(message)
  }))`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', bootstrap], {
        cwd: path.resolve(process.cwd()),
        env: {
            ...process.env, DATA_DIR: dataDir, DB_PATH: path.join(dataDir, 'shootingrange.db'),
            PORT: String(port), HOST: '127.0.0.1', AUTO_BACKUP_CHECK_MINUTES: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    children.push(child);
    let logs = '';
    child.stdout?.on('data', (chunk) => { logs += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { logs += chunk.toString(); });
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 20_000;
    while (!logs.includes(`[SERVER] Listening on http://127.0.0.1:${port}`) && Date.now() < deadline) {
        if (child.exitCode !== null)
            throw new Error(`Test server exited early: ${logs}`);
        await delay(100);
    }
    if (!logs.includes(`[SERVER] Listening on http://127.0.0.1:${port}`))
        throw new Error(`Test server did not start: ${logs}`);
    return { child, baseUrl, getLogs: () => logs };
}
async function waitFor(predicate, description, timeoutMs = 75_000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate() && Date.now() < deadline)
        await delay(250);
    if (!predicate())
        throw new Error(`Timed out waiting for ${description}.`);
}
async function login(baseUrl) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'AdminPass123' }),
    });
    if (!response.ok)
        throw new Error(`Integration login failed: ${response.status} ${await response.text()}`);
    const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
    if (!cookie)
        throw new Error('Integration login did not return a session cookie.');
    return cookie;
}
afterEach(async () => {
    for (const child of children.splice(0)) {
        if (child.exitCode === null && child.signalCode === null)
            child.send('SIGTERM');
        if (child.exitCode === null && child.signalCode === null) {
            await Promise.race([
                new Promise((resolve) => child.once('exit', () => resolve())),
                delay(15_000).then(() => { child.kill('SIGTERM'); }),
            ]);
        }
    }
    for (const folder of folders.splice(0))
        fs.rmSync(folder, { recursive: true, force: true });
}, 30_000);
describe('automatic backup process lifecycle', () => {
    it('starts a server, backs up on startup/daily/shutdown, prunes retention, restores, and starts again', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rangeops-autobackup-lifecycle-'));
        folders.push(root);
        const sourcePath = path.join(root, 'source.db');
        await getSqlite().backup(sourcePath);
        const dataDir = path.join(root, 'server-data');
        fs.mkdirSync(dataDir);
        fs.copyFileSync(sourcePath, path.join(dataDir, 'shootingrange.db'));
        const backupDir = path.join(dataDir, 'backups');
        const first = await startServer(dataDir);
        await waitFor(() => fs.existsSync(backupDir) && fs.readdirSync(backupDir).some((name) => /-startup\.db$/.test(name)), 'startup backup');
        const startupFile = fs.readdirSync(backupDir).find((name) => /-startup\.db$/.test(name));
        const yesterday = new Date(Date.now() - 48 * 60 * 60 * 1000);
        for (let index = 0; index < 20; index++) {
            const filename = `auto-20250101-${String(index).padStart(6, '0')}-daily.db`;
            const fake = path.join(backupDir, filename);
            fs.writeFileSync(fake, 'old automatic backup');
            const modified = new Date(yesterday.getTime() - (20 - index) * 24 * 60 * 60 * 1000);
            fs.utimesSync(fake, modified, modified);
        }
        const startupPath = path.join(backupDir, startupFile);
        fs.utimesSync(startupPath, yesterday, yesterday);
        await waitFor(() => fs.readdirSync(backupDir).some((name) => /-daily\.db$/.test(name) && !name.startsWith('auto-20250101-')), 'daily backup after the next 1-minute check');
        const automaticFiles = fs.readdirSync(backupDir).filter((name) => /^auto-\d{8}-\d{6}-(startup|daily|shutdown)\.db$/.test(name));
        expect(automaticFiles).toHaveLength(14);
        const dailyFile = automaticFiles.find((name) => /-daily\.db$/.test(name) && !name.startsWith('auto-20250101-'));
        const dailyDb = new (await import('better-sqlite3')).default(path.join(backupDir, dailyFile), { readonly: true, fileMustExist: true });
        expect(dailyDb.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
        dailyDb.close();
        first.child.send('SIGINT');
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`SIGINT shutdown timed out: ${first.getLogs()}`)), 15_000);
            first.child.once('exit', () => { clearTimeout(timeout); resolve(); });
        });
        const shutdownFile = fs.readdirSync(backupDir).find((name) => /-shutdown\.db$/.test(name));
        expect(shutdownFile).toBeDefined();
        const second = await startServer(dataDir);
        let cookie = await login(second.baseUrl);
        const created = await fetch(`${second.baseUrl}/api/participants`, {
            method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ bib_number: 'RESTORE-LIFECYCLE', noc: 'USA', name: 'Restore Lifecycle', gun_number: 'RESTORE-LIFECYCLE', category_id: 1 }),
        });
        expect(created.status).toBe(201);
        const form = new FormData();
        form.append('file', new Blob([fs.readFileSync(path.join(backupDir, shutdownFile))]), shutdownFile);
        form.append('confirm', 'RESTORE');
        const restored = await fetch(`${second.baseUrl}/api/backup/restore`, { method: 'POST', headers: { Cookie: cookie }, body: form });
        expect(restored.status).toBe(200);
        expect((await restored.json()).ok).toBe(true);
        const expired = await fetch(`${second.baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
        expect(expired.status).toBe(401);
        cookie = await login(second.baseUrl);
        const list = await fetch(`${second.baseUrl}/api/participants?search=RESTORE-LIFECYCLE`, { headers: { Cookie: cookie } });
        expect(list.status).toBe(200);
        expect((await list.json()).data).toHaveLength(0);
        expect(second.getLogs()).toContain('[SERVER] Listening');
    }, 100_000);
});
//# sourceMappingURL=autoBackupLifecycle.test.js.map