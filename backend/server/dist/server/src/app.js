import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { categoriesRouter } from './routes/categories.js';
import { participantsRouter } from './routes/participants.js';
import { scanRouter } from './routes/scan.js';
import { transactionsRouter } from './routes/transactions.js';
import { settingsRouter } from './routes/settings.js';
import { printingRouter } from './routes/printing.js';
import { labelsRouter } from './routes/labels.js';
import { correctionsRouter } from './routes/corrections.js';
import { reportsRouter } from './routes/reports.js';
import { activityRouter } from './routes/activity.js';
import { backupRouter, fullExportRouter, resetDemoRouter } from './routes/backup.js';
import { errorHandler } from './middleware/errorHandler.js';
export function createApp() {
    const app = express();
    // Security headers (no CORS — served same-origin via Vite proxy in dev, same origin in prod)
    app.use(helmet({
        contentSecurityPolicy: false, // Let frontend handle CSP
    }));
    // Request size limits
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: false, limit: '1mb' }));
    app.use(cookieParser());
    // Rate limit on auth endpoints
    const authLimiter = rateLimit({
        windowMs: 5 * 60 * 1000,
        max: 20,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } },
    });
    const uploadLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
    });
    // Health check
    app.get('/api/health', (_req, res) => { res.json({ ok: true, ts: new Date().toISOString() }); });
    // Routes
    app.use('/api/auth', authLimiter, authRouter);
    app.use('/api/users', usersRouter);
    app.use('/api/categories', categoriesRouter);
    app.use('/api/participants/import', uploadLimiter);
    app.use('/api/participants', participantsRouter);
    app.use('/api/scan', scanRouter);
    app.use('/api/transactions', transactionsRouter);
    app.use('/api', correctionsRouter);
    app.use('/api/activity', activityRouter);
    app.use('/api/reports', reportsRouter);
    app.use('/api/backup', backupRouter);
    app.use('/api/export', fullExportRouter);
    app.use('/api/settings', resetDemoRouter);
    app.use('/api/settings', settingsRouter);
    app.use('/api/printing', printingRouter);
    app.use('/api/labels', labelsRouter);
    // 404 for unknown API routes
    app.use('/api', (_req, res) => {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } });
    });
    // Global error handler (must be last)
    app.use(errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map