ALTER TABLE "rounds" ADD COLUMN "oracle_committed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "oracle_forecast_model" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "oracle_prompt_version" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "oracle_forecast_snapshot" jsonb;--> statement-breakpoint
-- A single server-side transaction works with neon-http (which cannot run
-- interactive Drizzle transactions). The parent lock serializes competing
-- commits, publication, and question edits. No network calls occur here.
CREATE FUNCTION commit_oracle_forecast(
  p_date date, p_snapshot jsonb, p_model text, p_version text,
  p_checked_at timestamptz
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  r rounds%ROWTYPE;
  committed_at timestamptz;
  opening timestamptz;
  matching integer;
BEGIN
  SELECT * INTO r FROM rounds WHERE date = p_date FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'forecast: round missing'; END IF;
  IF r.oracle_committed_at IS NOT NULL THEN RETURN false; END IF;
  IF r.status <> 'scheduled' THEN RAISE EXCEPTION 'forecast: round already opened'; END IF;
  IF jsonb_typeof(p_snapshot) <> 'array' OR jsonb_array_length(p_snapshot) <> 5 THEN
    RAISE EXCEPTION 'forecast: five questions required';
  END IF;
  IF (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_snapshot) x) <> 5
     OR (SELECT count(DISTINCT x->>'slot') FROM jsonb_array_elements(p_snapshot) x) <> 5 THEN
    RAISE EXCEPTION 'forecast: duplicate questions or slots';
  END IF;
  PERFORM id FROM questions WHERE round_date = p_date ORDER BY slot FOR UPDATE;
  SELECT min(opens_at) INTO opening FROM questions WHERE round_date = p_date;
  IF opening IS NULL OR opening <= greatest(clock_timestamp(), p_checked_at) THEN
    RAISE EXCEPTION 'forecast: opening deadline passed';
  END IF;
  IF (SELECT count(*) FROM questions WHERE round_date = p_date) <> 5 THEN
    RAISE EXCEPTION 'forecast: question set changed';
  END IF;
  SELECT count(*) INTO matching
  FROM questions q JOIN jsonb_array_elements(p_snapshot) x ON q.id = (x->>'id')::uuid
  WHERE q.round_date = p_date AND q.status = 'scheduled' AND q.outcome IS NULL
    AND q.oracle_p_yes IS NULL
    AND q.slot = (x->>'slot')::integer AND q.slot BETWEEN 1 AND 5
    AND q.is_big_one = (x->>'isBigOne')::boolean
    AND q.text = x->>'text' AND q.category::text = x->>'category'
    AND q.resolution_criteria = x->>'resolutionCriteria'
    AND q.source_name = x->>'sourceName'
    AND q.source_url IS NOT DISTINCT FROM (x->>'sourceUrl')
    AND coalesce(q.context, 'null'::jsonb) = coalesce(x->'context', 'null'::jsonb)
    AND q.opens_at = (x->>'opensAt')::timestamptz
    AND q.locks_at = (x->>'locksAt')::timestamptz
    AND (x->>'pYes')::numeric BETWEEN 0 AND 1;
  IF matching <> 5 THEN RAISE EXCEPTION 'forecast: question snapshot changed or already forecast'; END IF;
  IF EXISTS (SELECT 1 FROM predictions p JOIN questions q ON p.question_id = q.id WHERE q.round_date = p_date) THEN
    RAISE EXCEPTION 'forecast: predictions already submitted';
  END IF;
  UPDATE questions q SET oracle_p_yes = (x->>'pYes')::numeric
    FROM jsonb_array_elements(p_snapshot) x WHERE q.id = (x->>'id')::uuid;
  committed_at := clock_timestamp();
  -- Recheck after acquiring locks and doing the work. Raising rolls back all
  -- five probability writes, even if a deadline passed while waiting.
  IF greatest(committed_at, p_checked_at) >= opening THEN
    RAISE EXCEPTION 'forecast: opening deadline passed';
  END IF;
  UPDATE rounds SET oracle_committed_at = committed_at,
    oracle_forecast_model = p_model, oracle_prompt_version = p_version,
    oracle_forecast_snapshot = p_snapshot WHERE date = p_date;
  RETURN true;
END;
$$;
--> statement-breakpoint
-- Once committed, authoring/admin rerolls may not replace the question set.
-- Resolution, crowd counts, and operational locks can still be updated.
CREATE FUNCTION guard_oracle_question_commitment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  committed_at timestamptz;
  parent_date date;
BEGIN
  IF TG_OP = 'INSERT' THEN parent_date := NEW.round_date; ELSE parent_date := OLD.round_date; END IF;
  -- Inserts have no existing child tuple: take the parent first to prevent
  -- phantom additions. UPDATE/DELETE already hold the child tuple lock; a
  -- fresh read suffices because the committer locks/rechecks all child rows.
  -- Taking a parent lock here for updates would invert its lock order.
  IF TG_OP = 'INSERT' THEN
    SELECT oracle_committed_at INTO committed_at FROM rounds WHERE date = parent_date FOR UPDATE;
  ELSE
    SELECT oracle_committed_at INTO committed_at FROM rounds WHERE date = parent_date;
  END IF;
  IF committed_at IS NOT NULL THEN
    IF TG_OP IN ('DELETE', 'INSERT') THEN RAISE EXCEPTION 'forecast: committed question set is immutable'; END IF;
    IF ROW(NEW.id, NEW.round_date, NEW.slot, NEW.is_big_one, NEW.text, NEW.category,
           NEW.resolution_criteria, NEW.source_name, NEW.source_url, NEW.context, NEW.opens_at, NEW.oracle_p_yes)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.round_date, OLD.slot, OLD.is_big_one, OLD.text, OLD.category,
           OLD.resolution_criteria, OLD.source_name, OLD.source_url, OLD.context, OLD.opens_at, OLD.oracle_p_yes) THEN
      RAISE EXCEPTION 'forecast: committed question and probability are immutable';
    END IF;
    IF NEW.locks_at IS DISTINCT FROM OLD.locks_at AND NOT
       (NEW.locks_at < OLD.locks_at AND NEW.lock_healed_at IS NOT NULL AND OLD.status = 'open') THEN
      RAISE EXCEPTION 'forecast: committed deadline is immutable except early-outcome protection';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.round_date <> OLD.round_date THEN
    RAISE EXCEPTION 'forecast: question round reassignment is not supported';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER oracle_question_commitment_guard BEFORE INSERT OR UPDATE OR DELETE ON questions
  FOR EACH ROW EXECUTE FUNCTION guard_oracle_question_commitment();
--> statement-breakpoint
CREATE FUNCTION guard_oracle_round_commitment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.oracle_committed_at IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'forecast: committed round is immutable'; END IF;
    IF ROW(NEW.date, NEW.rules_version, NEW.oracle_committed_at, NEW.oracle_forecast_model,
           NEW.oracle_prompt_version, NEW.oracle_forecast_snapshot)
       IS DISTINCT FROM ROW(OLD.date, OLD.rules_version, OLD.oracle_committed_at, OLD.oracle_forecast_model,
           OLD.oracle_prompt_version, OLD.oracle_forecast_snapshot) THEN
      RAISE EXCEPTION 'forecast: committed round metadata is immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER oracle_round_commitment_guard BEFORE UPDATE OR DELETE ON rounds
  FOR EACH ROW EXECUTE FUNCTION guard_oracle_round_commitment();
