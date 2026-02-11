// Quick migration runner for Azure PostgreSQL
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 
    'postgres://flowgridadmin:FlowGrid2026!Staging@flowgrid-db-staging.postgres.database.azure.com:5432/flowgrid?sslmode=require'
});

async function runMigration(file) {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8');
  console.log(`Running migration: ${file}`);
  try {
    await pool.query(sql);
    console.log(`✅ Migration ${file} completed`);
  } catch (err) {
    console.error(`❌ Migration ${file} failed:`, err.message);
    // Continue anyway for partial migrations
  }
}

async function main() {
  const migrationFile = process.argv[2] || '003_auth_enterprise.sql';
  
  try {
    await runMigration(migrationFile);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
