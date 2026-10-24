import { beforeEach, describe, expect, it } from 'vitest';
import { loginAs } from './helpers.js';
import { getSqlite } from '../db/connection.js';
describe('transaction corrections', () => {
    beforeEach(() => {
        getSqlite().prepare("UPDATE settings SET value = '0' WHERE key = 'duplicate_scan_window_seconds'").run();
        getSqlite().prepare("UPDATE participants SET pouch_status = 'in' WHERE bib_number = '101'").run();
    });
    it('keeps the original immutable and exposes the effective corrected row', async () => {
        const admin = await loginAs('admin', 'AdminPass123');
        const scan = await admin.post('/api/scan').send({ code: 'G-201' });
        const original = getSqlite().prepare('SELECT * FROM transactions WHERE id = ?').get(scan.body.transaction_id);
        const correctedTime = '2026-10-23T12:34:56.000Z';
        const result = await admin.post('/api/transactions/corrections').send({
            action: 'edit', transactionId: scan.body.transaction_id, newTimestamp: correctedTime, reason: 'Correct recorded time',
        });
        expect(result.status).toBe(201);
        const stillOriginal = getSqlite().prepare('SELECT * FROM transactions WHERE id = ?').get(scan.body.transaction_id);
        expect(stillOriginal).toEqual(original);
        const listed = await admin.get('/api/transactions').query({ participant_id: 1 });
        expect(listed.body.data[0]).toMatchObject({ status: 'corrected', created_at: correctedTime, correction_reason: 'Correct recorded time' });
        const auditLog = await admin.get('/api/corrections');
        expect(auditLog.status).toBe(200);
        expect(auditLog.body.data[0]).toMatchObject({ action: 'edit', reason: 'Correct recorded time', participant_id: 1 });
        expect(() => getSqlite().prepare('UPDATE transactions SET type = ? WHERE id = ?').run('in', scan.body.transaction_id)).toThrow(/append-only/);
        expect(() => getSqlite().prepare('DELETE FROM transactions WHERE id = ?').run(scan.body.transaction_id)).toThrow(/append-only/);
        expect(() => getSqlite().prepare('UPDATE corrections SET reason = ? WHERE transaction_id = ?').run('changed', scan.body.transaction_id)).toThrow(/append-only/);
        expect(() => getSqlite().prepare('DELETE FROM corrections WHERE transaction_id = ?').run(scan.body.transaction_id)).toThrow(/append-only/);
    });
    it('requires a reason and rejects a correction that makes consecutive same-type events', async () => {
        const admin = await loginAs('admin', 'AdminPass123');
        const missingReason = await admin.post('/api/transactions/corrections').send({ action: 'void', transactionId: 1 });
        expect(missingReason.status).toBe(400);
        const first = await admin.post('/api/scan').send({ code: 'G-201' });
        const second = await admin.post('/api/scan').send({ code: 'G-201' });
        expect(first.body.new_status).toBe('out');
        expect(second.body.new_status).toBe('in');
        const result = await admin.post('/api/transactions/corrections').send({
            action: 'edit', transactionId: second.body.transaction_id, newType: 'out', reason: 'Fix duplicate checkout',
        });
        expect(result.status).toBe(409);
        expect(result.body.error.code).toBe('INVALID_TRANSACTION_SEQUENCE');
        expect(result.body.error.message).toContain('expected in');
    });
    it('recalculates pouch status when the last check-out is voided and when a missed check-out is added', async () => {
        const admin = await loginAs('admin', 'AdminPass123');
        const now = new Date().toISOString();
        const participantId = Number(getSqlite().prepare(`INSERT INTO participants
      (bib_number, noc, name, gun_number, category_id, pouch_status, label_printed, created_at, updated_at)
      VALUES ('909', 'IND', 'Correction Athlete', 'COR-909', 1, 'in', 0, ?, ?)`).run(now, now).lastInsertRowid);
        const scan = await admin.post('/api/scan').send({ code: 'COR-909' });
        const voided = await admin.post('/api/transactions/corrections').send({
            action: 'void', transactionId: scan.body.transaction_id, reason: 'Scan was accidental',
        });
        expect(voided.status).toBe(201);
        expect(voided.body.pouchStatus).toBe('in');
        expect(getSqlite().prepare('SELECT pouch_status FROM participants WHERE id = ?').get(participantId).pouch_status).toBe('in');
        const added = await admin.post('/api/transactions/corrections').send({
            action: 'add', participantId, newType: 'out', newTimestamp: '2026-10-23T13:00:00.000Z', reason: 'Missed manual checkout',
        });
        expect(added.status).toBe(201);
        expect(added.body.pouchStatus).toBe('out');
        expect(getSqlite().prepare("SELECT transaction_id FROM corrections WHERE action = 'add' ORDER BY id DESC LIMIT 1").get()).toEqual({ transaction_id: null });
        expect(getSqlite().prepare('SELECT pouch_status FROM participants WHERE id = ?').get(participantId).pouch_status).toBe('out');
        const effective = await admin.get('/api/transactions').query({ participant_id: participantId });
        expect(effective.body.data.filter((row) => row.source === 'correction')).toHaveLength(1);
    });
    it('enforces correction permissions and admin-only reports', async () => {
        const staff = await loginAs('staff', 'StaffPass123');
        const correction = await staff.post('/api/transactions/corrections/preview').send({ action: 'void', transactionId: 1 });
        expect(correction.status).toBe(403);
        const report = await staff.get('/api/reports/corrections');
        expect(report.status).toBe(403);
    });
    it('logs report exports to the activity log', async () => {
        const admin = await loginAs('admin', 'AdminPass123');
        const before = getSqlite().prepare("SELECT COUNT(*) AS count FROM activity_log WHERE action = 'EXPORT_REPORT'").get().count;
        const response = await admin.get('/api/reports/participants').query({ format: 'xlsx' });
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('spreadsheetml');
        const after = getSqlite().prepare("SELECT COUNT(*) AS count FROM activity_log WHERE action = 'EXPORT_REPORT'").get().count;
        expect(after).toBe(before + 1);
    });
});
//# sourceMappingURL=corrections.test.js.map