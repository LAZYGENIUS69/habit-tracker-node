-- Sample data so the app is interesting the moment it starts.
-- Dates are relative to today, so the seed never goes stale.

INSERT INTO habits (name, schedule, freezes) VALUES
    ('Read 20 pages',    '{}',          2),
    ('Gym',              '{1,3,5}',     1),
    ('No phone after 10', '{}',         0)
ON CONFLICT DO NOTHING;

-- "Read 20 pages": an unbroken run ending yesterday
INSERT INTO ticks (habit_id, day)
SELECT h.id, (CURRENT_DATE - s)::date
FROM habits h, generate_series(1, 6) AS s
WHERE h.name = 'Read 20 pages'
ON CONFLICT DO NOTHING;

-- "Gym": only on its scheduled weekdays, over the last three weeks
INSERT INTO ticks (habit_id, day)
SELECT h.id, d::date
FROM habits h,
     generate_series(CURRENT_DATE - 21, CURRENT_DATE - 1, '1 day') AS d
WHERE h.name = 'Gym'
  AND EXTRACT(DOW FROM d) IN (1, 3, 5)
ON CONFLICT DO NOTHING;

-- "No phone after 10": a run with one gap, to show a broken streak
INSERT INTO ticks (habit_id, day)
SELECT h.id, (CURRENT_DATE - s)::date
FROM habits h, unnest(ARRAY[1, 2, 4, 5, 6]) AS s
WHERE h.name = 'No phone after 10'
ON CONFLICT DO NOTHING;
