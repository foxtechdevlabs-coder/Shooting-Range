export declare const config: {
    port: number;
    host: string;
    readonly dataDir: string;
    readonly dbPath: string;
    isProduction: boolean;
    cookieSecret: string;
    sessionMaxAgeDays: number;
    loginRateLimitWindowMs: number;
    loginRateLimitMax: number;
    uploadRateLimitWindowMs: number;
    uploadRateLimitMax: number;
};
