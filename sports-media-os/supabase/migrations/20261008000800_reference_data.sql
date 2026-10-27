-- =============================================================================
-- Sports Media OS — 0800 reference data (taxonomy only, no content/news)
-- Idempotent: safe to re-run; admins can add/disable sports from the UI later.
-- =============================================================================

insert into public.sports (name, slug) values
  ('Football (Soccer)', 'football'),
  ('Basketball', 'basketball'),
  ('Tennis', 'tennis'),
  ('Formula 1', 'formula-1'),
  ('MotoGP', 'motogp'),
  ('American Football', 'american-football'),
  ('Baseball', 'baseball'),
  ('Ice Hockey', 'ice-hockey'),
  ('MMA', 'mma'),
  ('Boxing', 'boxing'),
  ('Cycling', 'cycling'),
  ('Golf', 'golf'),
  ('Rugby', 'rugby'),
  ('Cricket', 'cricket'),
  ('Athletics', 'athletics'),
  ('Volleyball', 'volleyball'),
  ('Swimming', 'swimming'),
  ('Esports', 'esports')
on conflict (slug) do nothing;
