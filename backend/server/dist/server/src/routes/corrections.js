import { Router } from 'express';
import { z } from 'zod';
import { getSqlite } from '../db/connection.js';
import { requireAdmin, requireAuth, requirePermission } from '../middleware/auth.js';
import { apiError } from '../middleware/errorHandler.js';
import { effectiveTransactions, resultingPouchStatus } from '../services/effectiveTransactions.js';
export const correctionsRouter = Router();
correctionsRouter.use(requireAuth);
const correctionBaseSchema = z.object({
    action: z.enum(['edit', 'void', 'add']),
    transactionId: z.coerce.number().int().positive().optional(),
    participantId: z.coerce.number().int().positive().optional(),
    newType: z.enum(['in', 'out']).optional(),
    newTimestamp: z.string().datetime({ offset: true }).optional(),
    reason: z.string().trim().min(3).optional(),
});
function validateCorrectionInput(value, context) {
    if (value.action === 'edit' && (!value.transactionId || (!value.newType && !value.newTimestamp))) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Edit requires a transaction ID and a new type or timestamp.' });
    }
    if (value.action === 'void' && !value.transactionId) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Void requires a transaction ID.' });
    }
    if (value.action === 'add' && (!value.participantId || !value.newType)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Add requires a participant ID and transaction type.' });
    }
}
const correctionSchema = correctionBaseSchema.superRefine(validateCorrectionInput);
const correctionSaveSchema = correctionBaseSchema.extend({ reason: z.string().trim().min(3) }).superRefine(validateCorrectionInput);
function preview(input) {
    const db = getSqlite();
    let participantId = input.participantId ?? 0;
    let oldValues = null;
    let newValues = {};
    let sequence;
    if (input.action === 'add') {
        const participant = db.prepare('SELECT id, gun_number FROM participants WHERE id = ?').get(participantId);
        if (!participant)
            apiError(404, 'PARTICIPANT_NOT_FOUND', 'Participant not found.');
        const type = input.newType;
        const createdAt = input.newTimestamp ? new Date(input.newTimestamp).toISOString() : new Date().toISOString();
        newValues = { participant_id: participant.id, gun_number: participant.gun_number, type, created_at: createdAt };
        sequence = effectiveTransactions(db, participantId);
        sequence.push({
            id: 0, participant_id: participantId, gun_number: participant.gun_number, type, created_at: createdAt,
            user_id: null, manual_entry: 1, source: 'correction', status: 'corrected',
        });
    }
    else {
        const transactionId = input.transactionId;
        const current = effectiveTransactions(db).find((row) => row.id === transactionId);
        if (!current)
            apiError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found.');
        if (current.status === 'voided')
            apiError(409, 'TRANSACTION_VOIDED', 'A voided transaction cannot be corrected again.');
        participantId = current.participant_id;
        oldValues = { type: current.type, created_at: current.created_at, status: current.status };
        if (input.action === 'void') {
            newValues = { voided: true };
        }
        else {
            newValues = {
                ...(input.newType ? { type: input.newType } : {}),
                ...(input.newTimestamp ? { created_at: new Date(input.newTimestamp).toISOString() } : {}),
            };
        }
        sequence = effectiveTransactions(db, participantId).map((row) => row.id === current.id
            ? { ...row, type: newValues.type ?? row.type, created_at: newValues.created_at ?? row.created_at, status: input.action === 'void' ? 'voided' : 'corrected' }
            : row);
    }
    sequence.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
    const activeSequence = sequence.filter((row) => row.status !== 'voided');
    const validationErrors = [];
    activeSequence.forEach((row, index) => {
        const expected = index % 2 === 0 ? 'out' : 'in';
        if (row.type !== expected) {
            validationErrors.push(`Transaction ${row.id > 0 ? `#${row.id}` : '(new)'} at ${row.created_at} is ${row.type}; expected ${expected} at position ${index + 1}.`);
        }
    });
    return { oldValues, newValues, sequence, pouchStatus: resultingPouchStatus(sequence), validationErrors, participantId };
}
correctionsRouter.post('/transactions/corrections/preview', requirePermission('transactions.correct'), (req, res, next) => {
    try {
        const input = correctionSchema.parse(req.body);
        res.json(preview(input));
    }
    catch (error) {
        next(error);
    }
});
correctionsRouter.post('/transactions/corrections', requirePermission('transactions.correct'), (req, res, next) => {
    try {
        const input = correctionSaveSchema.parse(req.body);
        const result = preview(input);
        if (result.validationErrors.length)
            apiError(409, 'INVALID_TRANSACTION_SEQUENCE', result.validationErrors[0], { sequence: result.validationErrors.join(' ') });
        const db = getSqlite();
        const now = new Date().toISOString();
        const commit = db.transaction(() => {
            let transactionId = input.transactionId ?? null;
            if (input.action === 'add') {
                const values = result.newValues;
                const added = db.prepare(`INSERT INTO transactions (participant_id, gun_number, type, created_at, user_id, manual_entry, source)
          VALUES (?, ?, ?, ?, ?, 1, 'correction')`)
                    .run(values.participant_id, values.gun_number, values.type, values.created_at, req.user.id);
                transactionId = Number(added.lastInsertRowid);
                result.newValues.transaction_id = transactionId;
            }
            db.prepare(`INSERT INTO corrections (transaction_id, action, old_values, new_values, reason, user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
                .run(input.action === 'add' ? null : transactionId, input.action, result.oldValues ? JSON.stringify(result.oldValues) : null, JSON.stringify(result.newValues), input.reason, req.user.id, now);
            db.prepare('UPDATE participants SET pouch_status = ?, updated_at = ? WHERE id = ?').run(result.pouchStatus, now, result.participantId);
            db.prepare(`INSERT INTO activity_log (user_id, action, entity, entity_id, old_values, new_values, created_at)
        VALUES (?, 'CORRECT_TRANSACTION', 'transaction', ?, ?, ?, ?)`)
                .run(req.user.id, String(transactionId ?? ''), result.oldValues ? JSON.stringify(result.oldValues) : null, JSON.stringify({ action: input.action, ...result.newValues, reason: input.reason }), now);
            return transactionId;
        });
        const transactionId = commit();
        const updated = effectiveTransactions(db, result.participantId).find((row) => row.id === transactionId || (input.action === 'add' && row.source === 'correction' && row.corrected_at === now));
        res.status(201).json({ transaction: updated, pouchStatus: result.pouchStatus });
    }
    catch (error) {
        next(error);
    }
});
correctionsRouter.get('/corrections', requireAdmin, (req, res, next) => {
    try {
        const query = z.object({
            from: z.string().optional(), to: z.string().optional(), user_id: z.coerce.number().int().positive().optional(),
            page: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().positive().max(200).default(50),
        }).parse(req.query);
        const db = getSqlite();
        const conditions = [];
        const params = [];
        if (query.from) {
            conditions.push('c.created_at >= ?');
            params.push(`${query.from}T00:00:00.000Z`);
        }
        if (query.to) {
            conditions.push('c.created_at <= ?');
            params.push(`${query.to}T23:59:59.999Z`);
        }
        if (query.user_id) {
            conditions.push('c.user_id = ?');
            params.push(query.user_id);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const total = db.prepare(`SELECT COUNT(*) AS count FROM corrections c ${where}`).get(...params).count;
        const data = db.prepare(`SELECT c.*, u.full_name AS user_name,
      COALESCE(t.participant_id, CAST(json_extract(c.new_values, '$.participant_id') AS INTEGER)) AS participant_id,
      p.name AS participant_name, p.bib_number
      FROM corrections c LEFT JOIN users u ON u.id = c.user_id
      LEFT JOIN transactions t ON t.id = c.transaction_id
      LEFT JOIN participants p ON p.id = COALESCE(t.participant_id, CAST(json_extract(c.new_values, '$.participant_id') AS INTEGER))
      ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`).all(...params, query.limit, query.page * query.limit);
        res.json({ data, total, page: query.page, limit: query.limit });
    }
    catch (error) {
        next(error);
    }
});
//# sourceMappingURL=corrections.js.map