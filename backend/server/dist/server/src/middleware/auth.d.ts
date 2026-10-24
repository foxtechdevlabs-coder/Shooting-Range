/**
 * Session-based authentication middleware.
 * Validates the session cookie, enforces idle timeout, slides the session.
 */
import type { Request, Response, NextFunction } from 'express';
import type { Permission } from '../../../shared/permissions.js';
export interface AuthUser {
    id: number;
    full_name: string;
    username: string;
    role: 'admin' | 'staff';
    permissions: Permission[];
    active: boolean;
    must_change_password: boolean;
}
declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
            sessionId?: string;
        }
    }
}
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
export declare function requirePermission(...permissions: Permission[]): (req: Request, res: Response, next: NextFunction) => void;
export declare function requireAdmin(req: Request, res: Response, next: NextFunction): void;
