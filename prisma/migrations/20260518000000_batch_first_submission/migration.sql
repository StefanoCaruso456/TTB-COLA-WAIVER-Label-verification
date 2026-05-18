-- Phase 6: first-row fast path. Adds a nullable FK on Batch pointing at the
-- BatchSubmission processed inline in the POST handler. Existing rows stay
-- null; the new code path writes this column after the inline run completes.

ALTER TABLE "Batch"
  ADD COLUMN "firstSubmissionId" TEXT;

CREATE UNIQUE INDEX "Batch_firstSubmissionId_key"
  ON "Batch"("firstSubmissionId");

ALTER TABLE "Batch"
  ADD CONSTRAINT "Batch_firstSubmissionId_fkey"
  FOREIGN KEY ("firstSubmissionId")
  REFERENCES "BatchSubmission"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
