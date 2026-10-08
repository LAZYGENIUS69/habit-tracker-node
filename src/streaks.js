/**
 * Pure streak logic. No database, no Redis, no Express.
 *
 * This file is where your unit tests live. Everything here is a plain
 * function over plain data, so it can be tested in milliseconds.
 */

const DAY = 86400000;

/** 'YYYY-MM-DD' for a Date, in UTC. */
function toKey(d) {
  return d.toISOString().slice(0, 10);
}

/** Parse 'YYYY-MM-DD' into a UTC Date at midnight. */
function fromKey(key) {
  return new Date(`${key}T00:00:00.000Z`);
}

/** Day of week, 0 = Sunday. */
function weekday(key) {
  return fromKey(key).getUTCDay();
}

/**
 * Is this habit due on this date?
 * schedule is an array of weekday numbers, e.g. [1,2,3,4,5] for weekdays only.
 * An empty or missing schedule means every day.
 */
function isScheduled(key, schedule) {
  if (!schedule || schedule.length === 0) return true;
  return schedule.includes(weekday(key));
}

/** The day before a given key. */
function previousDay(key) {
  return toKey(new Date(fromKey(key).getTime() - DAY));
}

/**
 * Current streak, counting back from `today`.
 *
 * Rules:
 *   - a day the habit was ticked continues the streak
 *   - a day it was NOT scheduled is skipped entirely, and does not break it
 *   - a missed scheduled day breaks it, unless a freeze is spent
 *   - today not being ticked yet does NOT break the streak - you still
 *     have the rest of the day
 *
 * @param {string[]} tickedDates  'YYYY-MM-DD' strings, any order
 * @param {string}   today        'YYYY-MM-DD'
 * @param {object}   opts         { schedule?: number[], freezes?: number }
 * @returns {{ streak: number, freezesUsed: number }}
 */
function currentStreak(tickedDates, today, opts = {}) {
  const schedule = opts.schedule || [];
  let freezesLeft = opts.freezes || 0;

  const ticked = new Set(tickedDates);
  let streak = 0;
  let freezesUsed = 0;
  let cursor = today;

  // Today is still in progress: if it is not ticked, start from yesterday
  // rather than treating it as a miss.
  if (!ticked.has(cursor)) cursor = previousDay(cursor);

  // Walk backwards. The cap stops a pathological loop.
  for (let guard = 0; guard < 3650; guard += 1) {
    if (!isScheduled(cursor, schedule)) {
      cursor = previousDay(cursor);
      continue;
    }
    if (ticked.has(cursor)) {
      streak += 1;
    } else if (freezesLeft > 0) {
      freezesLeft -= 1;
      freezesUsed += 1;
    } else {
      break;
    }
    cursor = previousDay(cursor);
  }

  return { streak, freezesUsed };
}

/** Longest streak ever recorded, ignoring freezes. */
function longestStreak(tickedDates, opts = {}) {
  const schedule = opts.schedule || [];
  const keys = [...new Set(tickedDates)].sort();
  if (keys.length === 0) return 0;

  let best = 0;
  let run = 0;
  let expected = null;

  for (const key of keys) {
    if (expected === null || key === expected) {
      run += 1;
    } else {
      run = 1;
    }
    best = Math.max(best, run);

    // next scheduled day after this one
    let next = previousDayInverse(key);
    while (!isScheduled(next, schedule)) next = previousDayInverse(next);
    expected = next;
  }
  return best;
}

function previousDayInverse(key) {
  return toKey(new Date(fromKey(key).getTime() + DAY));
}

module.exports = {
  toKey, fromKey, weekday, isScheduled, previousDay,
  currentStreak, longestStreak,
};
