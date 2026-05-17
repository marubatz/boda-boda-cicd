import fs from "fs/promises";
import path from "path";
import pool from "./db.js";

const schemaPath = path.join(process.cwd(), "server", "data", "schema.sql");

const runMigration = async () => {
  try {
    const schema = await fs.readFile(schemaPath, "utf8");
    await pool.query(schema);
    console.log("Database schema created/updated successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
};

runMigration();
