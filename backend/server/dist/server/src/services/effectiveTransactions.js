export function effectiveTransactions(db, participantId) {
    const latestCorrections = db.prepare(`
    SELECT c.* FROM corrections c
    JOIN (SELECT transaction_id, MAX(id) AS max_id FROM corrections WHERE transaction_id IS NOT NULL GROUP BY transaction_id) latest
      ON latest.max_id = c.id
  `).all();
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
    const addRows = db.prepare(`SELECT c.* FROM corrections c WHERE c.action = 'add'`).all();
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
export function resultingPouchStatus(rows) {
    return rows.filter((row) => row.status !== 'voided').at(-1)?.type ?? 'in';
}
//# sourceMappingURL=effectiveTransactions.js.map