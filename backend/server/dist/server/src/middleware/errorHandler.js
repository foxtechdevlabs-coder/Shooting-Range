import { ZodError } from 'zod';
export function errorHandler(err, req, res, next) {
    // Already responded
    if (res.headersSent) {
        console.error('[ERROR]', err);
        next(err);
        return;
    }
    // Zod validation errors
    if (err instanceof ZodError) {
        console.warn('[WARN] VALIDATION_ERROR', err.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
        })));
        const fields = {};
        for (const issue of err.issues) {
            const key = issue.path.join('.');
            fields[key] = issue.message;
        }
        res.status(400).json({
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Validation failed. Check the fields below.',
                fields,
            },
        });
        return;
    }
    console.error('[ERROR]', err);
    // Known API errors with a status
    if (typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        typeof err.status === 'number' &&
        'code' in err &&
        typeof err.code === 'string') {
        const e = err;
        res.status(e.status).json({
            error: {
                code: e.code,
                message: typeof e.message === 'string' ? e.message : 'Request failed.',
                ...(e.fields ? { fields: e.fields } : {}),
            },
        });
        return;
    }
    // Standard Error instance (e.g., multer errors)
    if (err instanceof Error && (err.message === 'Only .xlsx files are accepted' || err.name === 'MulterError')) {
        res.status(400).json({
            error: {
                code: 'BAD_REQUEST',
                message: err.message,
            },
        });
        return;
    }
    // Generic 500
    res.status(500).json({
        error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred. Please try again.',
        },
    });
}
/** Helper: throw a structured API error */
export function apiError(status, code, message, fields) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw { status, code, message, fields };
}
//# sourceMappingURL=errorHandler.js.map