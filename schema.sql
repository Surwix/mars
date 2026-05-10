-- ============================================
-- MARSLAND DATABASE SCHEMA
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. CITIZENS TABLE
CREATE TABLE citizens (
  id SERIAL PRIMARY KEY,
  citizen_number INTEGER UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  region TEXT NOT NULL,
  parcel_size TEXT NOT NULL,
  package TEXT NOT NULL,
  tier TEXT NOT NULL,
  price_paid INTEGER NOT NULL,
  shirt_size TEXT,
  cert_hash TEXT UNIQUE NOT NULL,
  stripe_session_id TEXT UNIQUE,
  verified BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. NUMBER RESERVATIONS (prevents race conditions)
CREATE TABLE number_reservations (
  id SERIAL PRIMARY KEY,
  citizen_number INTEGER UNIQUE NOT NULL,
  session_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PREMIUM NUMBERS
CREATE TABLE premium_numbers (
  number INTEGER PRIMARY KEY,
  tier TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  stripe_price_id TEXT NOT NULL,
  available BOOLEAN DEFAULT true,
  purchased_at TIMESTAMPTZ
);

-- Elite #001-#010 = $1,000
INSERT INTO premium_numbers (number, tier, price_cents, stripe_price_id)
SELECT generate_series(1,10), 'elite', 100000, 'price_ELITE_REPLACE_ME';

-- Premium #011-#050 = $500
INSERT INTO premium_numbers (number, tier, price_cents, stripe_price_id)
SELECT generate_series(11,50), 'premium', 50000, 'price_PREMIUM_REPLACE_ME';

-- Select #051-#100 = $199
INSERT INTO premium_numbers (number, tier, price_cents, stripe_price_id)
SELECT generate_series(51,100), 'select', 19900, 'price_SELECT_REPLACE_ME';

-- 4. INDEXES
CREATE INDEX idx_citizens_number ON citizens(citizen_number);
CREATE INDEX idx_citizens_email ON citizens(email);
CREATE INDEX idx_reservations_expires ON number_reservations(expires_at);

-- 5. NEXT STANDARD NUMBER FUNCTION
CREATE OR REPLACE FUNCTION get_next_standard_number()
RETURNS INTEGER AS $$
DECLARE next_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(citizen_number), 100) + 1
  INTO next_num FROM citizens WHERE citizen_number > 100;
  RETURN next_num;
END;
$$ LANGUAGE plpgsql;

-- 6. ROW LEVEL SECURITY
ALTER TABLE citizens ENABLE ROW LEVEL SECURITY;
ALTER TABLE premium_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read citizens" ON citizens FOR SELECT USING (true);
CREATE POLICY "Public read premium" ON premium_numbers FOR SELECT USING (true);
CREATE POLICY "Service insert citizens" ON citizens FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service update citizens" ON citizens FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "Service update premium" ON premium_numbers FOR UPDATE USING (auth.role() = 'service_role');
