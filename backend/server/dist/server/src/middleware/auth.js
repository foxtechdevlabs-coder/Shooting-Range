import { getSqlite } from '../db/connection.js';
export function requireAuth(req, res, next) {
    const sessionId = req.cookies?.session_id;
    if (!sessionId) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
        return;
    }
    const db = getSqlite();
    const now = new Date().toISOString();
    // Look up session
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session || session.expires_at < now) {
        // Clear stale session
        if (session)
            db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
        res.clearCookie('session_id');
        res.status(401).json({ error: { code: 'SESSION_EXPIRED', message: 'Your session has expired. Please sign in again.' } });
        return;
    }
    // Idle timeout: check last_seen_at
    const idleTimeoutSetting = db.prepare("SELECT value FROM settings WHERE key = 'idle_timeout_minutes'").get();
    const idleMinutes = parseInt(idleTimeoutSetting?.value ?? '15', 10);
    const idleDeadline = new Date(Date.now() - idleMinutes * 60 * 1000).toISOString();
    if (session.last_seen_at < idleDeadline) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
        res.clearCookie('session_id');
        res.status(401).json({ error: { code: 'SESSION_IDLE_TIMEOUT', message: 'Your session timed out due to inactivity. Please sign in again.' } });
        return;
    }
    // Load user
    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
    if (!userRow || !userRow.active) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
        res.clearCookie('session_id');
        res.status(401).json({ error: { code: 'ACCOUNT_DISABLED', message: 'This account has been disabled.' } });
        return;
    }
    // Slide the session last_seen_at
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, sessionId);
    const permissions = JSON.parse(userRow.permissions ?? '[]');
    req.user = {
        id: userRow.id,
        full_name: userRow.full_name,
        username: userRow.username,
        role: userRow.role,
        permissions,
        active: userRow.active,
        must_change_password: userRow.must_change_password,
    };
    req.sessionId = sessionId;
    next();
}
export function requirePermission(...permissions) {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
            return;
        }
        const user = req.user;
        const hasPermission = user.role === 'admin' ||
            permissions.every((p) => user.permissions.includes(p));
        if (!hasPermission) {
            res.status(403).json({
                error: {
                    code: 'FORBIDDEN',
                    message: `You do not have permission to perform this action. Required: ${permissions.join(', ')}`,
                },
            });
            return;
        }
        next();
    };
}
export function requireAdmin(req, res, next) {
    if (!req.user) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
        return;
    }
    if (req.user.role !== 'admin') {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Administrator access is required.' } });
        return;
    }
    next();
}
//# sourceMappingURL=auth.js.map