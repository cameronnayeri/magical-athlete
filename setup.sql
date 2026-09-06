-- ============================================================
--  MAGICAL ATHLETE — Supabase Setup
--  Run this entire file in the Supabase SQL Editor
--  (Dashboard → SQL Editor → New Query → Paste → Run)
--
--  Tables are prefixed "ma_" so this can live in the same
--  Supabase project as Liar's Dice without clashing.
-- ============================================================

CREATE TABLE IF NOT EXISTS ma_lobbies (
  code            TEXT        PRIMARY KEY CHECK (char_length(code) = 4),
  host_player_id  TEXT        NOT NULL,
  settings        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  game_state      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT        NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting', 'playing', 'finished')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ma_players (
  id          TEXT        PRIMARY KEY,
  lobby_code  TEXT        NOT NULL REFERENCES ma_lobbies(code) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (char_length(trim(name)) >= 1 AND char_length(name) <= 20),
  color       TEXT        NOT NULL DEFAULT '#ff2e88',
  seat_order  INTEGER     NOT NULL DEFAULT 0,
  is_host     BOOLEAN     NOT NULL DEFAULT FALSE,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- This app is for trusted friends only — no row level security.
ALTER TABLE ma_lobbies DISABLE ROW LEVEL SECURITY;
ALTER TABLE ma_players DISABLE ROW LEVEL SECURITY;

-- Turn on Realtime for both tables (safe to re-run).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ma_lobbies;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ma_players;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Keep updated_at fresh.
CREATE OR REPLACE FUNCTION ma_handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_ma_lobbies_updated ON ma_lobbies;
CREATE TRIGGER on_ma_lobbies_updated
  BEFORE UPDATE ON ma_lobbies
  FOR EACH ROW EXECUTE FUNCTION ma_handle_updated_at();

-- ------------------------------------------------------------
--  ma_apply: apply a list of small edits to game_state atomically.
--  Each op is one of:
--    { "path": ["pieces","abc_0","space"], "value": 7 }   set a value
--    { "path": ["log"], "append": { ... } }                 push onto a list
--    { "path": ["draft"], "delete": true }                  remove a key
--  Because edits are applied on the server one at a time,
--  two friends clicking at once can't overwrite each other.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION ma_apply(p_code TEXT, p_ops JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  st   JSONB;
  op   JSONB;
  pth  TEXT[];
  n    INTEGER;
BEGIN
  SELECT game_state INTO st FROM ma_lobbies WHERE code = p_code FOR UPDATE;
  IF st IS NULL THEN RETURN; END IF;

  FOR op IN SELECT * FROM jsonb_array_elements(p_ops) LOOP
    SELECT array_agg(x) INTO pth FROM jsonb_array_elements_text(op->'path') AS x;
    IF op ? 'append' THEN
      st := jsonb_set(st, pth, COALESCE(st #> pth, '[]'::jsonb) || jsonb_build_array(op->'append'), true);
    ELSIF op ? 'delete' THEN
      st := st #- pth;
    ELSE
      st := jsonb_set(st, pth, COALESCE(op->'value', 'null'::jsonb), true);
    END IF;
  END LOOP;

  -- Keep the log from growing forever (last 150 entries).
  IF jsonb_typeof(st->'log') = 'array' THEN
    n := jsonb_array_length(st->'log');
    IF n > 150 THEN
      st := jsonb_set(st, '{log}', (
        SELECT COALESCE(jsonb_agg(e ORDER BY i), '[]'::jsonb)
        FROM jsonb_array_elements(st->'log') WITH ORDINALITY AS t(e, i)
        WHERE i > n - 150
      ));
    END IF;
  END IF;

  UPDATE ma_lobbies SET game_state = st WHERE code = p_code;
END;
$$;

-- Optional: clean up old lobbies (run manually as needed)
-- DELETE FROM ma_lobbies WHERE updated_at < NOW() - INTERVAL '2 days';

-- ------------------------------------------------------------
--  Board drawings (one row per pen stroke) and player-made cards.
--  Kept out of game_state so they don't bloat every update.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ma_strokes (
  id          TEXT        PRIMARY KEY,
  lobby_code  TEXT        NOT NULL REFERENCES ma_lobbies(code) ON DELETE CASCADE,
  player_id   TEXT        NOT NULL,
  color       TEXT        NOT NULL DEFAULT '#1d1b2e',
  width       INTEGER     NOT NULL DEFAULT 4,
  points      JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ma_cards (
  id          TEXT        PRIMARY KEY,
  lobby_code  TEXT        NOT NULL REFERENCES ma_lobbies(code) ON DELETE CASCADE,
  player_id   TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  tag         TEXT        NOT NULL DEFAULT '',
  text        TEXT        NOT NULL,
  emoji       TEXT        NOT NULL DEFAULT '🎨',
  art         TEXT,
  pawn        TEXT        NOT NULL DEFAULT 'art',
  round       INTEGER     NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ma_strokes DISABLE ROW LEVEL SECURITY;
ALTER TABLE ma_cards   DISABLE ROW LEVEL SECURITY;
ALTER TABLE ma_strokes REPLICA IDENTITY FULL;
ALTER TABLE ma_cards   REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ma_strokes;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ma_cards;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
