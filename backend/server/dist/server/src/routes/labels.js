import { Router } from 'express';
import { getSqlite } from '../db/connection.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { apiError } from '../middleware/errorHandler.js';
import { printLabelsSchema } from '../../../shared/schemas.js';
import { LABEL_LAYOUT } from '../../../shared/label.js';
import { buildBatchZpl, buildLabelZpl, LabelValidationError } from '../services/zpl.js';
import { printZpl, PrinterError } from '../services/printer.js';
import { getLabelConfigFromDb } from './printing.js';
export const labelsRouter = Router();
labelsRouter.use(requireAuth);
function formatParticipant(p) {
    return {
        id: p.id,
        bib_number: p.bib_number,
        noc: p.noc,
        name: p.name,
        department: p.department,
        gun_number: p.gun_number,
        contact_number: p.contact_number,
        category_id: p.category_id,
        category_name: p.category_name ?? null,
        pouch_status: p.pouch_status,
        label_printed: Boolean(p.label_printed),
        label_stale: Boolean(p.label_stale),
        label_printed_at: p.label_printed_at ?? null,
        created_at: p.created_at,
        updated_at: p.updated_at,
    };
}
// ─── POST /api/labels/print ───────────────────────────────────────────────────
labelsRouter.post('/print', requirePermission('barcodes.print'), async (req, res, next) => {
    const db = getSqlite();
    const body = printLabelsSchema.parse(req.body);
    const { labelConfig, printerName, driverOverride } = getLabelConfigFromDb(db);
    const now = new Date().toISOString();
    const targetPrinter = printerName || 'Default / File';
    try {
        let participants = [];
        if (body.selection.type === 'ids') {
            const ids = body.selection.ids;
            if (!ids.length) {
                apiError(400, 'EMPTY_SELECTION', 'No participant IDs provided.');
            }
            const placeholders = ids.map(() => '?').join(',');
            participants = db.prepare(`
        SELECT p.*, c.name as category_name
        FROM participants p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id IN (${placeholders})
        ORDER BY p.bib_number ASC
      `).all(...ids);
        }
        else if (body.selection.type === 'filter') {
            const filter = body.selection.filter;
            const conditions = [];
            const params = [];
            if (filter.search) {
                conditions.push('(p.bib_number LIKE ? OR p.name LIKE ? OR p.noc LIKE ? OR p.gun_number LIKE ?)');
                const s = `%${filter.search}%`;
                params.push(s, s, s, s);
            }
            if (filter.noc) {
                conditions.push('p.noc = ?');
                params.push(filter.noc.toUpperCase());
            }
            if (filter.department) {
                conditions.push('p.department = ?');
                params.push(filter.department);
            }
            if (filter.categoryId) {
                conditions.push('p.category_id = ?');
                params.push(filter.categoryId);
            }
            if (filter.pouchStatus) {
                conditions.push('p.pouch_status = ?');
                params.push(filter.pouchStatus);
            }
            const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
            participants = db.prepare(`
        SELECT p.*, c.name as category_name
        FROM participants p
        LEFT JOIN categories c ON c.id = p.category_id
        ${where}
        ORDER BY p.bib_number ASC
      `).all(...params);
        }
        else if (body.selection.type === 'unprinted') {
            participants = db.prepare(`
        SELECT p.*, c.name as category_name
        FROM participants p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.label_printed = 0
        ORDER BY p.bib_number ASC
      `).all();
        }
        if (!participants.length) {
            apiError(400, 'EMPTY_SELECTION', 'No participants match the selected print criteria.');
        }
        if (participants.length > 500) {
            apiError(400, 'TOO_MANY_LABELS', 'Maximum 500 labels per print job.');
        }
        // Check if reprint
        const hasReprint = participants.some((p) => Boolean(p.label_printed));
        const reason = body.reason?.trim();
        if (hasReprint && (!reason || reason.length < 3)) {
            apiError(400, 'REASON_REQUIRED', 'Reprint reason is required (minimum 3 characters).');
        }
        const jobKind = hasReprint ? 'reprint' : 'print';
        // Chunk into batches of 100 labels for spooler writes
        const CHUNK_SIZE = 100;
        let lastResult = null;
        for (let i = 0; i < participants.length; i += CHUNK_SIZE) {
            const chunk = participants.slice(i, i + CHUNK_SIZE);
            const zpl = buildBatchZpl(chunk, labelConfig);
            lastResult = await printZpl(zpl, { printerName, driverOverride });
        }
        // Record successful job and update participant flags atomically
        let jobId = 0;
        const executeDb = db.transaction(() => {
            const jobResult = db.prepare(`
        INSERT INTO print_jobs (user_id, created_at, kind, label_count, reason, status, error, printer_name)
        VALUES (?, ?, ?, ?, ?, 'sent', NULL, ?)
      `).run(req.user.id, now, jobKind, participants.length, reason || null, lastResult?.target ?? targetPrinter);
            jobId = Number(jobResult.lastInsertRowid);
            const insertItem = db.prepare(`
        INSERT INTO print_job_items (job_id, participant_id, gun_number)
        VALUES (?, ?, ?)
      `);
            const updateParticipant = db.prepare(`
        UPDATE participants
        SET label_printed = 1, label_stale = 0, label_printed_at = ?, updated_at = ?
        WHERE id = ?
      `);
            for (const p of participants) {
                insertItem.run(jobId, p.id, p.gun_number);
                updateParticipant.run(now, now, p.id);
            }
            db.prepare(`
        INSERT INTO activity_log (user_id, action, entity, entity_id, new_values, created_at)
        VALUES (?, 'PRINT_LABELS', 'print_job', ?, ?, ?)
      `).run(req.user.id, String(jobId), JSON.stringify({
                kind: jobKind,
                count: participants.length,
                reason: reason || null,
                target: lastResult?.target ?? targetPrinter,
            }), now);
        });
        executeDb();
        res.json({
            jobId,
            count: participants.length,
            status: 'sent',
            driver: lastResult?.driver ?? 'file',
        });
    }
    catch (err) {
        // Record failed job without updating participant flags
        if (err.name !== 'ZodError' && err.code !== 'EMPTY_SELECTION' && err.code !== 'TOO_MANY_LABELS' && err.code !== 'REASON_REQUIRED') {
            try {
                db.prepare(`
          INSERT INTO print_jobs (user_id, created_at, kind, label_count, reason, status, error, printer_name)
          VALUES (?, ?, 'print', 0, NULL, 'failed', ?, ?)
        `).run(req.user.id, now, err.message ?? 'Print failed', targetPrinter);
            }
            catch {
                // Ignore failure to record failed job
            }
        }
        if (err instanceof LabelValidationError) {
            apiError(400, err.code, err.message);
        }
        else if (err instanceof PrinterError) {
            apiError(400, err.code, err.message);
        }
        else {
            next(err);
        }
    }
});
// ─── GET /api/labels/preview/:participantId ───────────────────────────────────
labelsRouter.get('/preview/:participantId', requirePermission('barcodes.print'), (req, res, next) => {
    try {
        const id = parseInt(String(req.params.participantId), 10);
        if (isNaN(id))
            apiError(400, 'INVALID_ID', 'Invalid participant ID');
        const db = getSqlite();
        const participant = db.prepare(`
      SELECT p.*, c.name as category_name
      FROM participants p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?
    `).get(id);
        if (!participant) {
            apiError(404, 'NOT_FOUND', 'Participant not found');
        }
        const { labelConfig } = getLabelConfigFromDb(db);
        const canManageSettings = req.user?.role === 'admin' || req.user?.permissions.includes('settings.manage');
        let zpl;
        if (canManageSettings) {
            try {
                zpl = buildLabelZpl(participant, labelConfig);
            }
            catch {
                // Leave undefined if too wide
            }
        }
        res.json({
            participant: formatParticipant(participant),
            layout: LABEL_LAYOUT,
            zpl,
        });
    }
    catch (err) {
        next(err);
    }
});
// ─── GET /api/labels/jobs ─────────────────────────────────────────────────────
labelsRouter.get('/jobs', requirePermission('barcodes.print'), (_req, res, next) => {
    try {
        const db = getSqlite();
        const jobs = db.prepare(`
      SELECT pj.*, u.full_name as user_name
      FROM print_jobs pj
      LEFT JOIN users u ON u.id = pj.user_id
      ORDER BY pj.created_at DESC
      LIMIT 50
    `).all();
        res.json({ data: jobs });
    }
    catch (err) {
        next(err);
    }
});
// ─── GET /api/labels/summary ──────────────────────────────────────────────────
labelsRouter.get('/summary', requirePermission('barcodes.print'), (_req, res, next) => {
    try {
        const db = getSqlite();
        const total = db.prepare('SELECT COUNT(*) as c FROM participants').get().c;
        const printed = db.prepare('SELECT COUNT(*) as c FROM participants WHERE label_printed = 1 AND label_stale = 0').get().c;
        const unprinted = db.prepare('SELECT COUNT(*) as c FROM participants WHERE label_printed = 0').get().c;
        const stale = db.prepare('SELECT COUNT(*) as c FROM participants WHERE label_stale = 1').get().c;
        res.json({ total, printed, unprinted, stale });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=labels.js.map