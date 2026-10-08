const { createClient } = require('redis');

let client = null;

async function getClient() {
  if (client) return client;
  client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (e) => console.error('redis error', e.message));
  await client.connect();
  return client;
}

/** Cache a habit's computed streak. Expires at the end of the day. */
async function setStreak(habitId, value, ttlSeconds) {
  const c = await getClient();
  await c.set(`streak:${habitId}`, JSON.stringify(value), { EX: ttlSeconds });
}

async function getStreak(habitId) {
  const c = await getClient();
  const raw = await c.get(`streak:${habitId}`);
  return raw ? JSON.parse(raw) : null;
}

async function invalidate(habitId) {
  const c = await getClient();
  await c.del(`streak:${habitId}`);
}

module.exports = { getClient, setStreak, getStreak, invalidate };
