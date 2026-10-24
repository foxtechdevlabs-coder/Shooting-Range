/**
 * Global error handler.
 * Hides internal details; logs stack traces server-side only.
 * Always returns consistent { error: { code, message, fields? } } JSON.
 */
import type { Request, Response, NextFunction } from 'express';
export declare function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void;
/** Helper: throw a structured API error */
export declare function apiError(status: number, code: string, message: string, fields?: Record<string, string>): never;
