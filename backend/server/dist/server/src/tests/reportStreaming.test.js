import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { getSqlite } from '../db/connection.js';
import { createApp } from '../app.js';
import { agent } from './helpers.js';
describe('streamed report exports', () => {
    let server;
    afterEach(async () => {
        if (server?.listening)
            await new Promise((resolve) => server.close(() => resolve()));
        server = undefined;
    });
    it('streams workbook rows in chunks instead of buffering the complete response', async () => {
        const db = getSqlite();
        const now = new Date().toISOString();
        const insert = db.prepare(`INSERT INTO participants
      (bib_number, noc, name, gun_number, category_id, pouch_status, label_printed, created_at, updated_at)
      VALUES (?, 'USA', ?, ?, 1, 'in', 0, ?, ?)`);
        db.transaction(() => {
            for (let index = 0; index < 5000; index++) {
                insert.run(`STREAM${String(index).padStart(5, '0')}`, `Streaming Participant ${index}`, `STR-${index}`, now, now);
            }
        })();
        const admin = agent();
        const loginResponse = await admin.post('/api/auth/login').send({ username: 'admin', password: 'AdminPass123' });
        expect(loginResponse.status).toBe(200);
        const cookie = String(loginResponse.headers['set-cookie']).split(',')[0].split(';')[0];
        server = createApp().listen(0, '127.0.0.1');
        await new Promise((resolve, reject) => {
            server.once('listening', resolve);
            server.once('error', reject);
        });
        const address = server.address();
        if (!address || typeof address === 'string')
            throw new Error('Test server did not bind.');
        for (const endpoint of ['/api/reports/participants?format=xlsx', '/api/export/all']) {
            const received = await new Promise((resolve, reject) => {
                const request = http.get({
                    host: '127.0.0.1', port: address.port, path: endpoint, headers: { Cookie: cookie },
                }, (response) => {
                    let chunks = 0;
                    let bytes = 0;
                    response.on('data', (chunk) => { chunks++; bytes += chunk.length; });
                    response.on('end', () => resolve({
                        status: response.statusCode ?? 0,
                        transferEncoding: response.headers['transfer-encoding'],
                        chunks, bytes,
                    }));
                });
                request.on('error', reject);
            });
            expect(received.status, endpoint).toBe(200);
            expect(received.transferEncoding, endpoint).toContain('chunked');
            expect(received.chunks, endpoint).toBeGreaterThan(1);
            expect(received.bytes, endpoint).toBeGreaterThan(100_000);
        }
    });
});
//# sourceMappingURL=reportStreaming.test.js.map