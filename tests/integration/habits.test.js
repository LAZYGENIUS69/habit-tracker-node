const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../src/db');
const cache = require('../../src/cache');
const { get, post, del } = require('./helpers');

describe('Habit Tracker API integration tests', () => {
  let createdHabitId = null;

  before(async () => {
    // 1. Ensure database migration 001_create_habits.sql has been applied
    const { rows: migrations } = await db.query(
      'SELECT filename FROM schema_migrations WHERE filename = $1',
      ['001_create_habits.sql'],
    );
    assert.equal(
      migrations.length,
      1,
      'Migration 001_create_habits.sql must be recorded in schema_migrations',
    );

    // 2. Ensure test isolation by purging any lingering test records from prior aborted runs
    await db.query("DELETE FROM habits WHERE name LIKE 'Integration Test%'");

    // 3. Verify server and downstream services are reachable before starting assertions
    let healthy = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const res = await get('/health');
        if (res.status === 200 && res.data?.status === 'ok') {
          healthy = true;
          break;
        }
      } catch {
        // App container may still be stabilizing
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(healthy, true, 'Server health check must report healthy before running suite');
  });

  after(async () => {
    // Clean up all test-created records
    try {
      if (createdHabitId) {
        await db.query('DELETE FROM habits WHERE id = $1', [createdHabitId]);
        await cache.invalidate(createdHabitId);
      }
      await db.query("DELETE FROM habits WHERE name LIKE 'Integration Test%'");
    } catch (err) {
      console.error('Error during integration test teardown:', err.message);
    } finally {
      // Close database and cache connections so the test runner process exits cleanly
      await db.pool.end();
      try {
        const redisClient = await cache.getClient();
        await redisClient.quit();
      } catch {
        // Redis client might already be disconnected
      }
    }
  });

  it('A. HEALTH: GET /health returns 200 with postgres and redis status true', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200, 'Health endpoint must respond with HTTP 200');
    assert.equal(res.data.status, 'ok', 'Status property must be "ok"');
    assert.equal(res.data.postgres, true, 'Postgres health check must be true');
    assert.equal(res.data.redis, true, 'Redis health check must be true');
  });

  it('B. CREATE HABIT: POST /habits creates a new habit record with schedule and freezes', async () => {
    const payload = {
      name: 'Integration Test Habit',
      schedule: [1, 3, 5],
      freezes: 2,
    };
    const res = await post('/habits', payload);

    assert.equal(res.status, 201, 'POST /habits must return HTTP 201 Created');
    assert.ok(res.data.id, 'Returned habit must contain an id property');
    assert.equal(typeof res.data.id, 'number', 'Habit id must be a number');
    assert.equal(res.data.name, 'Integration Test Habit', 'Habit name must match input');
    assert.deepEqual(res.data.schedule, [1, 3, 5], 'Habit schedule must match input');
    assert.equal(res.data.freezes, 2, 'Habit freezes must match input');

    createdHabitId = res.data.id;
  });

  it('C. GET HABITS: GET /habits returns habit list containing the created habit with required fields', async () => {
    const res = await get('/habits');

    assert.equal(res.status, 200, 'GET /habits must return HTTP 200');
    assert.ok(Array.isArray(res.data.habits), 'Response must have habits array');
    assert.ok(res.data.today, 'Response must contain today date string');

    const habit = res.data.habits.find((h) => h.id === createdHabitId);
    assert.ok(habit, `Created habit with ID ${createdHabitId} must be present in /habits`);

    // Verify all required contract fields
    assert.equal(habit.id, createdHabitId);
    assert.equal(habit.name, 'Integration Test Habit');
    assert.deepEqual(habit.schedule, [1, 3, 5]);
    assert.equal(habit.freezes, 2);
    assert.equal(typeof habit.streak, 'number', 'Habit must contain numeric streak');
    assert.equal(typeof habit.longest, 'number', 'Habit must contain numeric longest');
    assert.equal(typeof habit.tickedToday, 'boolean', 'Habit must contain boolean tickedToday');
    assert.equal(typeof habit.totalTicks, 'number', 'Habit must contain numeric totalTicks');

    // Initial state: no ticks added yet
    assert.equal(habit.totalTicks, 0, 'Initial totalTicks must be 0');
    assert.equal(habit.streak, 0, 'Initial streak must be 0');
  });

  it('D. TICK HABIT: POST /habits/:id/tick records a tick for an explicit deterministic date', async () => {
    const deterministicDate = '2026-10-14';
    const res = await post(`/habits/${createdHabitId}/tick`, { day: deterministicDate });

    assert.equal(res.status, 201, 'POST /habits/:id/tick must return HTTP 201 Created');
    assert.equal(res.data.habitId, createdHabitId, 'Response habitId must match created habit');
    assert.equal(res.data.day, deterministicDate, 'Response day must match submitted date');
    assert.equal(res.data.ticked, true, 'Response ticked flag must be true');
  });

  it('E. VERIFY DATABASE EFFECT: GET /habits and direct PostgreSQL query reflect the tick', async () => {
    // Verify through HTTP API
    const res = await get('/habits');
    assert.equal(res.status, 200);

    const habit = res.data.habits.find((h) => h.id === createdHabitId);
    assert.ok(habit, 'Habit must be present in /habits');
    assert.equal(habit.totalTicks, 1, 'Habit totalTicks must reflect 1 tick');

    // Direct database verification proves HTTP request -> Application -> PostgreSQL persistence
    const { rows: dbTicks } = await db.query(
      'SELECT habit_id, to_char(day, \'YYYY-MM-DD\') AS day_str FROM ticks WHERE habit_id = $1',
      [createdHabitId],
    );
    assert.equal(dbTicks.length, 1, 'PostgreSQL ticks table must contain exactly 1 row for habit');
    assert.equal(dbTicks[0].habit_id, createdHabitId);
    assert.equal(dbTicks[0].day_str, '2026-10-14', 'PostgreSQL tick date must match 2026-10-14');
  });

  it('F. VERIFY CACHE INVALIDATION: mutating tick state invalidates cache and serves fresh data', async () => {
    // 1. Prior GET populated cache in Redis for this habit.
    // Querying GET /habits should now report cached === true.
    const getCached = await get('/habits');
    const habitCached = getCached.data.habits.find((h) => h.id === createdHabitId);
    assert.equal(habitCached.cached, true, 'Habit streak should be served from cache on repeat GET');

    // 2. Add another deterministic tick for an earlier scheduled weekday (Monday 2026-10-12)
    const tickRes = await post(`/habits/${createdHabitId}/tick`, { day: '2026-10-12' });
    assert.equal(tickRes.status, 201);

    // 3. POST /habits/:id/tick calls cache.invalidate(id).
    // The immediate next GET /habits must encounter a cache miss (cached === false)
    // and return updated data (totalTicks: 2) from PostgreSQL rather than stale cache.
    const getFresh = await get('/habits');
    const habitFresh = getFresh.data.habits.find((h) => h.id === createdHabitId);
    assert.equal(habitFresh.cached, false, 'Mutating tick state must invalidate cache (cached === false)');
    assert.equal(habitFresh.totalTicks, 2, 'Total ticks must reflect updated count of 2');

    // 4. Subsequent GET should now be re-cached with the updated data
    const getReCached = await get('/habits');
    const habitReCached = getReCached.data.habits.find((h) => h.id === createdHabitId);
    assert.equal(habitReCached.cached, true, 'Subsequent GET must reflect re-cached state');
    assert.equal(habitReCached.totalTicks, 2, 'Re-cached data must retain updated totalTicks');
  });

  it('G. DELETE TICK: DELETE /habits/:id/tick removes tick, invalidates cache, and updates GET /habits', async () => {
    const res = await del(`/habits/${createdHabitId}/tick?day=2026-10-12`);

    assert.equal(res.status, 200, 'DELETE /habits/:id/tick must return HTTP 200');
    assert.equal(res.data.habitId, createdHabitId);
    assert.equal(res.data.day, '2026-10-12');
    assert.equal(res.data.removed, 1, 'Response removed property must be 1');

    // Verify cache invalidation and updated state in GET /habits
    const getRes = await get('/habits');
    const habit = getRes.data.habits.find((h) => h.id === createdHabitId);
    assert.equal(habit.cached, false, 'Delete must invalidate cache (cached === false)');
    assert.equal(habit.totalTicks, 1, 'totalTicks must decrease back to 1');

    // Direct PostgreSQL verification
    const { rows: remainingTicks } = await db.query(
      'SELECT * FROM ticks WHERE habit_id = $1 AND day = $2',
      [createdHabitId, '2026-10-12'],
    );
    assert.equal(remainingTicks.length, 0, 'Tick row 2026-10-12 must be absent from PostgreSQL');
  });

  it('H. NONEXISTENT HABIT: POST /habits/:id/tick on an invalid ID returns HTTP 404', async () => {
    // Derive an impossibly high ID that does not exist in the database
    const { rows } = await db.query('SELECT COALESCE(MAX(id), 0) + 999999 AS nonexistent_id FROM habits');
    const nonExistentId = Number(rows[0].nonexistent_id);

    const res = await post(`/habits/${nonExistentId}/tick`, { day: '2026-10-14' });
    assert.equal(res.status, 404, 'POST /habits/:id/tick for nonexistent habit must return HTTP 404');
    assert.equal(res.data.error, 'no such habit', 'Error message must equal "no such habit"');
  });
});
