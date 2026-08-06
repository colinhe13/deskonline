-- AlterTable
ALTER TABLE "ai_personas" ADD COLUMN     "evolved_at" TIMESTAMP(3),
ADD COLUMN     "evolved_bluff_hint_rate" DOUBLE PRECISION,
ADD COLUMN     "evolved_temperature" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ai_self_stats" (
    "user_id" TEXT NOT NULL,
    "bluff_attempts" INTEGER NOT NULL DEFAULT 0,
    "bluff_success" INTEGER NOT NULL DEFAULT 0,
    "cbet_attempts" INTEGER NOT NULL DEFAULT 0,
    "cbet_success" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_self_stats_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "ai_self_stats" ADD CONSTRAINT "ai_self_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
