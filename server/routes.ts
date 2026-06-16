import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, hashPassword } from "./auth";
import multer from "multer";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { v4 as uuidv4 } from "uuid";
import { calculateRiskMetrics, getRiskLevel } from "./risk-utils";
import { applyLDiversityDistinct, applyTCloseness, applyKAnonymityEnhanced } from "./privacy-utils";
import { computeUtilityMetrics, getGrade } from "./utility-compute";

const upload = multer({ storage: multer.memoryStorage() });

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).send("Unauthorized");
  }
  next();
}

// Helper: Standardize string values with abbreviation handling
function standardizeStringValues(data: any[], columns: string[]): { data: any[], fixes: string[] } {
  const fixes: string[] = [];
  const stringColumns = columns.filter((col) => {
    return data.length > 0 && typeof data[0][col] === "string";
  });

  // Common mappings for known fields
  const knownMappings: Record<string, Record<string, string>> = {
    gender: {
      "m": "Male", "male": "Male", "M": "Male",
      "f": "Female", "female": "Female", "F": "Female",
      "o": "Other", "other": "Other", "O": "Other",
    },
    sex: {
      "m": "Male", "male": "Male", "M": "Male",
      "f": "Female", "female": "Female", "F": "Female",
    },
    status: {
      "s": "Single", "single": "Single", "S": "Single",
      "m": "Married", "married": "Married", "M": "Married",
      "d": "Divorced", "divorced": "Divorced", "D": "Divorced",
      "w": "Widowed", "widowed": "Widowed", "W": "Widowed",
    },
    "marital_status": {
      "s": "Single", "single": "Single", "S": "Single",
      "m": "Married", "married": "Married", "M": "Married",
      "d": "Divorced", "divorced": "Divorced", "D": "Divorced",
      "w": "Widowed", "widowed": "Widowed", "W": "Widowed",
    },
  };

  const canonicalMaps = new Map<string, Map<string, string>>();
  
  stringColumns.forEach((col) => {
    const colLower = col.toLowerCase();
    const knownMapping = Object.entries(knownMappings).find(([key]) => colLower.includes(key))?.[1];
    
    const valueMap = new Map<string, Set<string>>();
    const canonicalMap = new Map<string, string>();
    
    data.forEach((row) => {
      const val = String(row[col] || "").trim();
      let canonical = val;

      // Use known mapping if available
      if (knownMapping) {
        canonical = knownMapping[val.toLowerCase()] || val;
      } else {
        // Normalize to Title Case
        canonical = val
          .toLowerCase()
          .split(/\s+/)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
      }

      canonicalMap.set(val, canonical);
      
      const normalized = canonical.toLowerCase();
      if (!valueMap.has(normalized)) {
        valueMap.set(normalized, new Set());
      }
      valueMap.get(normalized)!.add(canonical);
    });

    let hasVariations = false;
    data.forEach((row) => {
      const val = String(row[col] || "").trim();
      const mapped = canonicalMap.get(val);
      if (mapped && val !== mapped) {
        hasVariations = true;
      }
    });

    if (hasVariations) {
      fixes.push(`Standardized ${col}: normalized ${Array.from(new Set(data.map((r) => String(r[col] || "").trim()))).length} variations to consistent format`);
      canonicalMaps.set(col, canonicalMap);
    }
  });

  if (canonicalMaps.size > 0) {
    const standardizedData = data.map((row) => {
      const newRow = { ...row };
      canonicalMaps.forEach((canonicalMap, col) => {
        if (newRow[col]) {
          const val = String(newRow[col]).trim();
          newRow[col] = canonicalMap.get(val) || val;
        }
      });
      return newRow;
    });
    
    return { data: standardizedData, fixes };
  }
  
  return { data, fixes: [] };
}

async function seedDefaults() {
  const existing = await storage.getUserByUsername("admin");
  if (!existing) {
    await storage.createUser({
      username: "admin",
      password: await hashPassword("admin@123"),
      email: "admin@gov.in",
      fullName: "System Administrator",
      role: "admin",
      department: "Ministry of Electronics and Information Technology",
      permissions: ["data_upload", "risk_assessment", "privacy_enhancement", "utility_measurement", "report_generation"],
      twoFactorEnabled: false,
      sessionTimeout: 30,
      notificationsEnabled: true,
    });
    console.log("Default admin user created (username: admin, password: admin@123)");
  }

  const profiles = await storage.getConfigProfiles();
  if (profiles.length === 0) {
    const defaultProfiles = [
      {
        name: "High Privacy",
        description: "Maximum privacy protection for sensitive datasets",
        kValue: 10, lValue: 5, tValue: 0.2, epsilon: 0.5,
        suppressionLimit: 0.05, useCase: "sensitive",
        recommendedFor: ["health", "finance", "government"],
        governmentClearance: "Top Secret", isDefault: false,
      },
      {
        name: "Balanced",
        description: "Balance between privacy and data utility",
        kValue: 5, lValue: 3, tValue: 0.3, epsilon: 1.0,
        suppressionLimit: 0.1, useCase: "general",
        recommendedFor: ["research", "analytics"],
        governmentClearance: "Secret", isDefault: true,
      },
      {
        name: "High Utility",
        description: "Preserve maximum data utility with moderate privacy",
        kValue: 3, lValue: 2, tValue: 0.5, epsilon: 2.0,
        suppressionLimit: 0.15, useCase: "analytics",
        recommendedFor: ["public", "research"],
        governmentClearance: "Unclassified", isDefault: false,
      },
    ];
    for (const p of defaultProfiles) {
      await storage.createConfigProfile(p);
    }
    console.log("Default config profiles created");
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);

  await seedDefaults();

  // Stats endpoint
  app.get("/api/stats", requireAuth, async (req, res) => {
    try {
      const stats = await storage.getStats(req.user!.id);
      res.json(stats);
    } catch (error) {
      res.status(500).send("Failed to get stats");
    }
  });

  // User profile endpoints
  app.put("/api/users/profile", requireAuth, async (req, res) => {
    try {
      const user = await storage.updateUser(req.user!.id, req.body);
      res.json(user);
    } catch (error) {
      res.status(500).send("Failed to update profile");
    }
  });

  app.put("/api/users/password", requireAuth, async (req, res) => {
    try {
      const hashedPassword = await hashPassword(req.body.newPassword);
      const user = await storage.updateUser(req.user!.id, { password: hashedPassword });
      res.json({ message: "Password updated" });
    } catch (error) {
      res.status(500).send("Failed to update password");
    }
  });

  // Dataset endpoints
  app.get("/api/datasets", requireAuth, async (req, res) => {
    try {
      const datasets = await storage.getDatasets(req.user!.id);
      res.json(datasets);
    } catch (error) {
      res.status(500).send("Failed to get datasets");
    }
  });

  app.post("/api/data/upload", requireAuth, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).send("No file uploaded");
      }

      const file = req.file;
      const extension = file.originalname.split(".").pop()?.toLowerCase();
      let data: any[] = [];
      let columns: string[] = [];

      if (extension === "csv") {
        const csvString = file.buffer.toString("utf-8");
        const parsed = Papa.parse(csvString, { header: true, skipEmptyLines: true });
        data = parsed.data as any[];
        columns = parsed.meta.fields || [];
      } else if (extension === "xlsx" || extension === "xls") {
        const workbook = XLSX.read(file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        data = XLSX.utils.sheet_to_json(sheet);
        if (data.length > 0) {
          columns = Object.keys(data[0]);
        }
      } else if (extension === "json") {
        data = JSON.parse(file.buffer.toString("utf-8"));
        if (Array.isArray(data) && data.length > 0) {
          columns = Object.keys(data[0]);
        }
      } else {
        return res.status(400).send("Unsupported file format");
      }

      // Calculate comprehensive quality scores
      let totalCells = 0;
      let filledCells = 0;
      let duplicateRows = 0;
      
      // Check completeness
      data.forEach((row) => {
        columns.forEach((col) => {
          totalCells++;
          if (row[col] !== null && row[col] !== undefined && row[col] !== "") {
            filledCells++;
          }
        });
      });

      // Check for exact duplicate rows
      const rowSignatures = new Set<string>();
      data.forEach((row) => {
        const sig = JSON.stringify(row);
        if (rowSignatures.has(sig)) {
          duplicateRows++;
        }
        rowSignatures.add(sig);
      });

      // Check for consistency issues (case variations, spacing, abbreviations)
      const stringColumns = columns.filter((col) => {
        return data.length > 0 && typeof data[0][col] === "string";
      });

      let inconsistentRecords = 0;
      const valueNormalizationMap = new Map<string, Map<string, string>>(); // col -> (actual -> canonical)
      
      stringColumns.forEach((col) => {
        const valueMap = new Map<string, Set<string>>(); // Normalized -> Set of actual values
        const colValues: string[] = [];
        
        data.forEach((row) => {
          const val = String(row[col] || "").trim();
          colValues.push(val);
          
          // Normalize: lowercase and remove extra spaces
          const normalized = val.toLowerCase().replace(/\s+/g, " ");
          
          if (!valueMap.has(normalized)) {
            valueMap.set(normalized, new Set());
          }
          valueMap.get(normalized)!.add(val);
        });

        // Build canonical mapping for this column
        const canonicalMap = new Map<string, string>();
        valueMap.forEach((variations, normalized) => {
          // Pick the first variation as canonical (usually the most common)
          const canonical = Array.from(variations)[0];
          variations.forEach((variation) => {
            canonicalMap.set(variation, canonical);
          });
        });
        
        valueNormalizationMap.set(col, canonicalMap);

        // Count inconsistent records: any record with non-canonical casing/spacing
        data.forEach((row) => {
          const val = String(row[col] || "").trim();
          const canonical = canonicalMap.get(val);
          if (canonical && val !== canonical) {
            inconsistentRecords++;
          }
        });
      });

      // Calculate individual scores (0 to 1)
      const completenessScore = totalCells > 0 ? filledCells / totalCells : 0;
      const duplicationScore = duplicateRows > 0 ? Math.max(0, 1 - (duplicateRows / data.length)) : 1.0;
      const consistencyScore = inconsistentRecords > 0 ? Math.max(0.1, 1 - (inconsistentRecords / Math.max(1, data.length * 0.5))) : 1.0;
      
      // Weighted quality score (0 to 1)
      const qualityScore = Math.max(0, Math.min(1, completenessScore * 0.4 + duplicationScore * 0.35 + consistencyScore * 0.25));

      const dataset = await storage.createDataset({
        userId: req.user!.id,
        filename: uuidv4() + "." + extension,
        originalName: file.originalname,
        format: extension || "unknown",
        size: file.size,
        columns,
        rowCount: data.length,
        qualityScore,
        completenessScore,
        consistencyScore: consistencyScore || 0.9,
        validityScore: 0.85,
        data,
      });

      await storage.createActivityLog({
        userId: req.user!.id,
        action: "upload",
        entityType: "dataset",
        entityId: dataset.id,
        details: { filename: file.originalname },
      });

      res.json(dataset);
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).send("Failed to process file");
    }
  });

  app.get("/api/data/:id", requireAuth, async (req, res) => {
    try {
      const dataset = await storage.getDataset(req.params.id);
      if (!dataset) {
        return res.status(404).send("Dataset not found");
      }
      res.json(dataset);
    } catch (error) {
      res.status(500).send("Failed to get dataset");
    }
  });

  app.get("/api/data/:id/preview", requireAuth, async (req, res) => {
    try {
      const dataset = await storage.getDataset(req.params.id);
      if (!dataset) {
        return res.status(404).send("Dataset not found");
      }
      const data = dataset.data as any[];
      res.json({
        columns: dataset.columns,
        rows: data.slice(0, 100),
      });
    } catch (error) {
      res.status(500).send("Failed to get preview");
    }
  });

  app.post("/api/data/:id/autofix", requireAuth, async (req, res) => {
    try {
      const dataset = await storage.getDataset(req.params.id);
      if (!dataset) {
        return res.status(404).send("Dataset not found");
      }

      let data = (dataset.data as any[]) || [];
      const columns = dataset.columns || [];
      const fixes: string[] = [];

      // Fix 1: Remove duplicate rows
      const uniqueRows = new Map<string, any>();
      data.forEach((row) => {
        const sig = JSON.stringify(row);
        if (!uniqueRows.has(sig)) {
          uniqueRows.set(sig, row);
        }
      });
      
      const duplicatesRemoved = data.length - uniqueRows.size;
      if (duplicatesRemoved > 0) {
        data = Array.from(uniqueRows.values());
        fixes.push(`Removed ${duplicatesRemoved} duplicate records`);
      }

      // Fix 2: Standardize string values (handle case variations)
      const { data: standardizedData, fixes: standardizationFixes } = standardizeStringValues(data, columns);
      data = standardizedData;
      fixes.push(...standardizationFixes);

      // Fix 3: Handle missing values intelligently
      const stringColumns = columns.filter((col) => {
        return data.length > 0 && typeof data[0][col] === "string";
      });
      
      const numericColumns = columns.filter((col) => {
        return data.length > 0 && typeof data[0][col] === "number";
      });

      // For numeric columns, fill missing with median
      numericColumns.forEach((col) => {
        const values = data
          .map((row) => row[col])
          .filter((val) => typeof val === "number");
        
        if (values.length > 0) {
          values.sort((a, b) => a - b);
          const median = values[Math.floor(values.length / 2)];
          
          data = data.map((row) => {
            if (!row[col] || row[col] === "" || row[col] === null || row[col] === undefined) {
              return { ...row, [col]: median };
            }
            return row;
          });
        }
      });

      // For string columns, fill with "Unknown"
      stringColumns.forEach((col) => {
        data = data.map((row) => {
          if (!row[col] || row[col] === "" || row[col] === null || row[col] === undefined) {
            return { ...row, [col]: "Unknown" };
          }
          return row;
        });
      });

      if (fixes.length > 0) {
        fixes.push("Filled missing values with appropriate defaults");
      }

      // Recalculate quality scores
      let totalCells = 0;
      let filledCells = 0;
      
      data.forEach((row) => {
        columns.forEach((col) => {
          totalCells++;
          if (row[col] !== null && row[col] !== undefined && row[col] !== "") {
            filledCells++;
          }
        });
      });

      const newCompletenessScore = totalCells > 0 ? filledCells / totalCells : 0;
      
      // Update dataset with fixed data
      const updatedDataset = await storage.updateDataset(dataset.id, {
        data,
        qualityScore: Math.min(0.99, newCompletenessScore + 0.1),
        completenessScore: newCompletenessScore,
      });

      await storage.createActivityLog({
        userId: req.user!.id,
        action: "autofix",
        entityType: "dataset",
        entityId: dataset.id,
        details: { fixes },
      });

      res.json({ success: true, fixes, dataset: updatedDataset });
    } catch (error) {
      console.error("Auto-fix error:", error);
      res.status(500).send("Failed to auto-fix dataset");
    }
  });

  app.delete("/api/datasets/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteDataset(req.params.id);
      res.sendStatus(200);
    } catch (error) {
      res.status(500).send("Failed to delete dataset");
    }
  });

  // Risk Assessment endpoints
  app.get("/api/risk/assessments", requireAuth, async (req, res) => {
    try {
      const assessments = await storage.getRiskAssessments(req.user!.id);
      res.json(assessments);
    } catch (error) {
      res.status(500).send("Failed to get assessments");
    }
  });

  app.post("/api/risk/assess", requireAuth, async (req, res) => {
    try {
      const { datasetId, quasiIdentifiers, sensitiveAttributes, kThreshold, sampleSize, attackScenarios } = req.body;
      
      const dataset = await storage.getDataset(datasetId);
      if (!dataset) {
        return res.status(404).send("Dataset not found");
      }

      const data = dataset.data as any[];

      // Use proper academic risk calculation with NISTIR 8053 methodology
      const riskMetrics = calculateRiskMetrics(
        data,
        quasiIdentifiers,
        kThreshold,
        sampleSize
      );

      // Determine overall risk based on selected attack scenario
      let overallRisk = riskMetrics.prosecutorRisk; // Default to highest risk (prosecutor)
      let riskLevel: "Low" | "Medium" | "High" = getRiskLevel(overallRisk);
      
      if (attackScenarios && attackScenarios.length > 0) {
        const attackType = attackScenarios[0];
        if (attackType === "journalist") {
          overallRisk = riskMetrics.journalistRisk;
        } else if (attackType === "marketer") {
          overallRisk = riskMetrics.marketerRisk;
        }
        riskLevel = getRiskLevel(overallRisk);
      }

      // Generate histogram data from equivalence classes
      const histogram = [
        { size: "1", count: riskMetrics.equivalenceClasses.filter(ec => ec.size === 1).length },
        { size: "2-4", count: riskMetrics.equivalenceClasses.filter(ec => ec.size >= 2 && ec.size <= 4).length },
        { size: "5-10", count: riskMetrics.equivalenceClasses.filter(ec => ec.size >= 5 && ec.size <= 10).length },
        { size: ">10", count: riskMetrics.equivalenceClasses.filter(ec => ec.size > 10).length },
      ];

      const assessment = await storage.createRiskAssessment({
        datasetId,
        userId: req.user!.id,
        quasiIdentifiers,
        sensitiveAttributes: sensitiveAttributes || [],
        kThreshold,
        overallRisk,
        riskLevel,
        violations: data.length - riskMetrics.equivalenceClasses.filter(ec => ec.size >= kThreshold).reduce((sum, ec) => sum + ec.size, 0),
        uniqueRecords: riskMetrics.uniqueRecords,
        equivalenceClasses: {
          histogram,
          totalClasses: riskMetrics.equivalenceClasses.length,
          prosecutorRisk: riskMetrics.prosecutorRisk,
          journalistRisk: riskMetrics.journalistRisk,
          marketerRisk: riskMetrics.marketerRisk,
        },
        attackScenarios: attackScenarios || [],
        recommendations: riskMetrics.recommendations,
      });

      await storage.createActivityLog({
        userId: req.user!.id,
        action: "assess",
        entityType: "risk_assessment",
        entityId: assessment.id,
        details: { datasetId, attackType: attackScenarios?.[0] || "prosecutor", riskLevel },
      });

      res.json(assessment);
    } catch (error) {
      console.error("Assessment error:", error);
      res.status(500).send("Failed to run assessment");
    }
  });

  // Privacy Enhancement endpoints
  app.get("/api/privacy/operations", requireAuth, async (req, res) => {
    try {
      const operations = await storage.getPrivacyOperations(req.user!.id);
      res.json(operations);
    } catch (error) {
      res.status(500).send("Failed to get operations");
    }
  });

  // Save a client-side privacy result to the database
  app.post("/api/privacy/save-result", requireAuth, async (req, res) => {
    try {
      const { datasetId, technique, method, parameters, processedData, recordsSuppressed, informationLoss } = req.body;
      if (!datasetId || !technique) return res.status(400).send("Missing required fields");
      const dataset = await storage.getDataset(datasetId);
      if (!dataset || dataset.userId !== req.user!.id) return res.status(403).send("Forbidden");
      const operation = await storage.createPrivacyOperation({
        datasetId,
        userId: req.user!.id,
        technique,
        method: method ?? null,
        parameters: parameters ?? {},
        processedData: processedData ?? [],
        recordsSuppressed: recordsSuppressed ?? 0,
        informationLoss: informationLoss ?? 0,
      });
      res.json(operation);
    } catch (error) {
      res.status(500).send("Failed to save result");
    }
  });

  const applyKAnonymity = (data: any[], quasiIdentifiers: string[], kValue: number, suppressionLimit: number) => {
    // Group by quasi-identifiers
    const groups = new Map<string, any[]>();
    data.forEach((row) => {
      const key = quasiIdentifiers.map((qi) => row[qi]).join("|");
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push({ ...row });
    });

    let processedData: any[] = [];
    let suppressedCount = 0;
    let generalizedCount = 0;
    const maxSuppressed = Math.floor(data.length * suppressionLimit);

    groups.forEach((records) => {
      if (records.length >= kValue) {
        processedData.push(...records);
      } else {
        if (suppressedCount + records.length <= maxSuppressed) {
          // Suppress these records
          suppressedCount += records.length;
        } else {
          // Generalize instead
          const generalizedRecords = records.map((r) => {
            const generalized = { ...r };
            quasiIdentifiers.forEach((qi) => {
              if (typeof generalized[qi] === "number") {
                generalized[qi] = Math.floor(generalized[qi] / 10) * 10;
              } else {
                generalized[qi] = "*";
              }
            });
            return generalized;
          });
          processedData.push(...generalizedRecords);
          generalizedCount += records.length;
        }
      }
    });

    return { processedData, suppressedCount, generalizedCount, informationLoss: suppressedCount / data.length };
  };

  const addLaplaceNoise = (data: any[], columns: string[], epsilon: number) => {
    const processedData = data.map((row) => {
      const newRow = { ...row };
      columns.forEach((col) => {
        if (typeof newRow[col] === "number") {
          const sensitivity = 1;
          const scale = sensitivity / epsilon;
          const u = Math.random() - 0.5;
          const noise = -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
          newRow[col] = newRow[col] + noise;
        }
      });
      return newRow;
    });
    return { processedData, informationLoss: 0.1 * (1 / epsilon) };
  };

  app.post("/api/privacy/k-anonymity", requireAuth, async (req, res) => {
    try {
      const { datasetId, quasiIdentifiers, kValue, suppressionLimit, method } = req.body;
      
      const dataset = await storage.getDataset(datasetId);
      if (!dataset) {
        return res.status(404).send("Dataset not found");
      }

      const data = dataset.data as any[];
      const { 
        processedData, 
        recordsSuppressed, 
        informationLoss, 
        equivalenceClasses, 
        avgGroupSize, 
        minGroupSize, 
        maxGroupSize, 
        privacyRisk 
      } = applyKAnonymityEnhanced(
        data,
        quasiIdentifiers,
        kValue,
        suppressionLimit
      );

      const operation = await storage.createPrivacyOperation({
        datasetId,
        userId: req.user!.id,
        technique: "k-anonymity",
        method,
        parameters: { 
          kValue, 
          suppressionLimit, 
          quasiIdentifiers, 
          equivalenceClasses, 
          avgGroupSize, 
          minGroupSize, 
          maxGroupSize, 
          privacyRisk 
        },
        processedData,
        recordsSuppressed,
        informationLoss,
      });

      res.json(operation);
    } catch (error) {
      console.error("K-anonymity error:", error);
      res.status(500).send("Failed to apply k-anonymity");
    }
  });

  app.post("/api/privacy/l-diversity", requireAuth, async (req, res) => {
    try {
      const { datasetId, quasiIdentifiers, lValue, sensitiveAttribute, method } = req.body;
      
      const dataset = await storage.getDataset(datasetId);
      if (!dataset) {
        return res.status(404).send("Dataset not found");
      }

      const data = dataset.data as any[];
      const { 
        processedData, 
        recordsSuppressed, 
        informationLoss, 
        diverseClasses, 
        violatingClasses, 
        avgDiversity,
        minDiversity,
        maxDiversity,
        privacyRisk,
        diversityScore
      } = applyLDiversityDistinct(
        data,
        quasiIdentifiers,
        sensitiveAttribute,
        lValue
      );

      const operation = await storage.createPrivacyOperation({
        datasetId,
        userId: req.user!.id,
        technique: "l-diversity",
        method: method || "distinct",
        parameters: { 
          lValue, 
          sensitiveAttribute, 
          quasiIdentifiers, 
          diverseClasses, 
          violatingClasses, 
          avgDiversity,
          minDiversity,
          maxDiversity,
          privacyRisk,
          diversityScore
        },
        processedData,
        recordsSuppressed,
        informationLoss,
      });

      res.json(operation);
    } catch (error) {
      console.error("L-diversity error:", error);
      res.status(500).send("Failed to apply l-diversity");
    }
  });

  app.post("/api/privacy/t-closeness", requireAuth, async (req, res) => {
    try {
      const { datasetId, quasiIdentifiers, tValue, sensitiveAttribute } = req.body;
      
      const dataset = await storage.getDataset(datasetId);
      if (!dataset) {
        return res.status(404).send("Dataset not found");
      }

      const data = dataset.data as any[];
      const { processedData, recordsSuppressed, informationLoss, satisfyingClasses, violatingClasses, avgDistance, maxDistance } = applyTCloseness(
        data,
        quasiIdentifiers,
        sensitiveAttribute,
        tValue
      );

      const operation = await storage.createPrivacyOperation({
        datasetId,
        userId: req.user!.id,
        technique: "t-closeness",
        method: "emd",
        parameters: { tValue, sensitiveAttribute, quasiIdentifiers, satisfyingClasses, violatingClasses, avgDistance, maxDistance },
        processedData,
        recordsSuppressed,
        informationLoss,
      });

      res.json(operation);
    } catch (error) {
      console.error("T-closeness error:", error);
      res.status(500).send("Failed to apply t-closeness");
    }
  });

  app.post("/api/privacy/differential-privacy", requireAuth, async (req, res) => {
    try {
      const { datasetId, quasiIdentifiers, epsilon, mechanism } = req.body;
      
      const dataset = await storage.getDataset(datasetId);
      if (!dataset) {
        return res.status(404).send("Dataset not found");
      }

      const data = dataset.data as any[];
      const numericColumns = dataset.columns?.filter((col) => {
        return data.length > 0 && typeof data[0][col] === "number";
      }) || [];

      const { processedData, informationLoss } = addLaplaceNoise(data, numericColumns, epsilon);

      const operation = await storage.createPrivacyOperation({
        datasetId,
        userId: req.user!.id,
        technique: "differential-privacy",
        method: mechanism,
        parameters: { epsilon, quasiIdentifiers },
        processedData,
        recordsSuppressed: 0,
        informationLoss,
      });

      res.json(operation);
    } catch (error) {
      res.status(500).send("Failed to apply differential privacy");
    }
  });

  app.post("/api/privacy/synthetic-data", requireAuth, async (req, res) => {
    try {
      const { datasetId, quasiIdentifiers, sampleSize, method } = req.body;
      
      const dataset = await storage.getDataset(datasetId);
      if (!dataset) {
        return res.status(404).send("Dataset not found");
      }

      const data = dataset.data as any[];
      const targetSize = Math.floor(data.length * (sampleSize / 100));
      
      // Simple synthetic data generation
      const syntheticData = [];
      for (let i = 0; i < targetSize; i++) {
        const sourceRow = data[Math.floor(Math.random() * data.length)];
        const syntheticRow: any = {};
        
        dataset.columns?.forEach((col) => {
          const value = sourceRow[col];
          if (typeof value === "number") {
            syntheticRow[col] = value * (0.9 + Math.random() * 0.2);
          } else {
            syntheticRow[col] = value;
          }
        });
        
        syntheticData.push(syntheticRow);
      }

      const operation = await storage.createPrivacyOperation({
        datasetId,
        userId: req.user!.id,
        technique: "synthetic-data",
        method,
        parameters: { sampleSize, quasiIdentifiers },
        processedData: syntheticData,
        recordsSuppressed: 0,
        informationLoss: 0.2,
      });

      res.json(operation);
    } catch (error) {
      res.status(500).send("Failed to generate synthetic data");
    }
  });

  app.get("/api/privacy/:id/download", requireAuth, async (req, res) => {
    try {
      const operation = await storage.getPrivacyOperation(req.params.id);
      if (!operation) {
        return res.status(404).send("Operation not found");
      }

      const data = operation.processedData as any[];
      const csv = Papa.unparse(data);
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=anonymized_${operation.id}.csv`);
      res.send(csv);
    } catch (error) {
      res.status(500).send("Failed to download");
    }
  });

  // Utility Measurement endpoints
  app.get("/api/utility/measurements", requireAuth, async (req, res) => {
    try {
      const measurements = await storage.getUtilityMeasurements(req.user!.id);
      res.json(measurements);
    } catch (error) {
      res.status(500).send("Failed to get measurements");
    }
  });

  app.post("/api/utility/measure", requireAuth, async (req, res) => {
    try {
      const { originalDatasetId, processedOperationId } = req.body;

      const originalDataset = await storage.getDataset(originalDatasetId);
      const operation = await storage.getPrivacyOperation(processedOperationId);

      if (!originalDataset || !operation) {
        return res.status(404).send("Dataset or operation not found");
      }

      const originalData = (originalDataset.data as any[]) || [];
      const processedData = (operation.processedData as any[]) || [];

      if (!originalData.length) {
        return res.status(400).send("Original dataset has no data");
      }
      if (!processedData.length) {
        return res.status(400).send("Processed operation has no output data");
      }

      // Fetch last risk assessment for this dataset to get riskBefore
      let riskBefore: number | null = null;
      try {
        const riskAssessments = await storage.getRiskAssessments(req.user!.id);
        const dsRisk = riskAssessments
          .filter((r) => r.datasetId === originalDatasetId)
          .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))[0];
        if (dsRisk) riskBefore = dsRisk.overallRisk;
      } catch (_) {}

      // Run full computation engine
      const metrics = computeUtilityMetrics(
        originalData,
        processedData,
        originalDataset.columns || [],
        operation.technique,
        originalDataset.originalName,
        riskBefore,
      );

      // Map to DB schema fields
      const overallUtility = metrics.ous / 100;
      const gradeToLevel = (g: string) => {
        if (g === 'A+' || g === 'A') return 'Excellent';
        if (g === 'B') return 'Good';
        if (g === 'C') return 'Fair';
        return 'Poor';
      };
      const utilityLevel = gradeToLevel(metrics.grade);
      const informationLoss = 1 - metrics.sfs;

      const measurement = await storage.createUtilityMeasurement({
        originalDatasetId,
        processedOperationId,
        userId: req.user!.id,
        overallUtility,
        utilityLevel,
        statisticalSimilarity: { value: metrics.sfs },
        correlationPreservation: metrics.cpScore,
        distributionSimilarity: metrics.dsScore,
        informationLoss,
        queryAccuracy: { value: metrics.puScore },
        metrics: metrics as any,
        recommendations: metrics.recommendations,
      });

      res.json(measurement);
    } catch (error) {
      console.error("Utility measurement error:", error);
      res.status(500).send("Failed to measure utility");
    }
  });

  // Get last risk assessment for a specific dataset
  app.get("/api/risk/dataset/:datasetId", requireAuth, async (req, res) => {
    try {
      const datasetId = req.params.datasetId;
      const allAssessments = await storage.getRiskAssessments(req.user!.id);
      const filtered = allAssessments
        .filter((r) => r.datasetId === datasetId)
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      res.json(filtered[0] || null);
    } catch (error) {
      res.status(500).send("Failed to get risk assessment");
    }
  });

  // Report endpoints
  app.get("/api/reports", requireAuth, async (req, res) => {
    try {
      const reports = await storage.getReports(req.user!.id);
      res.json(reports);
    } catch (error) {
      res.status(500).send("Failed to get reports");
    }
  });

  app.post("/api/reports/generate", requireAuth, async (req, res) => {
    try {
      const { title, type, format, datasetId, riskAssessmentId, utilityMeasurementId } = req.body;

      const content: any = {
        title,
        generatedAt: new Date().toISOString(),
        organization: "Government of India",
        department: "Ministry of Electronics and Information Technology",
        type,
      };

      if (datasetId) {
        const dataset = await storage.getDataset(datasetId);
        if (dataset) {
          content.dataset = {
            name: dataset.originalName,
            rows: dataset.rowCount,
            columns: dataset.columns?.length,
            qualityScore: dataset.qualityScore,
          };
        }
      }

      if (riskAssessmentId) {
        const assessment = await storage.getRiskAssessment(riskAssessmentId);
        if (assessment) {
          content.riskAssessment = {
            riskLevel: assessment.riskLevel,
            overallRisk: assessment.overallRisk,
            violations: assessment.violations,
            uniqueRecords: assessment.uniqueRecords,
          };
        }
      }

      if (utilityMeasurementId) {
        const measurement = await storage.getUtilityMeasurement(utilityMeasurementId);
        if (measurement) {
          content.utilityMeasurement = {
            utilityLevel: measurement.utilityLevel,
            overallUtility: measurement.overallUtility,
            informationLoss: measurement.informationLoss,
          };
        }
      }

      const report = await storage.createReport({
        userId: req.user!.id,
        datasetId: datasetId || null,
        riskAssessmentId: riskAssessmentId || null,
        utilityMeasurementId: utilityMeasurementId || null,
        type,
        format,
        title,
        content,
      });

      await storage.createActivityLog({
        userId: req.user!.id,
        action: "generate",
        entityType: "report",
        entityId: report.id,
        details: { title, type },
      });

      res.json(report);
    } catch (error) {
      console.error("Report generation error:", error);
      res.status(500).send("Failed to generate report");
    }
  });

  app.get("/api/reports/:id/download", requireAuth, async (req, res) => {
    try {
      const report = await storage.getReport(req.params.id);
      if (!report) {
        return res.status(404).send("Report not found");
      }

      const content = report.content as any;
      
      if (report.format === "html") {
        const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>${report.title}</title>
            <style>
              body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; max-width: 900px; margin: 0 auto; color: #1e293b; line-height: 1.6; }
              header { border-bottom: 2px solid #2563eb; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; }
              .logo-box { background: #2563eb; color: white; padding: 10px 20px; border-radius: 4px; font-weight: bold; }
              h1 { color: #2563eb; margin: 0; }
              h2 { color: #334155; border-left: 4px solid #2563eb; padding-left: 10px; margin-top: 30px; }
              .section { margin: 20px 0; padding: 25px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
              .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-top: 15px; }
              .metric-card { background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #f1f5f9; }
              .metric-label { display: block; font-size: 0.875rem; color: #64748b; font-weight: 500; }
              .metric-value { display: block; font-size: 1.25rem; color: #0f172a; font-weight: 700; margin-top: 5px; }
              .badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
              .badge-high { background: #fee2e2; color: #991b1b; }
              .badge-medium { background: #fef3c7; color: #92400e; }
              .badge-low { background: #dcfce7; color: #166534; }
              .footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #64748b; font-size: 0.875rem; }
              .report-type { font-weight: 600; color: #2563eb; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.875rem; }
            </style>
          </head>
          <body>
            <header>
              <div>
                <div class="report-type">${report.type} Report</div>
                <h1>${report.title}</h1>
              </div>
              <div class="logo-box">SafeData Pipeline</div>
            </header>

            <div class="section">
              <h2>Executive Summary</h2>
              <p>This report provides a detailed analysis of data privacy risks and utility preservation for the analyzed dataset. 
              The assessment follows NISTIR 8053 methodology to ensure academic and regulatory compliance.</p>
              <div class="metric-grid">
                <div class="metric-card">
                  <span class="metric-label">Generated On</span>
                  <span class="metric-value">${new Date(content.generatedAt).toLocaleDateString()}</span>
                </div>
                <div class="metric-card">
                  <span class="metric-label">Risk Level</span>
                  <span class="metric-value">
                    <span class="badge ${content.riskAssessment?.riskLevel === 'High' ? 'badge-high' : content.riskAssessment?.riskLevel === 'Medium' ? 'badge-medium' : 'badge-low'}">
                      ${content.riskAssessment?.riskLevel || 'N/A'}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            ${content.dataset ? `
              <div class="section">
                <h2>Dataset Profile</h2>
                <div class="metric-grid">
                  <div class="metric-card"><span class="metric-label">Filename</span><span class="metric-value">${content.dataset.name}</span></div>
                  <div class="metric-card"><span class="metric-label">Record Count</span><span class="metric-value">${content.dataset.rows.toLocaleString()}</span></div>
                  <div class="metric-card"><span class="metric-label">Quality Score</span><span class="metric-value">${(content.dataset.qualityScore * 100).toFixed(1)}%</span></div>
                </div>
              </div>
            ` : ""}

            ${report.type !== 'executive' && content.riskAssessment ? `
              <div class="section">
                <h2>Privacy Risk Metrics</h2>
                <div class="metric-grid">
                  <div class="metric-card"><span class="metric-label">Overall Risk Probability</span><span class="metric-value">${(content.riskAssessment.overallRisk * 100).toFixed(2)}%</span></div>
                  <div class="metric-card"><span class="metric-label">K-Anonymity Violations</span><span class="metric-value">${content.riskAssessment.violations}</span></div>
                  <div class="metric-card"><span class="metric-label">Unique Records (Identifiable)</span><span class="metric-value">${content.riskAssessment.uniqueRecords}</span></div>
                </div>
              </div>
            ` : ""}

            ${report.type === 'comprehensive' && content.utilityMeasurement ? `
              <div class="section">
                <h2>Utility & Information Loss</h2>
                <div class="metric-grid">
                  <div class="metric-card"><span class="metric-label">Data Utility Level</span><span class="metric-value">${content.utilityMeasurement.utilityLevel}</span></div>
                  <div class="metric-card"><span class="metric-label">Utility Score</span><span class="metric-value">${(content.utilityMeasurement.overallUtility * 100).toFixed(1)}%</span></div>
                  <div class="metric-card"><span class="metric-label">Information Loss</span><span class="metric-value">${(content.utilityMeasurement.informationLoss * 100).toFixed(1)}%</span></div>
                </div>
              </div>
            ` : ""}

            <div class="footer">
              <p>SafeData Pipeline - Enterprise Data Privacy Protection System</p>
              <p>Government of India - Ministry of Statistics and Programme Implementation</p>
              <p>Developed by AIRAVATA Technologies | www.airavatatechnologies.com</p>
            </div>
          </body>
          </html>
        `;
        res.setHeader("Content-Type", "text/html");
        res.setHeader("Content-Disposition", `attachment; filename="${report.title.replace(/\s+/g, "_")}.html"`);
        res.send(html);
      }
    } catch (error) {
      res.status(500).send("Failed to download report");
    }
  });

  app.delete("/api/reports/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteReport(req.params.id);
      res.sendStatus(200);
    } catch (error) {
      res.status(500).send("Failed to delete report");
    }
  });

  // Config Profile endpoints
  app.get("/api/config/profiles", requireAuth, async (req, res) => {
    try {
      const profiles = await storage.getConfigProfiles();
      res.json(profiles);
    } catch (error) {
      res.status(500).send("Failed to get profiles");
    }
  });

  app.post("/api/config/profiles", requireAuth, async (req, res) => {
    try {
      const profile = await storage.createConfigProfile(req.body);
      res.json(profile);
    } catch (error) {
      res.status(500).send("Failed to create profile");
    }
  });

  app.delete("/api/config/profiles/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteConfigProfile(req.params.id);
      res.sendStatus(200);
    } catch (error) {
      res.status(500).send("Failed to delete profile");
    }
  });

  // ── Master-only middleware ────────────────────────────────────────────────
  function requireMaster(req: Request, res: Response, next: NextFunction) {
    if (!req.isAuthenticated()) return res.status(401).send("Unauthorized");
    const role = (req.user as any)?.role;
    if (role !== "master" && role !== "admin") return res.status(403).send("Forbidden: Master access required");
    next();
  }

  // ── Admin: User Management ────────────────────────────────────────────────
  app.get("/api/admin/users", requireMaster, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      // Never expose passwords
      const safe = users.map(({ password: _pw, ...u }) => u);
      res.json(safe);
    } catch (error) {
      res.status(500).send("Failed to get users");
    }
  });

  app.post("/api/admin/users", requireMaster, async (req, res) => {
    try {
      const { username, password, email, fullName, role, department, permissions } = req.body;
      if (!username || !password || !email || !fullName || !role) {
        return res.status(400).send("Missing required fields");
      }
      const existing = await storage.getUserByUsername(username);
      if (existing) return res.status(400).send("Username already exists");

      const user = await storage.createUser({
        username,
        password: await hashPassword(password),
        email,
        fullName,
        role,
        department: department || "",
        permissions: permissions || ["data_upload", "risk_assessment", "privacy_enhancement", "utility_measurement", "report_generation"],
      });
      const { password: _pw, ...safe } = user;
      res.status(201).json(safe);
    } catch (error) {
      res.status(500).send("Failed to create user");
    }
  });

  app.put("/api/admin/users/:id", requireMaster, async (req, res) => {
    try {
      const { password, ...updates } = req.body;
      const data: any = { ...updates };
      if (password) data.password = await hashPassword(password);
      const user = await storage.updateUser(req.params.id, data);
      if (!user) return res.status(404).send("User not found");
      const { password: _pw, ...safe } = user;
      res.json(safe);
    } catch (error) {
      res.status(500).send("Failed to update user");
    }
  });

  app.delete("/api/admin/users/:id", requireMaster, async (req, res) => {
    try {
      if (req.params.id === (req.user as any).id) {
        return res.status(400).send("Cannot delete your own account");
      }
      await storage.deleteUser(req.params.id);
      res.sendStatus(200);
    } catch (error) {
      res.status(500).send("Failed to delete user");
    }
  });

  // ── Admin: File Sharing ───────────────────────────────────────────────────
  app.get("/api/admin/shares", requireMaster, async (req, res) => {
    try {
      const shares = await storage.getSharedFilesByOwner((req.user as any).id);
      // Also enrich with sharedWith user info
      const users = await storage.getAllUsers();
      const userMap = new Map(users.map((u) => [u.id, u]));
      const enriched = shares.map((s) => ({
        ...s,
        sharedWithUser: userMap.get(s.sharedWithUserId)
          ? { fullName: userMap.get(s.sharedWithUserId)!.fullName, username: userMap.get(s.sharedWithUserId)!.username, role: userMap.get(s.sharedWithUserId)!.role }
          : null,
      }));
      res.json(enriched);
    } catch (error) {
      res.status(500).send("Failed to get shares");
    }
  });

  app.post("/api/admin/share", requireMaster, async (req, res) => {
    try {
      const { privacyOperationId, sharedWithUserId, note } = req.body;
      if (!privacyOperationId || !sharedWithUserId) return res.status(400).send("Missing required fields");

      const operation = await storage.getPrivacyOperation(privacyOperationId);
      if (!operation) return res.status(404).send("Privacy operation not found");

      const dataset = await storage.getDataset(operation.datasetId);

      const share = await storage.createSharedFile({
        privacyOperationId,
        sharedByUserId: (req.user as any).id,
        sharedWithUserId,
        note: note || null,
        datasetName: dataset?.originalName || "Unknown Dataset",
        technique: operation.technique,
      });
      res.status(201).json(share);
    } catch (error) {
      res.status(500).send("Failed to share file");
    }
  });

  app.delete("/api/admin/shares/:id", requireMaster, async (req, res) => {
    try {
      await storage.deleteSharedFile(req.params.id);
      res.sendStatus(200);
    } catch (error) {
      res.status(500).send("Failed to delete share");
    }
  });

  // ── Researcher: Get shared files ──────────────────────────────────────────
  app.get("/api/researcher/files", requireAuth, async (req, res) => {
    try {
      const shares = await storage.getSharedFilesForUser((req.user as any).id);
      // Enrich with sharedBy user info
      const users = await storage.getAllUsers();
      const userMap = new Map(users.map((u) => [u.id, u]));
      const enriched = shares.map((s) => ({
        ...s,
        sharedByUser: userMap.get(s.sharedByUserId)
          ? { fullName: userMap.get(s.sharedByUserId)!.fullName, username: userMap.get(s.sharedByUserId)!.username }
          : null,
      }));
      res.json(enriched);
    } catch (error) {
      res.status(500).send("Failed to get shared files");
    }
  });

  return httpServer;
}
