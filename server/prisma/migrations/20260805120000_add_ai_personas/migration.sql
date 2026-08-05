-- CreateTable
CREATE TABLE "ai_personas" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(32) NOT NULL,
    "style_label" VARCHAR(32) NOT NULL,
    "prompt_section" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "bluff_hint_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_personas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_personas_slug_key" ON "ai_personas"("slug");

-- AlterTable
ALTER TABLE "users" ADD COLUMN "persona_id" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "ai_personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
