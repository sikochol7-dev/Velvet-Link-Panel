-- CreateTable
CREATE TABLE "lte_user_quota" (
    "user_id" BIGINT NOT NULL,
    "limit_bytes" BIGINT NOT NULL DEFAULT 0,
    "used_bytes" BIGINT NOT NULL DEFAULT 0,
    "lifetime_used_bytes" BIGINT NOT NULL DEFAULT 0,
    "reset_strategy" TEXT NOT NULL DEFAULT 'MONTH',
    "last_reset_at" TIMESTAMP(3),
    "blocked_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lte_user_quota_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "node_balancer_settings" (
    "node_uuid" UUID NOT NULL,
    "is_lte" BOOLEAN NOT NULL DEFAULT false,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "max_online" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_balancer_settings_pkey" PRIMARY KEY ("node_uuid")
);

-- CreateIndex
CREATE INDEX "lte_user_quota_blocked_at_idx" ON "lte_user_quota"("blocked_at");

-- AddForeignKey
ALTER TABLE "lte_user_quota" ADD CONSTRAINT "lte_user_quota_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_balancer_settings" ADD CONSTRAINT "node_balancer_settings_node_uuid_fkey" FOREIGN KEY ("node_uuid") REFERENCES "nodes"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
