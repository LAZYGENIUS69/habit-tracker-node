CREATE TABLE IF NOT EXISTS habits (
    id         SERIAL PRIMARY KEY,
    name       TEXT        NOT NULL,
    -- weekdays this habit is due on; 0 = Sunday. Empty array means every day.
    schedule   INT[]       NOT NULL DEFAULT '{}',
    freezes    INT         NOT NULL DEFAULT 2,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticks (
    id       SERIAL PRIMARY KEY,
    habit_id INT  NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    day      DATE NOT NULL,
    UNIQUE (habit_id, day)
);

CREATE INDEX IF NOT EXISTS ticks_habit_day ON ticks (habit_id, day DESC);
