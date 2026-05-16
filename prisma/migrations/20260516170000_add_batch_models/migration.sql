-- AlterTable
ALTER TABLE "VerificationRecord" ADD COLUMN     "batchSubmissionId" TEXT;

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "clientName" TEXT,
    "applicantName" TEXT,
    "manifestJson" JSONB,
    "metadata" JSONB,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "canceledCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchSubmission" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "fileHash" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileMimeType" TEXT NOT NULL,
    "fileStorageKey" TEXT NOT NULL,
    "applicationJson" JSONB NOT NULL,

    CONSTRAINT "BatchSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Batch_createdAt_idx" ON "Batch"("createdAt");

-- CreateIndex
CREATE INDEX "Batch_status_idx" ON "Batch"("status");

-- CreateIndex
CREATE INDEX "BatchSubmission_batchId_idx" ON "BatchSubmission"("batchId");

-- CreateIndex
CREATE INDEX "BatchSubmission_status_idx" ON "BatchSubmission"("status");

-- CreateIndex
CREATE INDEX "BatchSubmission_batchId_status_idx" ON "BatchSubmission"("batchId", "status");

-- CreateIndex
CREATE INDEX "BatchSubmission_fileHash_idx" ON "BatchSubmission"("fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationRecord_batchSubmissionId_key" ON "VerificationRecord"("batchSubmissionId");

-- AddForeignKey
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_batchSubmissionId_fkey" FOREIGN KEY ("batchSubmissionId") REFERENCES "BatchSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchSubmission" ADD CONSTRAINT "BatchSubmission_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
