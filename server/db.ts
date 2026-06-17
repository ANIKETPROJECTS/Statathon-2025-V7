import mongoose, { Schema, model, type Document } from "mongoose";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI must be set. Did you forget to add it to secrets?");
}

const MONGODB_URI = process.env.MONGODB_URI;

let isConnected = false;

export async function connectDB() {
  if (isConnected) return;
  await mongoose.connect(MONGODB_URI);
  isConnected = true;
  console.log("MongoDB connected");
}

connectDB().catch((err) => {
  console.error("MongoDB connection error:", err);
  process.exit(1);
});

// ── Helper ────────────────────────────────────────────────────────────────────
const toJSON = {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    // Stringify all remaining ObjectId fields so comparisons with plain strings work
    for (const key of Object.keys(ret)) {
      const val = ret[key];
      if (val && typeof val === "object" && val.constructor && val.constructor.name === "ObjectId") {
        ret[key] = val.toString();
      }
    }
    return ret;
  },
};

// ── User ──────────────────────────────────────────────────────────────────────
const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: { type: String, required: true },
    fullName: { type: String, required: true },
    role: { type: String, default: "analyst" },
    department: { type: String, default: "" },
    permissions: {
      type: [String],
      default: ["data_upload", "risk_assessment", "privacy_enhancement", "utility_measurement", "report_generation"],
    },
    twoFactorEnabled: { type: Boolean, default: false },
    sessionTimeout: { type: Number, default: 30 },
    notificationsEnabled: { type: Boolean, default: true },
    lastLogin: { type: Date, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false }, toJSON, toObject: toJSON }
);

export const UserModel = model("User", userSchema);

// ── Dataset ───────────────────────────────────────────────────────────────────
const datasetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    format: { type: String, required: true },
    size: { type: Number, required: true },
    columns: { type: [String], required: true },
    rowCount: { type: Number, required: true },
    qualityScore: { type: Number, default: null },
    completenessScore: { type: Number, default: null },
    consistencyScore: { type: Number, default: null },
    validityScore: { type: Number, default: null },
    minGroupSize: { type: Number, default: null },
    maxGroupSize: { type: Number, default: null },
    minDiversity: { type: Number, default: null },
    maxDiversity: { type: Number, default: null },
    avgDiversity: { type: Number, default: null },
    diversityScore: { type: Number, default: null },
    privacyRisk: { type: Number, default: null },
  },
  { timestamps: { createdAt: "uploadedAt", updatedAt: false }, toJSON, toObject: toJSON }
);

export const DatasetModel = model("Dataset", datasetSchema);

// ── DataChunk ──────────────────────────────────────────────────────────────────
// Stores dataset rows in fixed-size chunks to bypass MongoDB's 16 MB document limit.
const dataChunkSchema = new Schema(
  {
    datasetId: { type: Schema.Types.ObjectId, ref: "Dataset", required: true, index: true },
    chunkIndex: { type: Number, required: true },
    rows: { type: Schema.Types.Mixed, required: true },
  },
  { toJSON, toObject: toJSON }
);

dataChunkSchema.index({ datasetId: 1, chunkIndex: 1 });

export const DataChunkModel = model("DataChunk", dataChunkSchema);

// ── RiskAssessment ────────────────────────────────────────────────────────────
const riskAssessmentSchema = new Schema(
  {
    datasetId: { type: Schema.Types.ObjectId, ref: "Dataset", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    quasiIdentifiers: { type: [String], required: true },
    sensitiveAttributes: { type: [String], default: [] },
    kThreshold: { type: Number, default: 5 },
    sampleSize: { type: Number, default: 100 },
    overallRisk: { type: Number, required: true },
    riskLevel: { type: String, required: true },
    violations: { type: Number, required: true },
    uniqueRecords: { type: Number, required: true },
    equivalenceClasses: { type: Schema.Types.Mixed, default: null },
    attackScenarios: { type: Schema.Types.Mixed, default: null },
    recommendations: { type: [String], default: [] },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false }, toJSON, toObject: toJSON }
);

export const RiskAssessmentModel = model("RiskAssessment", riskAssessmentSchema);

// ── PrivacyOperation ──────────────────────────────────────────────────────────
const privacyOperationSchema = new Schema(
  {
    datasetId: { type: Schema.Types.ObjectId, ref: "Dataset", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    technique: { type: String, required: true },
    method: { type: String, default: null },
    parameters: { type: Schema.Types.Mixed, required: true },
    processedData: { type: Schema.Types.Mixed, default: null },
    recordsSuppressed: { type: Number, default: 0 },
    informationLoss: { type: Number, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false }, toJSON, toObject: toJSON }
);

export const PrivacyOperationModel = model("PrivacyOperation", privacyOperationSchema);

// ── UtilityMeasurement ────────────────────────────────────────────────────────
const utilityMeasurementSchema = new Schema(
  {
    originalDatasetId: { type: Schema.Types.ObjectId, ref: "Dataset", required: true },
    processedOperationId: { type: Schema.Types.ObjectId, ref: "PrivacyOperation", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    overallUtility: { type: Number, required: true },
    utilityLevel: { type: String, required: true },
    statisticalSimilarity: { type: Schema.Types.Mixed, default: null },
    correlationPreservation: { type: Number, default: null },
    distributionSimilarity: { type: Number, default: null },
    informationLoss: { type: Number, default: null },
    queryAccuracy: { type: Schema.Types.Mixed, default: null },
    metrics: { type: Schema.Types.Mixed, default: null },
    recommendations: { type: [String], default: [] },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false }, toJSON, toObject: toJSON }
);

export const UtilityMeasurementModel = model("UtilityMeasurement", utilityMeasurementSchema);

// ── Report ────────────────────────────────────────────────────────────────────
const reportSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    datasetId: { type: Schema.Types.ObjectId, ref: "Dataset", default: null },
    riskAssessmentId: { type: Schema.Types.ObjectId, ref: "RiskAssessment", default: null },
    utilityMeasurementId: { type: Schema.Types.ObjectId, ref: "UtilityMeasurement", default: null },
    type: { type: String, required: true },
    format: { type: String, required: true },
    title: { type: String, required: true },
    content: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false }, toJSON, toObject: toJSON }
);

export const ReportModel = model("Report", reportSchema);

// ── ConfigProfile ─────────────────────────────────────────────────────────────
const configProfileSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: null },
    kValue: { type: Number, default: 5 },
    lValue: { type: Number, default: 3 },
    tValue: { type: Number, default: 0.5 },
    epsilon: { type: Number, default: 2.0 },
    suppressionLimit: { type: Number, default: 0.1 },
    useCase: { type: String, default: null },
    recommendedFor: { type: [String], default: [] },
    governmentClearance: { type: String, default: null },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false }, toJSON, toObject: toJSON }
);

export const ConfigProfileModel = model("ConfigProfile", configProfileSchema);

// ── SharedFile ────────────────────────────────────────────────────────────────
const sharedFileSchema = new Schema(
  {
    privacyOperationId: { type: Schema.Types.ObjectId, ref: "PrivacyOperation", required: true },
    sharedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sharedWithUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, default: null },
    datasetName: { type: String, default: null },
    technique: { type: String, default: null },
  },
  { timestamps: { createdAt: "sharedAt", updatedAt: false }, toJSON, toObject: toJSON }
);

export const SharedFileModel = model("SharedFile", sharedFileSchema);

// ── ActivityLog ───────────────────────────────────────────────────────────────
const activityLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },
    entityType: { type: String, default: null },
    entityId: { type: String, default: null },
    details: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false }, toJSON, toObject: toJSON }
);

export const ActivityLogModel = model("ActivityLog", activityLogSchema);
