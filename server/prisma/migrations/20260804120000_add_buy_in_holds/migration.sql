-- CreateTable
CREATE TABLE "buy_in_holds" (
    "id" TEXT NOT NULL,
    "operation_id" VARCHAR(64) NOT NULL,
    "room_id" VARCHAR(32) NOT NULL,
    "user_id" TEXT NOT NULL,
    "seat_index" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buy_in_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buy_in_holds_operation_id_key" ON "buy_in_holds"("operation_id");

-- CreateIndex
CREATE INDEX "buy_in_holds_room_id_status_idx" ON "buy_in_holds"("room_id", "status");

-- CreateIndex
CREATE INDEX "buy_in_holds_user_id_status_idx" ON "buy_in_holds"("user_id", "status");

-- AddForeignKey
ALTER TABLE "buy_in_holds" ADD CONSTRAINT "buy_in_holds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
