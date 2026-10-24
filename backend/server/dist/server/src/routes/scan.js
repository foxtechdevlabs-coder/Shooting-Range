import { Router } from 'express';
import { z } from 'zod';
import { getSqlite } from '../db/connection.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { apiError } from '../middleware/errorHandler.js';
import { effectiveTransactions } from '../services/effectiveTransactions.js';
export const scanRouter = Router();
scanRouter.use(requireAuth);
scanRouter.use(requirePermission('scan.use'));
/** Normalize barcode: trim whitespace/control chars, uppercase */
function normalizeCode(code) {
    return code.replace(/[\x00-\x1F\x7F]/g, '').trim().toUpperCase();
}
const scanSchema = z.object({
    code: z.string().min(1, 'Scan code is required'),
    manual: z.boolean().optional().default(false),
    confirm: z.boolean().optional().default(false),
});
// ─── POST /api/scan ───────────────────────────────────────────────────────────
scanRouter.post('/', (req, res, next) => {
    try {
        const body = scanSchema.parse(req.body);
        const code = normalizeCode(body.code);
        if (!code)
            apiError(400, 'EMPTY_CODE', 'Scan code is empty after normalization.');
        const db = getSqlite();
        // Look up participant by gun_number (stored uppercase)
        const participant = db.prepare(`
      SELECT p.*, c.name as category_name
      FROM participants p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.gun_number = ?
    `).get(code);
        if (!participant) {
            res.status(404).json({
                error: { code: 'UNKNOWN_CODE', message: `No participant found for barcode "${code}".` },
            });
            return;
        }
        // Duplicate scan window check
        const windowSetting = db.prepare("SELECT value FROM settings WHERE key = 'duplicate_scan_window_seconds'").get();
        const windowSecs = parseInt(windowSetting?.value ?? '5', 10);
        const windowStart = new Date(Date.now() - windowSecs * 1000).toISOString();
        if (!body.confirm) {
            const recentScan = effectiveTransactions(db, participant.id)
                .filter((row) => row.created_at >= windowStart && row.status !== 'voided')
                .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
            if (recentScan) {
                res.status(409).json({
                    error: { code: 'DUPLICATE_SCAN', message: 'This pouch was just scanned. Confirm to proceed.', needsConfirmation: true },
                });
                return;
            }
        }
        // Toggle pouch status and insert transaction atomically
        const newStatus = participant.pouch_status === 'in' ? 'out' : 'in';
        const txType = newStatus; // transaction type = new status
        const now = new Date().toISOString();
        const doScan = db.transaction(() => {
            db.prepare('UPDATE participants SET pouch_status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, participant.id);
            const txResult = db.prepare(`
        INSERT INTO transactions (participant_id, gun_number, type, created_at, user_id, manual_entry)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(participant.id, participant.gun_number, txType, now, req.user.id, body.manual ? 1 : 0);
            return txResult.lastInsertRowid;
        });
        const txId = doScan();
        res.json({
            participant: {
                id: participant.id,
                bib_number: participant.bib_number,
                name: participant.name,
                noc: participant.noc,
                gun_number: participant.gun_number,
                category_name: participant.category_name,
                pouch_status: newStatus,
            },
            new_status: newStatus,
            transaction_id: txId,
            transaction_time: now,
        });
    }
    catch (err) {
        next(err);
    }
});
// ─── GET /api/scan/summary ────────────────────────────────────────────────────
scanRouter.get('/summary', (req, res, next) => {
    try {
        const db = getSqlite();
        const inCount = db.prepare("SELECT COUNT(*) as c FROM participants WHERE pouch_status = 'in'").get().c;
        const outCount = db.prepare("SELECT COUNT(*) as c FROM participants WHERE pouch_status = 'out'").get().c;
        const total = inCount + outCount;
        const printed = db.prepare('SELECT COUNT(*) as c FROM participants WHERE label_printed = 1 AND label_stale = 0').get().c;
        const unprinted = db.prepare('SELECT COUNT(*) as c FROM participants WHERE label_printed = 0').get().c;
        const stale = db.prepare('SELECT COUNT(*) as c FROM participants WHERE label_stale = 1').get().c;
        res.json({ in: inCount, out: outCount, total, printed, unprinted, stale });
    }
    catch (err) {
        next(err);
    }
});
// ─── GET /api/scan/recent ─────────────────────────────────────────────────────
scanRouter.get('/recent', (req, res, next) => {
    try {
        const db = getSqlite();
        const rows = effectiveTransactions(db).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10);
        res.json({ data: rows });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=scan.js.map