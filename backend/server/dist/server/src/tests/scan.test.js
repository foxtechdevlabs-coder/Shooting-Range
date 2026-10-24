import { describe, it, expect, beforeEach } from 'vitest';
import { loginAs } from './helpers.js';
import { getSqlite } from '../db/connection.js';
describe('Scan endpoint', () => {
    beforeEach(() => {
        getSqlite().prepare("UPDATE settings SET value = '0' WHERE key = 'duplicate_scan_window_seconds'").run();
    });
    it('toggles pouch in→out', async () => {
        const ag = await loginAs('admin', 'AdminPass123');
        // Reset to 'in'
        getSqlite().prepare("UPDATE participants SET pouch_status = 'in' WHERE bib_number = '101'").run();
        const res = await ag.post('/api/scan').send({ code: 'G-201' });
        expect(res.status).toBe(200);
        expect(res.body.new_status).toBe('out');
        expect(res.body.participant.bib_number).toBe('101');
    });
    it('toggles pouch out→in', async () => {
        const ag = await loginAs('admin', 'AdminPass123');
        getSqlite().prepare("UPDATE participants SET pouch_status = 'out' WHERE bib_number = '101'").run();
        const res = await ag.post('/api/scan').send({ code: 'G-201' });
        expect(res.status).toBe(200);
        expect(res.body.new_status).toBe('in');
    });
    it('normalizes lowercase codes', async () => {
        const ag = await loginAs('admin', 'AdminPass123');
        getSqlite().prepare("UPDATE participants SET pouch_status = 'in' WHERE bib_number = '101'").run();
        const res = await ag.post('/api/scan').send({ code: '  g-201  ' }); // lowercase + whitespace
        expect(res.status).toBe(200);
        expect(res.body.participant.gun_number).toBe('G-201');
    });
    it('returns 404 for unknown code and records nothing', async () => {
        const ag = await loginAs('admin', 'AdminPass123');
        const before = getSqlite().prepare('SELECT COUNT(*) as c FROM transactions').get();
        const res = await ag.post('/api/scan').send({ code: 'UNKNOWN-9999' });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('UNKNOWN_CODE');
        const after = getSqlite().prepare('SELECT COUNT(*) as c FROM transactions').get();
        expect(after.c).toBe(before.c); // nothing recorded
    });
    it('returns 409 DUPLICATE_SCAN within window', async () => {
        getSqlite().prepare("UPDATE settings SET value = '5' WHERE key = 'duplicate_scan_window_seconds'").run();
        const ag = await loginAs('admin', 'AdminPass123');
        getSqlite().prepare("UPDATE participants SET pouch_status = 'in' WHERE bib_number = '101'").run();
        // First scan
        await ag.post('/api/scan').send({ code: 'G-201' });
        // Immediate second scan
        const res = await ag.post('/api/scan').send({ code: 'G-201' });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('DUPLICATE_SCAN');
        expect(res.body.error.needsConfirmation).toBe(true);
    });
    it('succeeds with confirm: true despite duplicate window', async () => {
        getSqlite().prepare("UPDATE settings SET value = '5' WHERE key = 'duplicate_scan_window_seconds'").run();
        const ag = await loginAs('admin', 'AdminPass123');
        getSqlite().prepare("UPDATE participants SET pouch_status = 'in' WHERE bib_number = '101'").run();
        await ag.post('/api/scan').send({ code: 'G-201' }); // first scan
        const res = await ag.post('/api/scan').send({ code: 'G-201', confirm: true });
        expect(res.status).toBe(200);
    });
});
describe('Scan permissions', () => {
    it('returns 403 if user lacks scan.use', async () => {
        const ag = await loginAs('noperm', 'StaffPass123');
        const res = await ag.post('/api/scan').send({ code: 'G-201' });
        expect(res.status).toBe(403);
    });
});
//# sourceMappingURL=scan.test.js.map