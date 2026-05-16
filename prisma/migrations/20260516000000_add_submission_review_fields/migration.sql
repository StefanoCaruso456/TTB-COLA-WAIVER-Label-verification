-- AlterTable
ALTER TABLE "VerificationRecord"
ADD COLUMN "reviewerStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "assignedReviewer" TEXT;

-- CreateIndex
CREATE INDEX "VerificationRecord_reviewerStatus_idx" ON "VerificationRecord"("reviewerStatus");
