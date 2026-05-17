import { config } from "dotenv";
import pg from "pg";

config();

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || "postgresql://localhost:5432/bodaboda";

const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
});

export default pool;
