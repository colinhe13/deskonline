-- CreateTable
CREATE TABLE "ai_lessons" (
    "id" TEXT NOT NULL,
    "persona_slug" VARCHAR(32),
    "text" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "retired_at" TIMESTAMP(3),

    CONSTRAINT "ai_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_hand_summaries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "position" VARCHAR(8) NOT NULL,
    "board_texture" VARCHAR(24) NOT NULL,
    "street_reached" VARCHAR(12) NOT NULL,
    "my_bets" INTEGER NOT NULL DEFAULT 0,
    "my_raises" INTEGER NOT NULL DEFAULT 0,
    "faced_bets" INTEGER NOT NULL DEFAULT 0,
    "bluffed" VARCHAR(8),
    "cbet" VARCHAR(8),
    "net_won" INTEGER NOT NULL DEFAULT 0,
    "won_at_showdown" BOOLEAN NOT NULL DEFAULT false,
    "folded_to_bet" BOOLEAN NOT NULL DEFAULT false,
    "played_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_hand_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_lessons_persona_slug_status_idx" ON "ai_lessons"("persona_slug", "status");

-- CreateIndex
CREATE INDEX "ai_hand_summaries_user_id_played_at_idx" ON "ai_hand_summaries"("user_id", "played_at");

-- CreateIndex
CREATE INDEX "ai_hand_summaries_played_at_idx" ON "ai_hand_summaries"("played_at");

-- AddForeignKey
ALTER TABLE "ai_hand_summaries" ADD CONSTRAINT "ai_hand_summaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
