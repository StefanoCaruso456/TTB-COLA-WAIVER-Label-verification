import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { ColaApplication, LabelImagePayload } from "@/types/cola";
import type { ExtractedLabel } from "@/types/extracted-label";
import type {
  VerificationRecordDetail,
  VerificationRecordSummary,
} from "@/types/verification-record";
import type {
  OverallStatus,
  VerificationReport,
} from "@/types/verification";
import type { ProductType, SourceOfProduct } from "@/types/cola";

function summaryFromRow(row: {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  clientName: string | null;
  applicantName: string | null;
  productName: string | null;
  brandName: string | null;
  productType: string;
  sourceOfProduct: string;
  status: string;
}): VerificationRecordSummary {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    clientName: row.clientName,
    applicantName: row.applicantName,
    productName: row.productName,
    brandName: row.brandName,
    productType: row.productType as ProductType,
    sourceOfProduct: row.sourceOfProduct as SourceOfProduct,
    status: row.status as OverallStatus,
  };
}

export interface CreateVerificationRecordInput {
  clientName?: string;
  applicantName?: string;
  productName?: string;
  application: ColaApplication;
  extractedLabel: ExtractedLabel;
  report: VerificationReport;
  imageMetadata?: LabelImagePayload[];
}

export async function createVerificationRecord(
  input: CreateVerificationRecordInput,
): Promise<VerificationRecordSummary> {
  const data: Prisma.VerificationRecordCreateInput = {
    clientName: input.clientName,
    applicantName: input.applicantName,
    productName: input.productName,
    brandName: input.application.colaInformationStep.brandName,
    productType: input.application.applicationTypeStep.productType,
    sourceOfProduct: input.application.applicationTypeStep.sourceOfProduct,
    status: input.report.overallStatus,
    applicationJson: input.application as unknown as Prisma.InputJsonValue,
    extractedJson: input.extractedLabel as unknown as Prisma.InputJsonValue,
    reportJson: input.report as unknown as Prisma.InputJsonValue,
    imageJson: input.imageMetadata
      ? (input.imageMetadata.map(stripBase64) as unknown as Prisma.InputJsonValue)
      : undefined,
  };

  const created = await prisma.verificationRecord.create({ data });
  return summaryFromRow(created);
}

export async function listVerificationRecords(): Promise<
  VerificationRecordSummary[]
> {
  const rows = await prisma.verificationRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map(summaryFromRow);
}

export async function getVerificationRecordById(
  id: string,
): Promise<VerificationRecordDetail | null> {
  const row = await prisma.verificationRecord.findUnique({ where: { id } });
  if (!row) return null;
  return {
    ...summaryFromRow(row),
    applicationJson: row.applicationJson,
    extractedJson: row.extractedJson,
    reportJson: row.reportJson,
    imageJson: row.imageJson ?? undefined,
    reviewerNotes: row.reviewerNotes,
  };
}

export async function updateReviewerNotes(
  id: string,
  notes: string,
): Promise<VerificationRecordSummary | null> {
  const updated = await prisma.verificationRecord.update({
    where: { id },
    data: { reviewerNotes: notes },
  });
  return summaryFromRow(updated);
}

function stripBase64(image: LabelImagePayload): Omit<LabelImagePayload, "base64"> {
  const { base64: _base64, ...rest } = image;
  return rest;
}
