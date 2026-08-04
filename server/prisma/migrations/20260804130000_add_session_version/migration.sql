-- Add the database-backed version used to invalidate older login tokens.
ALTER TABLE "users"
ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
