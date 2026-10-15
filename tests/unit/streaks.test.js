const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  toKey,
  fromKey,
  weekday,
  isScheduled,
  previousDay,
  currentStreak,
  longestStreak,
} = require('../../src/streaks');

describe('src/streaks.js unit tests', () => {
  describe('toKey', () => {
    it('formats a UTC Date instance to YYYY-MM-DD string', () => {
      const date = new Date('2026-05-15T12:34:56.789Z');
      assert.equal(toKey(date), '2026-05-15');
    });
  });

  describe('fromKey', () => {
    it('parses YYYY-MM-DD into a UTC Date at midnight', () => {
      const date = fromKey('2026-05-15');
      assert.equal(date.toISOString(), '2026-05-15T00:00:00.000Z');
      assert.equal(date.getUTCHours(), 0);
      assert.equal(date.getUTCMinutes(), 0);
      assert.equal(date.getUTCSeconds(), 0);
      assert.equal(date.getUTCMilliseconds(), 0);
    });
  });

  describe('weekday', () => {
    it('returns the UTC day of week index with 0 = Sunday', () => {
      assert.equal(weekday('2026-03-01'), 0); // Sunday
      assert.equal(weekday('2026-03-02'), 1); // Monday
      assert.equal(weekday('2026-03-03'), 2); // Tuesday
      assert.equal(weekday('2026-03-04'), 3); // Wednesday
      assert.equal(weekday('2026-03-05'), 4); // Thursday
      assert.equal(weekday('2026-03-06'), 5); // Friday
      assert.equal(weekday('2026-03-07'), 6); // Saturday
    });
  });

  describe('isScheduled', () => {
    it('returns true when schedule is undefined or null', () => {
      assert.equal(isScheduled('2026-03-01'), true);
      assert.equal(isScheduled('2026-03-01', null), true);
    });

    it('returns true when schedule is an empty array (every day)', () => {
      assert.equal(isScheduled('2026-03-01', []), true);
    });

    it('evaluates whether day is scheduled according to custom weekday schedule', () => {
      const weekdaysOnly = [1, 2, 3, 4, 5];
      assert.equal(isScheduled('2026-03-01', weekdaysOnly), false); // Sunday
      assert.equal(isScheduled('2026-03-02', weekdaysOnly), true);  // Monday
      assert.equal(isScheduled('2026-03-06', weekdaysOnly), true);  // Friday
      assert.equal(isScheduled('2026-03-07', weekdaysOnly), false); // Saturday
    });
  });

  describe('previousDay', () => {
    it('computes the calendar day before a given key across standard days', () => {
      assert.equal(previousDay('2026-05-15'), '2026-05-14');
    });

    it('computes previous day across month boundaries', () => {
      assert.equal(previousDay('2026-05-01'), '2026-04-30');
      assert.equal(previousDay('2026-03-01'), '2026-02-28');
    });

    it('computes previous day across year boundaries', () => {
      assert.equal(previousDay('2026-01-01'), '2025-12-31');
    });

    it('handles leap day transitions correctly', () => {
      assert.equal(previousDay('2024-03-01'), '2024-02-29'); // 2024 is a leap year
      assert.equal(previousDay('2024-02-29'), '2024-02-28');
    });
  });

  describe('currentStreak', () => {
    it('returns 0 streak and 0 freezesUsed for empty ticked input', () => {
      const res = currentStreak([], '2026-05-15');
      assert.deepEqual(res, { streak: 0, freezesUsed: 0 });
    });

    it('continues streak when today is ticked', () => {
      const ticked = ['2026-05-14', '2026-05-15'];
      const res = currentStreak(ticked, '2026-05-15');
      assert.deepEqual(res, { streak: 2, freezesUsed: 0 });
    });

    it('does not break streak when today is unticked (counts back from yesterday)', () => {
      const ticked = ['2026-05-13', '2026-05-14'];
      const res = currentStreak(ticked, '2026-05-15');
      assert.deepEqual(res, { streak: 2, freezesUsed: 0 });
    });

    it('breaks streak on missed scheduled day when no freezes are available', () => {
      const ticked = ['2026-05-11', '2026-05-12', '2026-05-14', '2026-05-15'];
      const res = currentStreak(ticked, '2026-05-15');
      assert.deepEqual(res, { streak: 2, freezesUsed: 0 });
    });

    it('spends an available freeze to bridge a missed scheduled day', () => {
      const ticked = ['2026-05-12', '2026-05-14', '2026-05-15'];
      const res = currentStreak(ticked, '2026-05-15', { freezes: 1 });
      assert.deepEqual(res, { streak: 3, freezesUsed: 1 });
    });

    it('breaks streak when freezes are exhausted', () => {
      // 2026-05-13 missed (freeze 1), 2026-05-12 missed (no freezes left)
      const ticked = ['2026-05-10', '2026-05-11', '2026-05-14', '2026-05-15'];
      const res = currentStreak(ticked, '2026-05-15', { freezes: 1 });
      assert.deepEqual(res, { streak: 2, freezesUsed: 1 });
    });

    it('skips unscheduled days without breaking streak or consuming freezes', () => {
      // Schedule: Monday(1), Wednesday(3), Friday(5)
      // May 11 (Mon), May 13 (Wed), May 15 (Fri)
      const schedule = [1, 3, 5];
      const ticked = ['2026-05-11', '2026-05-13', '2026-05-15'];
      const res = currentStreak(ticked, '2026-05-15', { schedule, freezes: 0 });
      assert.deepEqual(res, { streak: 3, freezesUsed: 0 });
    });

    it('tracks streak across month boundary', () => {
      const ticked = ['2026-04-29', '2026-04-30', '2026-05-01'];
      const res = currentStreak(ticked, '2026-05-01');
      assert.deepEqual(res, { streak: 3, freezesUsed: 0 });
    });

    it('tracks streak across year boundary', () => {
      const ticked = ['2025-12-30', '2025-12-31', '2026-01-01'];
      const res = currentStreak(ticked, '2026-01-01');
      assert.deepEqual(res, { streak: 3, freezesUsed: 0 });
    });

    it('tracks streak across leap day', () => {
      const ticked = ['2024-02-28', '2024-02-29', '2024-03-01'];
      const res = currentStreak(ticked, '2024-03-01');
      assert.deepEqual(res, { streak: 3, freezesUsed: 0 });
    });

    it('caps loop execution at 3650 days via guard', () => {
      const ticked = [];
      let cur = '2026-05-15';
      for (let i = 0; i < 3700; i++) {
        ticked.push(cur);
        cur = previousDay(cur);
      }
      const res = currentStreak(ticked, '2026-05-15');
      assert.equal(res.streak, 3650);
    });
  });

  describe('longestStreak', () => {
    it('returns 0 for empty ticked dates', () => {
      assert.equal(longestStreak([]), 0);
    });

    it('returns 1 for a single ticked date', () => {
      assert.equal(longestStreak(['2026-05-15']), 1);
    });

    it('deduplicates duplicate keys and sorts unsorted input', () => {
      const ticked = ['2026-05-15', '2026-05-13', '2026-05-14', '2026-05-14', '2026-05-15'];
      assert.equal(longestStreak(ticked), 3);
    });

    it('calculates the longest historical continuous run across gaps', () => {
      const ticked = [
        '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05', // 5-day run
        '2026-04-20', '2026-04-21', // 2-day run
      ];
      assert.equal(longestStreak(ticked), 5);
    });

    it('accounts for custom schedules with skipped unscheduled days', () => {
      // Schedule: Mon(1), Wed(3), Fri(5)
      // 2026-05-11 (Mon), 2026-05-13 (Wed), 2026-05-15 (Fri)
      const schedule = [1, 3, 5];
      const ticked = ['2026-05-11', '2026-05-13', '2026-05-15'];
      assert.equal(longestStreak(ticked, { schedule }), 3);
    });

    it('differentiates historical longest streak from current streak', () => {
      const ticked = [
        '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', // 4 days historical
        '2026-05-14', '2026-05-15', // 2 days current
      ];
      const cur = currentStreak(ticked, '2026-05-15');
      const longest = longestStreak(ticked);
      assert.equal(cur.streak, 2);
      assert.equal(longest, 4);
    });
  });
});
