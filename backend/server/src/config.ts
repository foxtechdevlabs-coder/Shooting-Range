import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  host: process.env.HOST ?? '127.0.0.1',
  get dataDir() {
    return process.env.DATA_DIR
      ? path.resolve(process.env.DATA_DIR)
      : path.resolve(__dirname, '../../data')
  },
  get dbPath() {
    return process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(this.dataDir, 'shootingrange.db')
  },
  isProduction: process.env.NODE_ENV === 'production',
  cookieSecret: process.env.COOKIE_SECRET ?? 'dev-secret-change-in-production',
  sessionMaxAgeDays: 7,
  loginRateLimitWindowMs: 5 * 60 * 1000, // 5 minutes
  loginRateLimitMax: 5,
  uploadRateLimitWindowMs: 60 * 1000,
  uploadRateLimitMax: 10,
}
