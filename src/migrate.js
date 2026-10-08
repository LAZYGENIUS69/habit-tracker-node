/**
 * Runs every .sql file in migrations/ in filename order, once.
 * Applied files are recorded in the schema_migrations table.
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function run() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const { rowCount } = await db.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1', [file],
    );
    if (rowCount > 0) {
      console.log(`  skip  ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.query(sql);
    await db.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    console.log(`  applied ${file}`);
  }
  console.log('migrations done');
  await db.pool.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
