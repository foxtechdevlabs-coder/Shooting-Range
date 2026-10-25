import { Router } from 'express';
import { getSqlite } from '../db/connection.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { effectiveTransactionSelect } from '../services/effectiveTransactions.js';
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requirePermission('participants.view'));
dashboardRouter.get('/summary', (_req, res, next) => {
    try {
        const db = getSqlite();
        const statusCounts = db.prepare(`SELECT pouch_status AS status, COUNT(*) AS count
      FROM participants GROUP BY pouch_status`).all();
        const categories = db.prepare(`SELECT c.name, COUNT(p.id) AS value
      FROM participants p LEFT JOIN categories c ON c.id = p.category_id
      GROUP BY c.id, c.name ORDER BY c.name`).all();
        const effective = effectiveTransactionSelect("date(COALESCE(json_extract(c.new_values, '$.created_at'), t.created_at), 'localtime') = date('now', 'localtime')");
        const today = db.prepare(`SELECT COUNT(*) AS total FROM (${effective}) effective_rows WHERE status != 'voided'`).get();
        const hourly = db.prepare(`SELECT CAST(strftime('%H', created_at, 'localtime') AS INTEGER) AS hour,
        SUM(CASE WHEN type = 'in' THEN 1 ELSE 0 END) AS checkIn,
        SUM(CASE WHEN type = 'out' THEN 1 ELSE 0 END) AS checkOut
      FROM (${effective}) effective_rows WHERE status != 'voided' GROUP BY hour ORDER BY hour`).all();
        const recent = db.prepare(`SELECT id, user_id, type, participant_name, gun_number, created_at, user_name
      FROM (${effectiveTransactionSelect()}) effective_rows
      WHERE status != 'voided' ORDER BY created_at DESC, id DESC LIMIT 5`).all();
        const counts = { in: 0, out: 0 };
        for (const row of statusCounts)
            counts[row.status] = row.count;
        res.json({
            total: counts.in + counts.out,
            ...counts,
            todayTransactions: today.total,
            categories: categories.map((row) => ({ name: row.name ?? 'Uncategorized', value: row.value })),
            hourly,
            recent: recent.map((row) => ({
                id: row.id,
                user_id: row.user_id,
                action: row.type === 'in' ? 'Checked in' : 'Checked out',
                entity: 'Participant',
                details: `${row.participant_name ?? 'Participant'} · ${row.gun_number}`,
                created_at: row.created_at,
                user_name: row.user_name,
            })),
        });
    }
    catch (error) {
        next(error);
    }
});
//# sourceMappingURL=dashboard.js.map