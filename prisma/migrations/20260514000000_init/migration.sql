-- CreateTable
CREATE TABLE "VerificationRecord" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientName" TEXT,
    "applicantName" TEXT,
    "productName" TEXT,
    "brandName" TEXT,
    "productType" TEXT NOT NULL,
    "sourceOfProduct" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "applicationJson" JSONB NOT NULL,
    "extractedJson" JSONB NOT NULL,
    "reportJson" JSONB NOT NULL,
    "imageJson" JSONB,
    "reviewerNotes" TEXT,

    CONSTRAINT "VerificationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationRecord_createdAt_idx" ON "VerificationRecord"("createdAt");

-- CreateIndex
CREATE INDEX "VerificationRecord_productType_idx" ON "VerificationRecord"("productType");

-- CreateIndex
CREATE INDEX "VerificationRecord_status_idx" ON "VerificationRecord"("status");

