import session from "express-session";
import MongoStore from "connect-mongo";
import {
  UserModel,
  DatasetModel,
  DataChunkModel,
  RiskAssessmentModel,
  PrivacyOperationModel,
  UtilityMeasurementModel,
  ReportModel,
  ConfigProfileModel,
  ActivityLogModel,
  SharedFileModel,
} from "./db";
import type {
  User, InsertUser,
  Dataset, InsertDataset,
  RiskAssessment, InsertRiskAssessment,
  PrivacyOperation, InsertPrivacyOperation,
  UtilityMeasurement, InsertUtilityMeasurement,
  Report, InsertReport,
  ConfigProfile, InsertConfigProfile,
  ActivityLog, InsertActivityLog,
  SharedFile, InsertSharedFile,
} from "@shared/schema";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI must be set.");
}

export interface IStorage {
  sessionStore: session.Store;

  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined>;

  getDatasets(userId: string): Promise<Dataset[]>;
  getDataset(id: string): Promise<Dataset | undefined>;
  createDataset(dataset: InsertDataset): Promise<Dataset>;
  updateDataset(id: string, data: Partial<InsertDataset>): Promise<Dataset | undefined>;
  deleteDataset(id: string): Promise<void>;
  storeDataChunks(datasetId: string, rows: any[]): Promise<void>;
  getDatasetData(datasetId: string): Promise<any[]>;
  replaceDataChunks(datasetId: string, rows: any[]): Promise<void>;

  getRiskAssessments(userId: string): Promise<RiskAssessment[]>;
  getRiskAssessment(id: string): Promise<RiskAssessment | undefined>;
  createRiskAssessment(assessment: InsertRiskAssessment): Promise<RiskAssessment>;

  getPrivacyOperations(userId: string): Promise<PrivacyOperation[]>;
  getPrivacyOperation(id: string): Promise<PrivacyOperation | undefined>;
  createPrivacyOperation(operation: InsertPrivacyOperation): Promise<PrivacyOperation>;
  deletePrivacyOperation(id: string): Promise<void>;

  getUtilityMeasurements(userId: string): Promise<UtilityMeasurement[]>;
  getUtilityMeasurement(id: string): Promise<UtilityMeasurement | undefined>;
  createUtilityMeasurement(measurement: InsertUtilityMeasurement): Promise<UtilityMeasurement>;

  getReports(userId: string): Promise<Report[]>;
  getReport(id: string): Promise<Report | undefined>;
  createReport(report: InsertReport): Promise<Report>;
  deleteReport(id: string): Promise<void>;

  getConfigProfiles(): Promise<ConfigProfile[]>;
  getConfigProfile(id: string): Promise<ConfigProfile | undefined>;
  createConfigProfile(profile: InsertConfigProfile): Promise<ConfigProfile>;
  deleteConfigProfile(id: string): Promise<void>;

  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;

  // Admin - User Management
  getAllUsers(): Promise<User[]>;
  deleteUser(id: string): Promise<void>;

  // Shared Files
  createSharedFile(data: InsertSharedFile): Promise<SharedFile>;
  getSharedFilesByOwner(sharedByUserId: string): Promise<SharedFile[]>;
  getSharedFilesForUser(sharedWithUserId: string): Promise<SharedFile[]>;
  deleteSharedFile(id: string): Promise<void>;

  getStats(userId: string): Promise<{ datasets: number; assessments: number; reports: number; operations: number }>;
}

function doc<T>(d: any): T {
  return d.toJSON() as T;
}

export class MongoStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = MongoStore.create({
      mongoUrl: process.env.MONGODB_URI!,
      collectionName: "sessions",
      ttl: 24 * 60 * 60,
    });
  }

  // ── Users ──────────────────────────────────────────────────────────────────
  async getUser(id: string): Promise<User | undefined> {
    const user = await UserModel.findById(id);
    return user ? doc<User>(user) : undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const user = await UserModel.findOne({ username });
    return user ? doc<User>(user) : undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const user = await UserModel.create(insertUser);
    return doc<User>(user);
  }

  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const user = await UserModel.findByIdAndUpdate(id, data, { new: true });
    return user ? doc<User>(user) : undefined;
  }

  // ── Datasets ───────────────────────────────────────────────────────────────
  async getDatasets(userId: string): Promise<Dataset[]> {
    const list = await DatasetModel.find({ userId }).sort({ uploadedAt: -1 });
    return list.map((d) => doc<Dataset>(d));
  }

  async getDataset(id: string): Promise<Dataset | undefined> {
    try {
      const d = await DatasetModel.findById(id);
      return d ? doc<Dataset>(d) : undefined;
    } catch {
      return undefined;
    }
  }

  async createDataset(dataset: InsertDataset): Promise<Dataset> {
    const { data: _rows, ...meta } = dataset as any;
    const d = await DatasetModel.create(meta);
    return doc<Dataset>(d);
  }

  async updateDataset(id: string, data: Partial<InsertDataset>): Promise<Dataset | undefined> {
    const { data: _rows, ...meta } = data as any;
    const d = await DatasetModel.findByIdAndUpdate(id, meta, { new: true });
    return d ? doc<Dataset>(d) : undefined;
  }

  // ── DataChunks ─────────────────────────────────────────────────────────────
  private static readonly CHUNK_SIZE = 500;   // rows per MongoDB document (~safe below 16 MB)
  private static readonly INSERT_BATCH = 20;   // chunks per insertMany call

  async storeDataChunks(datasetId: string, rows: any[]): Promise<void> {
    const size = MongoStorage.CHUNK_SIZE;
    const chunks: object[] = [];
    for (let i = 0; i < rows.length; i += size) {
      chunks.push({ datasetId, chunkIndex: Math.floor(i / size), rows: rows.slice(i, i + size) });
    }
    // Insert in batches so no single wire message becomes enormous
    const batchSize = MongoStorage.INSERT_BATCH;
    for (let b = 0; b < chunks.length; b += batchSize) {
      await DataChunkModel.insertMany(chunks.slice(b, b + batchSize), { ordered: true });
    }
  }

  async getDatasetData(datasetId: string): Promise<any[]> {
    const chunks = await DataChunkModel.find({ datasetId }).sort({ chunkIndex: 1 }).lean();
    const result: any[] = [];
    for (const chunk of chunks) {
      const rows = chunk.rows as any[];
      for (const row of rows) result.push(row);
    }
    return result;
  }

  async replaceDataChunks(datasetId: string, rows: any[]): Promise<void> {
    await DataChunkModel.deleteMany({ datasetId });
    await this.storeDataChunks(datasetId, rows);
  }

  async deleteDataset(id: string): Promise<void> {
    await DataChunkModel.deleteMany({ datasetId: id });
    const ops = await PrivacyOperationModel.find({ datasetId: id }).select("_id");
    const opIds = ops.map((o) => o._id);
    if (opIds.length > 0) {
      await UtilityMeasurementModel.deleteMany({ processedOperationId: { $in: opIds } });
    }
    await ReportModel.deleteMany({ datasetId: id });
    await RiskAssessmentModel.deleteMany({ datasetId: id });
    await PrivacyOperationModel.deleteMany({ datasetId: id });
    await DatasetModel.findByIdAndDelete(id);
  }

  // ── Risk Assessments ───────────────────────────────────────────────────────
  async getRiskAssessments(userId: string): Promise<RiskAssessment[]> {
    const list = await RiskAssessmentModel.find({ userId }).sort({ createdAt: -1 });
    return list.map((d) => doc<RiskAssessment>(d));
  }

  async getRiskAssessment(id: string): Promise<RiskAssessment | undefined> {
    try {
      const d = await RiskAssessmentModel.findById(id);
      return d ? doc<RiskAssessment>(d) : undefined;
    } catch {
      return undefined;
    }
  }

  async createRiskAssessment(assessment: InsertRiskAssessment): Promise<RiskAssessment> {
    const d = await RiskAssessmentModel.create(assessment);
    return doc<RiskAssessment>(d);
  }

  // ── Privacy Operations ─────────────────────────────────────────────────────
  async getPrivacyOperations(userId: string): Promise<PrivacyOperation[]> {
    const list = await PrivacyOperationModel.find({ userId }).sort({ createdAt: -1 });
    return list.map((d) => doc<PrivacyOperation>(d));
  }

  async getPrivacyOperation(id: string): Promise<PrivacyOperation | undefined> {
    try {
      const d = await PrivacyOperationModel.findById(id);
      return d ? doc<PrivacyOperation>(d) : undefined;
    } catch {
      return undefined;
    }
  }

  async createPrivacyOperation(operation: InsertPrivacyOperation): Promise<PrivacyOperation> {
    const d = await PrivacyOperationModel.create(operation);
    return doc<PrivacyOperation>(d);
  }

  async deletePrivacyOperation(id: string): Promise<void> {
    try {
      await PrivacyOperationModel.findByIdAndDelete(id);
      // Also cascade delete related utility measurements
      await UtilityMeasurementModel.deleteMany({ processedOperationId: id });
    } catch {
      // ignore invalid id
    }
  }

  // ── Utility Measurements ───────────────────────────────────────────────────
  async getUtilityMeasurements(userId: string): Promise<UtilityMeasurement[]> {
    const list = await UtilityMeasurementModel.find({ userId }).sort({ createdAt: -1 });
    return list.map((d) => doc<UtilityMeasurement>(d));
  }

  async getUtilityMeasurement(id: string): Promise<UtilityMeasurement | undefined> {
    try {
      const d = await UtilityMeasurementModel.findById(id);
      return d ? doc<UtilityMeasurement>(d) : undefined;
    } catch {
      return undefined;
    }
  }

  async createUtilityMeasurement(measurement: InsertUtilityMeasurement): Promise<UtilityMeasurement> {
    const d = await UtilityMeasurementModel.create(measurement);
    return doc<UtilityMeasurement>(d);
  }

  // ── Reports ────────────────────────────────────────────────────────────────
  async getReports(userId: string): Promise<Report[]> {
    const list = await ReportModel.find({ userId }).sort({ createdAt: -1 });
    return list.map((d) => doc<Report>(d));
  }

  async getReport(id: string): Promise<Report | undefined> {
    try {
      const d = await ReportModel.findById(id);
      return d ? doc<Report>(d) : undefined;
    } catch {
      return undefined;
    }
  }

  async createReport(report: InsertReport): Promise<Report> {
    const d = await ReportModel.create(report);
    return doc<Report>(d);
  }

  async deleteReport(id: string): Promise<void> {
    await ReportModel.findByIdAndDelete(id);
  }

  // ── Config Profiles ────────────────────────────────────────────────────────
  async getConfigProfiles(): Promise<ConfigProfile[]> {
    const list = await ConfigProfileModel.find().sort({ createdAt: -1 });
    return list.map((d) => doc<ConfigProfile>(d));
  }

  async getConfigProfile(id: string): Promise<ConfigProfile | undefined> {
    try {
      const d = await ConfigProfileModel.findById(id);
      return d ? doc<ConfigProfile>(d) : undefined;
    } catch {
      return undefined;
    }
  }

  async createConfigProfile(profile: InsertConfigProfile): Promise<ConfigProfile> {
    const d = await ConfigProfileModel.create(profile);
    return doc<ConfigProfile>(d);
  }

  async deleteConfigProfile(id: string): Promise<void> {
    await ConfigProfileModel.findByIdAndDelete(id);
  }

  // ── Activity Logs ──────────────────────────────────────────────────────────
  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const d = await ActivityLogModel.create(log);
    return doc<ActivityLog>(d);
  }

  // ── Admin - User Management ────────────────────────────────────────────────
  async getAllUsers(): Promise<User[]> {
    const list = await UserModel.find().sort({ createdAt: -1 });
    return list.map((d) => doc<User>(d));
  }

  async deleteUser(id: string): Promise<void> {
    await UserModel.findByIdAndDelete(id);
  }

  // ── Shared Files ───────────────────────────────────────────────────────────
  async createSharedFile(data: InsertSharedFile): Promise<SharedFile> {
    const d = await SharedFileModel.create(data);
    return doc<SharedFile>(d);
  }

  async getSharedFilesByOwner(sharedByUserId: string): Promise<SharedFile[]> {
    const list = await SharedFileModel.find({ sharedByUserId }).sort({ sharedAt: -1 });
    return list.map((d) => doc<SharedFile>(d));
  }

  async getSharedFilesForUser(sharedWithUserId: string): Promise<SharedFile[]> {
    const list = await SharedFileModel.find({ sharedWithUserId }).sort({ sharedAt: -1 });
    return list.map((d) => doc<SharedFile>(d));
  }

  async deleteSharedFile(id: string): Promise<void> {
    try {
      await SharedFileModel.findByIdAndDelete(id);
    } catch {
      // ignore invalid id
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  async getStats(userId: string): Promise<{ datasets: number; assessments: number; reports: number; operations: number }> {
    const [datasets, assessments, reports, operations] = await Promise.all([
      DatasetModel.countDocuments({ userId }),
      RiskAssessmentModel.countDocuments({ userId }),
      ReportModel.countDocuments({ userId }),
      PrivacyOperationModel.countDocuments({ userId }),
    ]);
    return { datasets, assessments, reports, operations };
  }
}

export const storage = new MongoStorage();
