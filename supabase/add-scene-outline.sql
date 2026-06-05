-- Add scene outlines from the script breakdown table.
-- Safe to run repeatedly.

alter table public.scenes
  add column if not exists outline text;
