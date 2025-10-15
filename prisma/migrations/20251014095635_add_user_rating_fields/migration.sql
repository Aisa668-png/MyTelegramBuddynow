-- CreateEnum
CREATE TYPE "public"."ReportType" AS ENUM ('PREMATURE_COMPLETION', 'NO_SHOW', 'BAD_BEHAVIOR', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ReportStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED');

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "avgRating" DECIMAL(3,2),
ADD COLUMN     "isSuspended" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "penaltyPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "suspendedUntil" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" TEXT,
ADD COLUMN     "totalReviews" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."orders" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "duration" INTEGER,
ADD COLUMN     "nannyChatId" TEXT,
ADD COLUMN     "parentChatId" TEXT;

-- CreateTable
CREATE TABLE "public"."Review" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orderId" INTEGER NOT NULL,
    "nannyId" INTEGER NOT NULL,
    "parentId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Report" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" INTEGER NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "type" "public"."ReportType" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "public"."ReportStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TempOrderData" (
    "id" SERIAL NOT NULL,
    "chatId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TempOrderData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Review_orderId_key" ON "public"."Review"("orderId");

-- CreateIndex
CREATE INDEX "Review_nannyId_idx" ON "public"."Review"("nannyId");

-- CreateIndex
CREATE INDEX "Review_parentId_idx" ON "public"."Review"("parentId");

-- CreateIndex
CREATE INDEX "Report_orderId_idx" ON "public"."Report"("orderId");

-- CreateIndex
CREATE INDEX "Report_reporterId_idx" ON "public"."Report"("reporterId");

-- CreateIndex
CREATE UNIQUE INDEX "TempOrderData_chatId_key" ON "public"."TempOrderData"("chatId");

-- AddForeignKey
ALTER TABLE "public"."Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Review" ADD CONSTRAINT "Review_nannyId_fkey" FOREIGN KEY ("nannyId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Review" ADD CONSTRAINT "Review_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Report" ADD CONSTRAINT "Report_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
