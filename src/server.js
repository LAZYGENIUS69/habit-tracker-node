const express = require('express');
const db = require('./db');
const cache = require('./cache');
const { currentStreak, longestStreak, toKey } = require('./streaks');

const app = express();
app.use(express.json());

const today = () => toKey(new Date());

/** Seconds until midnight UTC - how long a streak figure stays valid. */
function secondsUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.max(60, Math.floor((midnight - now) / 1000));
}

app.get('/health', async (req, res) => {
  const out = { status: 'ok', postgres: false, redis: false };
  try { await db.query('SELECT 1'); out.postgres = true; } catch (e) { out.pgError = e.message; }
  try { const c = await cache.getClient(); await c.ping(); out.redis = true; } catch (e) { out.redisError = e.message; }
  res.status(out.postgres && out.redis ? 200 : 503).json(out);
});

app.get('/', (req, res) => res.json({
  service: 'habit-tracker',
  endpoints: [
    'GET /health', 'GET /habits', 'POST /habits',
    'POST /habits/:id/tick', 'DELETE /habits/:id/tick',
  ],
}));

app.get('/habits', async (req, res) => {
  const { rows: habits } = await db.query(
    'SELECT id, name, schedule, freezes FROM habits ORDER BY id',
  );
  const out = [];
  for (const h of habits) {
    let stats = await cache.getStreak(h.id);
    let cached = true;
    if (!stats) {
      cached = false;
      const { rows } = await db.query(
        'SELECT day FROM ticks WHERE habit_id = $1 ORDER BY day', [h.id],
      );
      const days = rows.map((r) => toKey(new Date(r.day)));
      const cur = currentStreak(days, today(), { schedule: h.schedule, freezes: h.freezes });
      stats = {
        streak: cur.streak,
        freezesUsed: cur.freezesUsed,
        longest: longestStreak(days, { schedule: h.schedule }),
        tickedToday: days.includes(today()),
        totalTicks: days.length,
      };
      await cache.setStreak(h.id, stats, secondsUntilMidnight());
    }
    out.push({ ...h, ...stats, cached });
  }
  res.json({ today: today(), habits: out });
});

app.post('/habits', async (req, res) => {
  const { name, schedule = [], freezes = 2 } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const { rows } = await db.query(
    'INSERT INTO habits (name, schedule, freezes) VALUES ($1, $2, $3) RETURNING id, name, schedule, freezes',
    [String(name).trim(), schedule, freezes],
  );
  res.status(201).json(rows[0]);
});

app.post('/habits/:id/tick', async (req, res) => {
  const id = Number(req.params.id);
  const day = req.body?.day || today();
  const { rowCount } = await db.query('SELECT 1 FROM habits WHERE id = $1', [id]);
  if (!rowCount) return res.status(404).json({ error: 'no such habit' });

  await db.query(
    'INSERT INTO ticks (habit_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [id, day],
  );
  await cache.invalidate(id);
  res.status(201).json({ habitId: id, day, ticked: true });
});

app.delete('/habits/:id/tick', async (req, res) => {
  const id = Number(req.params.id);
  const day = req.query.day || today();
  const { rowCount } = await db.query(
    'DELETE FROM ticks WHERE habit_id = $1 AND day = $2', [id, day],
  );
  await cache.invalidate(id);
  res.json({ habitId: id, day, removed: rowCount });
});

if (require.main === module) {
  const port = process.env.PORT || 8080;
  // 0.0.0.0 so the container is reachable from outside
  app.listen(port, '0.0.0.0', () => console.log(`listening on ${port}`));
}

module.exports = app;
