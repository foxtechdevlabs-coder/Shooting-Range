export function effectiveTransactions(db, participantId) {
    const latestCorrectionSql = `
    SELECT c.* FROM corrections c
    JOIN (SELECT transaction_id, MAX(id) AS max_id FROM corrections
      WHERE transaction_id IN (SELECT id FROM transactions ${participantId ? 'WHERE participant_id = ?' : ''})
      GROUP BY transaction_id) latest ON latest.max_id = c.id
  `;
    const latestCorrections = db.prepare(latestCorrectionSql).all(...(participantId ? [participantId] : []));
    const correctionByTransaction = new Map(latestCorrections.map((row) => [row.transaction_id, row]));
    const baseRows = db.prepare(`
    SELECT t.*, p.name AS participant_name, p.bib_number, p.noc, u.full_name AS user_name
    FROM transactions t
    LEFT JOIN participants p ON p.id = t.participant_id
    LEFT JOIN users u ON u.id = t.user_id
    ${participantId ? 'WHERE t.participant_id = ?' : ''}
  `).all(...(participantId ? [participantId] : []));
    const rows = baseRows.map((row) => {
        const correction = correctionByTransaction.get(row.id);
        if (!correction)
            return { ...row, status: row.source === 'correction' ? 'corrected' : 'valid' };
        const values = JSON.parse(correction.new_values);
        return {
            ...row,
            type: values.type ?? row.type,
            created_at: values.created_at ?? row.created_at,
            status: correction.action === 'void' || values.voided ? 'voided' : 'corrected',
            original_type: row.type,
            correction_reason: correction.reason,
            corrected_by: correction.user_id ?? undefined,
            corrected_at: correction.created_at,
        };
    });
    const addRows = db.prepare(`SELECT c.* FROM corrections c WHERE c.action = 'add'
    ${participantId ? "AND CAST(json_extract(c.new_values, '$.participant_id') AS INTEGER) = ?" : ''}`)
        .all(...(participantId ? [participantId] : []));
    for (const correction of addRows) {
        const values = JSON.parse(correction.new_values);
        if (participantId && values.participant_id !== participantId)
            continue;
        const insertedRow = values.transaction_id ? rows.find((row) => row.id === values.transaction_id) : undefined;
        if (insertedRow) {
            insertedRow.status = 'corrected';
            insertedRow.correction_reason = correction.reason;
            insertedRow.corrected_by = correction.user_id ?? undefined;
            insertedRow.corrected_at = correction.created_at;
            continue;
        }
        const participant = db.prepare('SELECT name, bib_number, noc FROM participants WHERE id = ?').get(values.participant_id);
        const user = correction.user_id ? db.prepare('SELECT full_name FROM users WHERE id = ?').get(correction.user_id) : undefined;
        rows.push({
            id: -correction.id,
            participant_id: values.participant_id,
            gun_number: values.gun_number,
            type: values.type,
            created_at: values.created_at,
            user_id: correction.user_id,
            manual_entry: 1,
            source: 'correction',
            participant_name: participant?.name,
            bib_number: participant?.bib_number,
            noc: participant?.noc,
            user_name: user?.full_name,
            status: 'corrected',
            correction_reason: correction.reason,
            corrected_by: correction.user_id ?? undefined,
            corrected_at: correction.created_at,
        });
    }
    return rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
}
export function effectiveTransactionSelect(where = '1 = 1') {
    return `SELECT t.id, t.participant_id, t.gun_number,
      COALESCE(json_extract(c.new_values, '$.type'), t.type) AS type,
      COALESCE(json_extract(c.new_values, '$.created_at'), t.created_at) AS created_at,
      t.user_id, t.manual_entry, t.source, p.name AS participant_name, p.bib_number, p.noc, u.full_name AS user_name,
      CASE WHEN c.action = 'void' OR json_extract(c.new_values, '$.voided') = 1 THEN 'voided'
        WHEN c.id IS NOT NULL OR t.source = 'correction' THEN 'corrected' ELSE 'valid' END AS status,
      t.type AS original_type, c.reason AS correction_reason, c.user_id AS corrected_by, c.created_at AS corrected_at
    FROM transactions t
    LEFT JOIN participants p ON p.id = t.participant_id
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN (SELECT transaction_id, MAX(id) AS max_id FROM corrections
      WHERE transaction_id IS NOT NULL GROUP BY transaction_id) latest ON latest.transaction_id = t.id
    LEFT JOIN corrections c ON c.id = latest.max_id
    WHERE ${where}`;
}
export function iterateEffectiveTransactions(db, where = '1 = 1', params = [], orderBy = 'created_at ASC, t.id ASC') {
    return db.prepare(`${effectiveTransactionSelect(where)} ORDER BY ${orderBy}`).iterate(...params);
}
export function resultingPouchStatus(rows) {
    return rows.filter((row) => row.status !== 'voided').at(-1)?.type ?? 'in';
}
//# sourceMappingURL=effectiveTransactions.js.map