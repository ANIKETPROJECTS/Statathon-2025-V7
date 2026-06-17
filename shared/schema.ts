import { z } from "zod";

// ── User ──────────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  username: string;
  password: string;
  email: string;
  fullName: string;
  role: string;
  department?: string | null;
  permissions?: string[];
  twoFactorEnabled?: boolean;
  sessionTimeout?: number;
  notificationsEnabled?: boolean;
  createdAt?: Date;
  lastLogin?: Date | null;
}

export type InsertUser = Omit<User, "id" | "createdAt" | "lastLogin">;

export const insertUserSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  email: z.string().email(),
  fullName: z.string().min(1),
  role: z.string().default("analyst"),
  department: z.string().optional().nullable(),
  permissions: z.array(z.string()).optional(),
  twoFactorEnabled: z.boolean().optional(),
  sessionTimeout: z.number().optional(),
  notificationsEnabled: z.boolean().optional(),
});

// ── Dataset ───────────────────────────────────────────────────────────────────
export interface Dataset {
  id: string;
  userId: string;
  filename: string;
  originalName: string;
  format: string;
  size: number;
  columns: string[];
  rowCount: number;
  qualityScore?: number | null;
  completenessScore?: number | null;
  consistencyScore?: number | null;
  validityScore?: number | null;
  minGroupSize?: number | null;
  maxGroupSize?: number | null;
  minDiversity?: number | null;
  maxDiversity?: number | null;
  avgDiversity?: number | null;
  diversityScore?: number | null;
  privacyRisk?: number | null;
  data?: any[];
  uploadedAt?: Date;
}

export type InsertDataset = Omit<Dataset, "id" | "uploadedAt">;

export const insertDatasetSchema = z.object({
  userId: z.string(),
  filename: z.string(),
  originalName: z.string(),
  format: z.string(),
  size: z.number(),
  columns: z.array(z.string()),
  rowCount: z.number(),
  qualityScore: z.number().optional().nullable(),
  completenessScore: z.number().optional().nullable(),
  consistencyScore: z.number().optional().nullable(),
  validityScore: z.number().optional().nullable(),
  data: z.array(z.any()).optional(),
});

// ── RiskAssessment ────────────────────────────────────────────────────────────
export interface RiskAssessment {
  id: string;
  datasetId: string;
  userId: string;
  quasiIdentifiers: string[];
  sensitiveAttributes?: string[] | null;
  kThreshold: number;
  sampleSize?: number | null;
  overallRisk: number;
  riskLevel: string;
  violations: number;
  uniqueRecords: number;
  equivalenceClasses?: any | null;
  attackScenarios?: any | null;
  recommendations?: string[] | null;
  createdAt?: Date;
}

export type InsertRiskAssessment = Omit<RiskAssessment, "id" | "createdAt">;

export const insertRiskAssessmentSchema = z.object({
  datasetId: z.string(),
  userId: z.string(),
  quasiIdentifiers: z.array(z.string()),
  sensitiveAttributes: z.array(z.string()).optional().nullable(),
  kThreshold: z.number().default(5),
  sampleSize: z.number().optional().nullable(),
  overallRisk: z.number(),
  riskLevel: z.string(),
  violations: z.number(),
  uniqueRecords: z.number(),
  equivalenceClasses: z.any().optional().nullable(),
  attackScenarios: z.any().optional().nullable(),
  recommendations: z.array(z.string()).optional().nullable(),
});

// ── PrivacyOperation ──────────────────────────────────────────────────────────
export interface PrivacyOperation {
  id: string;
  datasetId: string;
  userId: string;
  technique: string;
  method?: string | null;
  parameters: any;
  processedData?: any | null;
  recordsSuppressed?: number | null;
  informationLoss?: number | null;
  createdAt?: Date;
}

export type InsertPrivacyOperation = Omit<PrivacyOperation, "id" | "createdAt">;

export const insertPrivacyOperationSchema = z.object({
  datasetId: z.string(),
  userId: z.string(),
  technique: z.string(),
  method: z.string().optional().nullable(),
  parameters: z.any(),
  processedData: z.any().optional().nullable(),
  recordsSuppressed: z.number().optional().nullable(),
  informationLoss: z.number().optional().nullable(),
});

// ── UtilityMeasurement ────────────────────────────────────────────────────────
export interface UtilityMeasurement {
  id: string;
  originalDatasetId: string;
  processedOperationId: string;
  userId: string;
  overallUtility: number;
  utilityLevel: string;
  statisticalSimilarity?: any | null;
  correlationPreservation?: number | null;
  distributionSimilarity?: number | null;
  informationLoss?: number | null;
  queryAccuracy?: any | null;
  metrics?: any | null;
  recommendations?: string[] | null;
  createdAt?: Date;
}

export type InsertUtilityMeasurement = Omit<UtilityMeasurement, "id" | "createdAt">;

export const insertUtilityMeasurementSchema = z.object({
  originalDatasetId: z.string(),
  processedOperationId: z.string(),
  userId: z.string(),
  overallUtility: z.number(),
  utilityLevel: z.string(),
  statisticalSimilarity: z.any().optional().nullable(),
  correlationPreservation: z.number().optional().nullable(),
  distributionSimilarity: z.number().optional().nullable(),
  informationLoss: z.number().optional().nullable(),
  queryAccuracy: z.any().optional().nullable(),
  metrics: z.any().optional().nullable(),
  recommendations: z.array(z.string()).optional().nullable(),
});

// ── Report ────────────────────────────────────────────────────────────────────
export interface Report {
  id: string;
  userId: string;
  datasetId?: string | null;
  riskAssessmentId?: string | null;
  utilityMeasurementId?: string | null;
  type: string;
  format: string;
  title: string;
  content?: any | null;
  createdAt?: Date;
}

export type InsertReport = Omit<Report, "id" | "createdAt">;

export const insertReportSchema = z.object({
  userId: z.string(),
  datasetId: z.string().optional().nullable(),
  riskAssessmentId: z.string().optional().nullable(),
  utilityMeasurementId: z.string().optional().nullable(),
  type: z.string(),
  format: z.string(),
  title: z.string(),
  content: z.any().optional().nullable(),
});

// ── ConfigProfile ─────────────────────────────────────────────────────────────
export interface ConfigProfile {
  id: string;
  name: string;
  description?: string | null;
  kValue?: number | null;
  lValue?: number | null;
  tValue?: number | null;
  epsilon?: number | null;
  suppressionLimit?: number | null;
  useCase?: string | null;
  recommendedFor?: string[] | null;
  governmentClearance?: string | null;
  isDefault?: boolean;
  createdAt?: Date;
}

export type InsertConfigProfile = Omit<ConfigProfile, "id" | "createdAt">;

export const insertConfigProfileSchema = z.object({
  name: z.string(),
  description: z.string().optional().nullable(),
  kValue: z.number().optional().nullable(),
  lValue: z.number().optional().nullable(),
  tValue: z.number().optional().nullable(),
  epsilon: z.number().optional().nullable(),
  suppressionLimit: z.number().optional().nullable(),
  useCase: z.string().optional().nullable(),
  recommendedFor: z.array(z.string()).optional().nullable(),
  governmentClearance: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
});

// ── ActivityLog ───────────────────────────────────────────────────────────────
export interface ActivityLog {
  id: string;
  userId: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: any | null;
  createdAt?: Date;
}

export type InsertActivityLog = Omit<ActivityLog, "id" | "createdAt">;

export const insertActivityLogSchema = z.object({
  userId: z.string(),
  action: z.string(),
  entityType: z.string().optional().nullable(),
  entityId: z.string().optional().nullable(),
  details: z.any().optional().nullable(),
});

// ── SharedFile ────────────────────────────────────────────────────────────────
export interface SharedFile {
  id: string;
  privacyOperationId: string;
  sharedByUserId: string;
  sharedWithUserId: string;
  note?: string | null;
  datasetName?: string | null;
  technique?: string | null;
  sharedAt?: Date;
}

export type InsertSharedFile = Omit<SharedFile, "id" | "sharedAt">;

export const insertSharedFileSchema = z.object({
  privacyOperationId: z.string(),
  sharedByUserId: z.string(),
  sharedWithUserId: z.string(),
  note: z.string().optional().nullable(),
  datasetName: z.string().optional().nullable(),
  technique: z.string().optional().nullable(),
});

// ── Login schema ──────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginData = z.infer<typeof loginSchema>;
