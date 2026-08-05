-- CreateTable
CREATE TABLE "points_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "points_transactions_user_id_created_at_idx" ON "points_transactions"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
