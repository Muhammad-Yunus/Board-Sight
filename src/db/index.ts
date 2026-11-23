import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

const {
  DB_HOST,
  DB_PORT = '5432',
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  DB_SSL = 'true',
} = process.env;

if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) {
  throw new Error(
    'Missing required PostgreSQL environment variables: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD'
  );
}

export const pool = new Pool({
  host: DB_HOST,
  port: Number(DB_PORT),
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  ssl: DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const db = drizzle(pool, { schema });
