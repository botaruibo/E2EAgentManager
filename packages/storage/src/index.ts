import type {
  RunSummary,
  StoredRun,
  StoredWorkflowVersion,
  WorkflowDefinition,
  WorkflowVersionSummary
} from "../../shared/src/index.js";
import { dirname } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

export interface RunStore {
  save(run: StoredRun): Promise<void>;
  get(runId: string): Promise<StoredRun | undefined>;
  list(): Promise<RunSummary[]>;
  listByEmployee(employeeId: string): Promise<RunSummary[]>;
  getForEmployee(employeeId: string, runId: string): Promise<StoredRun | undefined>;
  delete(runId: string): Promise<boolean>;
  deleteForEmployee(employeeId: string, runId: string): Promise<boolean>;
  clearForEmployee(employeeId: string): Promise<number>;
}

export interface WorkflowVersionStore {
  save(version: StoredWorkflowVersion): Promise<void>;
  get(versionId: string): Promise<StoredWorkflowVersion | undefined>;
  list(): Promise<WorkflowVersionSummary[]>;
  listByEmployee(employeeId: string): Promise<WorkflowVersionSummary[]>;
  delete(versionId: string): Promise<boolean>;
}

export interface ScheduledTriggerDocument {
  id: string;
  name: string;
  type: "scheduled";
  employee: {
    id: string;
    name: string;
    script?: {
      workflowId: string;
      workflowName: string;
    };
  };
  schedule: {
    frequency: "minute" | "hour" | "day" | "week" | "month" | "advanced";
    time: string;
    timezone: string;
    enabled: boolean;
    endEnabled: boolean;
    calendarEnabled: boolean;
    queueEnabled: boolean;
    timeoutMinutes: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeScriptDocument {
  workflowId: string;
  workflowName: string;
  workflowVersionId?: string;
  source?: "default" | "recorder" | "manual";
  savedAt?: string;
}

export interface EmployeeVersionDocument {
  version: number;
  status: "draft" | "published";
  script: EmployeeScriptDocument;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeDocument {
  id: string;
  name: string;
  status: "draft" | "published" | "disabled";
  version: number;
  activeVersion?: number;
  onlineVersionId?: string;
  latestVersionId?: string;
  updatedAt: string;
  script: EmployeeScriptDocument;
  draftScript?: EmployeeScriptDocument;
  versions: EmployeeVersionDocument[];
}

export interface EmployeeStore {
  list(): Promise<EmployeeDocument[]>;
  listRunnable(): Promise<EmployeeDocument[]>;
  get(employeeId: string): Promise<EmployeeDocument | undefined>;
  createDraft(input?: { name?: string; script?: EmployeeScriptDocument }): Promise<EmployeeDocument>;
  edit(employeeId: string): Promise<EmployeeDocument | undefined>;
  publish(employeeId: string): Promise<EmployeeDocument | undefined>;
  rename(employeeId: string, name: string): Promise<EmployeeDocument | undefined>;
  updateDraftScript(employeeId: string, script: EmployeeScriptDocument): Promise<EmployeeDocument | undefined>;
  disable(employeeId: string): Promise<EmployeeDocument | undefined>;
  save(employee: EmployeeDocument): Promise<void>;
}

export interface TriggerRunLogDocument {
  id: string;
  triggerId: string;
  triggerName: string;
  startedAt: string;
  finishedAt: string;
  params: Record<string, unknown>;
  result: {
    ok: boolean;
    message: string;
  };
}

export interface ScheduledTriggerStore {
  save(trigger: ScheduledTriggerDocument): Promise<void>;
  get(triggerId: string): Promise<ScheduledTriggerDocument | undefined>;
  list(): Promise<ScheduledTriggerDocument[]>;
  listByEmployee(employeeId: string): Promise<ScheduledTriggerDocument[]>;
  delete(triggerId: string): Promise<boolean>;
  setEnabled(triggerId: string, enabled: boolean): Promise<ScheduledTriggerDocument | undefined>;
  appendLog(log: TriggerRunLogDocument): Promise<void>;
  listLogs(triggerId?: string): Promise<TriggerRunLogDocument[]>;
}

export class SqliteEmployeeStore implements EmployeeStore {
  private db?: DatabaseSync;
  private migratedLegacyDocuments = false;

  constructor(private readonly filePath: string) {}

  async list(): Promise<EmployeeDocument[]> {
    const db = await this.database();
    const rows = db.prepare(
      "SELECT id, name, status, version, online_version, latest_version, document_json, created_at, updated_at FROM employees ORDER BY updated_at DESC, id ASC"
    ).all() as unknown as EmployeeRow[];
    const employees = rows.map((row) => employeeFromRow(row));
    if (employees.length === 0) {
      await this.seedDefaults();
      return this.list();
    }
    return this.migrateLegacyEmployeeDocuments(employees);
  }

  async listRunnable(): Promise<EmployeeDocument[]> {
    return (await this.list()).filter((employee) => hasRunnableVersion(employee));
  }

  async get(employeeId: string): Promise<EmployeeDocument | undefined> {
    const db = await this.database();
    const row = db.prepare(
      "SELECT id, name, status, version, online_version, latest_version, document_json, created_at, updated_at FROM employees WHERE id = ?"
    ).get(employeeId) as EmployeeRow | undefined;
    if (row) {
      const employee = employeeFromRow(row);
      const [migrated] = await this.migrateLegacyEmployeeDocuments([employee]);
      return migrated;
    }
    const employees = await this.list();
    return employees.find((employee) => employee.id === employeeId);
  }

  async createDraft(input: { name?: string; script?: EmployeeScriptDocument } = {}): Promise<EmployeeDocument> {
    const employees = await this.list();
    const now = new Date().toISOString();
    const script = input.script ?? defaultEmployeeScript();
    const employee: EmployeeDocument = {
      id: nextEmployeeId(employees),
      name: input.name?.trim() || "新建员工",
      status: "draft",
      version: 1,
      updatedAt: now,
      script,
      draftScript: script,
      versions: [
        {
          version: 1,
          status: "draft",
          script,
          createdAt: now,
          updatedAt: now
        }
      ]
    };
    await this.save(employee);
    return clone(employee);
  }

  async edit(employeeId: string): Promise<EmployeeDocument | undefined> {
    const employee = await this.get(employeeId);
    if (!employee) {
      return undefined;
    }
    const now = new Date().toISOString();
    const nextVersion = hasRunnableVersion(employee) ? (employee.activeVersion ?? employee.version) + 1 : employee.version;
    const draftScript = clone(employee.draftScript ?? employee.script);
    const versions = employee.versions.filter((version) => version.version !== nextVersion);
    versions.push({
      version: nextVersion,
      status: "draft",
      script: draftScript,
      createdAt: now,
      updatedAt: now
    });
    const next: EmployeeDocument = {
      ...employee,
      status: "draft",
      version: nextVersion,
      draftScript,
      latestVersionId: draftScript.workflowVersionId ?? employee.latestVersionId,
      versions,
      updatedAt: now
    };
    await this.save(next);
    return clone(next);
  }

  async publish(employeeId: string): Promise<EmployeeDocument | undefined> {
    const employee = await this.get(employeeId);
    if (!employee) {
      return undefined;
    }
    const now = new Date().toISOString();
    const script = clone(employee.draftScript ?? latestVersion(employee)?.script ?? employee.script);
    const versions = employee.versions.map((version) =>
      version.version === employee.version
        ? { ...version, status: "published" as const, script, updatedAt: now }
        : version
    );
    if (!versions.some((version) => version.version === employee.version)) {
      versions.push({
        version: employee.version,
        status: "published",
        script,
        createdAt: now,
        updatedAt: now
      });
    }
    const next: EmployeeDocument = {
      ...employee,
      status: "published",
      activeVersion: employee.version,
      onlineVersionId: script.workflowVersionId ?? employee.latestVersionId ?? employee.onlineVersionId,
      latestVersionId: undefined,
      script,
      draftScript: undefined,
      versions,
      updatedAt: now
    };
    await this.save(next);
    return clone(next);
  }

  async rename(employeeId: string, name: string): Promise<EmployeeDocument | undefined> {
    const employee = await this.get(employeeId);
    const trimmed = name.trim();
    if (!employee || !trimmed) {
      return undefined;
    }
    const now = new Date().toISOString();
    const next: EmployeeDocument = {
      ...employee,
      name: trimmed,
      updatedAt: now
    };
    await this.save(next);
    return clone(next);
  }

  async updateDraftScript(employeeId: string, script: EmployeeScriptDocument): Promise<EmployeeDocument | undefined> {
    const current = await this.get(employeeId);
    if (!current) {
      return undefined;
    }
    const employee = current.status === "published" ? await this.edit(employeeId) : current;
    if (!employee) {
      return undefined;
    }
    const now = new Date().toISOString();
    const versions = employee.versions.map((version) =>
      version.version === employee.version
        ? { ...version, script, updatedAt: now }
        : version
    );
    if (!versions.some((version) => version.version === employee.version)) {
      versions.push({
        version: employee.version,
        status: "draft",
        script,
        createdAt: now,
        updatedAt: now
      });
    }
    const next: EmployeeDocument = {
      ...employee,
      status: "draft",
      draftScript: script,
      latestVersionId: script.workflowVersionId ?? employee.latestVersionId,
      versions,
      updatedAt: now
    };
    await this.save(next);
    return clone(next);
  }

  async disable(employeeId: string): Promise<EmployeeDocument | undefined> {
    const employee = await this.get(employeeId);
    if (!employee) {
      return undefined;
    }
    const next: EmployeeDocument = {
      ...employee,
      status: "disabled",
      updatedAt: new Date().toISOString()
    };
    await this.save(next);
    return clone(next);
  }

  async save(employee: EmployeeDocument): Promise<void> {
    const db = await this.database();
    const document = sanitizeEmployeeDocument(employee);
    const documentJson = JSON.stringify(document);
    db.prepare(
      `INSERT INTO employees (id, name, status, version, online_version, latest_version, document_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         status = excluded.status,
         version = excluded.version,
         online_version = excluded.online_version,
         latest_version = excluded.latest_version,
         document_json = excluded.document_json,
         updated_at = excluded.updated_at`
    ).run(
      document.id,
      document.name,
      document.status,
      document.version,
      document.onlineVersionId ?? null,
      document.latestVersionId ?? null,
      documentJson,
      document.versions[0]?.createdAt ?? document.updatedAt,
      document.updatedAt
    );
  }

  private async seedDefaults(): Promise<void> {
    const db = await this.database();
    const count = db.prepare("SELECT COUNT(*) AS count FROM employees").get() as { count: number };
    if (count.count > 0) {
      return;
    }
    const now = "2026-06-19T00:00:00.000Z";
    const defaults: EmployeeDocument[] = ["上品专员", "百应橱窗商品员工"].map((name, index) => ({
      id: `p${String(index + 1).padStart(4, "0")}`,
      name,
      status: "published",
      version: 1,
      activeVersion: 1,
      onlineVersionId: undefined,
      latestVersionId: undefined,
      updatedAt: now,
      script: defaultEmployeeScript(),
      versions: [
        {
          version: 1,
          status: "published",
          script: defaultEmployeeScript(),
          createdAt: now,
          updatedAt: now
        }
      ]
    }));
    for (const employee of defaults) {
      await this.save(employee);
    }
  }

  private async database(): Promise<DatabaseSync> {
    if (!this.db) {
      await mkdir(dirname(this.filePath), { recursive: true });
      this.db = new DatabaseSync(this.filePath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS employees (
          id TEXT PRIMARY KEY,
          name TEXT,
          status TEXT,
          version INTEGER,
          online_version TEXT,
          latest_version TEXT,
          document_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workflow_versions (
          id TEXT PRIMARY KEY,
          employee_id TEXT,
          document_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      ensureColumn(this.db, "employees", "name", "TEXT");
      ensureColumn(this.db, "employees", "status", "TEXT");
      ensureColumn(this.db, "employees", "version", "INTEGER");
      ensureColumn(this.db, "employees", "online_version", "TEXT");
      ensureColumn(this.db, "employees", "latest_version", "TEXT");
      ensureColumn(this.db, "workflow_versions", "employee_id", "TEXT");
      backfillEmployeeColumns(this.db);
      backfillWorkflowVersionEmployeeIds(this.db);
    }
    return this.db;
  }

  private async migrateLegacyEmployeeDocuments(employees: EmployeeDocument[]): Promise<EmployeeDocument[]> {
    if (this.migratedLegacyDocuments) {
      return employees;
    }
    const migratedEmployees: EmployeeDocument[] = [];
    for (const employee of employees) {
      const migrated = await this.migrateEmployeeWorkflows(employee);
      migratedEmployees.push(migrated.employee);
      if (migrated.changed) {
        await this.save(migrated.employee);
      }
    }
    this.migratedLegacyDocuments = true;
    return migratedEmployees;
  }

  private async migrateEmployeeWorkflows(employee: EmployeeDocument): Promise<{ employee: EmployeeDocument; changed: boolean }> {
    const db = await this.database();
    let changed = false;
    const migrateScript = (script: EmployeeScriptDocument | undefined, versionNumber?: number, status?: "draft" | "published") => {
      if (!script) {
        return script;
      }
      const legacy = script as EmployeeScriptDocument & { workflow?: WorkflowDefinition; actions?: unknown[] };
      if (legacy.workflow && legacy.workflowVersionId) {
        saveWorkflowVersionIfMissing(db, {
          summary: {
            versionId: legacy.workflowVersionId,
            workflowId: legacy.workflow.workflowId,
            name: legacy.workflow.name,
            createdAt: legacy.savedAt ?? employee.updatedAt,
            note: `Migrated from employee ${employee.id}`
          },
          workflow: legacy.workflow,
          employeeId: employee.id,
          employeeVersion: versionNumber,
          status,
          source: legacy.source,
          actions: legacy.actions,
          savedAt: legacy.savedAt
        });
        changed = true;
      }
      return sanitizeScriptDocument(script);
    };

    const versions = employee.versions.map((version) => ({
      ...version,
      script: migrateScript(version.script, version.version, version.status) ?? version.script
    }));
    const draftScript = migrateScript(employee.draftScript, employee.version, "draft");
    const script = migrateScript(employee.script, employee.activeVersion, "published") ?? employee.script;
    return {
      changed,
      employee: normalizeEmployeeDocument({
        ...employee,
        script,
        draftScript,
        versions
      })
    };
  }
}

export class SqliteScheduledTriggerStore implements ScheduledTriggerStore {
  private db?: DatabaseSync;

  constructor(private readonly filePath: string) {}

  async save(trigger: ScheduledTriggerDocument): Promise<void> {
    const db = await this.database();
    db.prepare(
      `INSERT INTO scheduled_triggers (id, employee_id, document_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         employee_id = excluded.employee_id,
         document_json = excluded.document_json,
         updated_at = excluded.updated_at`
    ).run(trigger.id, trigger.employee.id, JSON.stringify(trigger), trigger.createdAt, trigger.updatedAt);
  }

  async get(triggerId: string): Promise<ScheduledTriggerDocument | undefined> {
    const db = await this.database();
    const row = db.prepare("SELECT document_json FROM scheduled_triggers WHERE id = ?").get(triggerId) as { document_json: string } | undefined;
    return row ? parseDocument<ScheduledTriggerDocument>(row.document_json) : undefined;
  }

  async list(): Promise<ScheduledTriggerDocument[]> {
    const db = await this.database();
    const rows = db.prepare("SELECT document_json FROM scheduled_triggers ORDER BY updated_at DESC").all() as Array<{ document_json: string }>;
    return rows.map((row) => parseDocument<ScheduledTriggerDocument>(row.document_json));
  }

  async listByEmployee(employeeId: string): Promise<ScheduledTriggerDocument[]> {
    const db = await this.database();
    const rows = db.prepare("SELECT document_json FROM scheduled_triggers WHERE employee_id = ? ORDER BY updated_at DESC").all(employeeId) as Array<{ document_json: string }>;
    return rows.map((row) => parseDocument<ScheduledTriggerDocument>(row.document_json));
  }

  async delete(triggerId: string): Promise<boolean> {
    const db = await this.database();
    const result = db.prepare("DELETE FROM scheduled_triggers WHERE id = ?").run(triggerId) as { changes?: number };
    return Number(result.changes ?? 0) > 0;
  }

  async setEnabled(triggerId: string, enabled: boolean): Promise<ScheduledTriggerDocument | undefined> {
    const trigger = await this.get(triggerId);
    if (!trigger) {
      return undefined;
    }
    const next = {
      ...trigger,
      schedule: { ...trigger.schedule, enabled },
      updatedAt: new Date().toISOString()
    };
    await this.save(next);
    return next;
  }

  async appendLog(log: TriggerRunLogDocument): Promise<void> {
    const db = await this.database();
    db.prepare(
      `INSERT INTO work_logs (id, trigger_id, document_json, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(log.id, log.triggerId, JSON.stringify(log), log.startedAt);
  }

  async listLogs(triggerId?: string): Promise<TriggerRunLogDocument[]> {
    const db = await this.database();
    const rows = triggerId
      ? db.prepare("SELECT document_json FROM work_logs WHERE trigger_id = ? ORDER BY created_at DESC").all(triggerId)
      : db.prepare("SELECT document_json FROM work_logs ORDER BY created_at DESC").all();
    return (rows as Array<{ document_json: string }>).map((row) => parseDocument<TriggerRunLogDocument>(row.document_json));
  }

  private async database(): Promise<DatabaseSync> {
    if (!this.db) {
      await mkdir(dirname(this.filePath), { recursive: true });
      this.db = new DatabaseSync(this.filePath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_triggers (
          id TEXT PRIMARY KEY,
          employee_id TEXT,
          document_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS work_logs (
          id TEXT PRIMARY KEY,
          trigger_id TEXT NOT NULL,
          document_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      this.ensureTriggerEmployeeColumn(this.db);
    }
    return this.db;
  }

  private ensureTriggerEmployeeColumn(db: DatabaseSync): void {
    ensureColumn(db, "scheduled_triggers", "employee_id", "TEXT");
    const rows = db.prepare("SELECT id, document_json FROM scheduled_triggers WHERE employee_id IS NULL").all() as Array<{ id: string; document_json: string }>;
    const update = db.prepare("UPDATE scheduled_triggers SET employee_id = ? WHERE id = ?");
    for (const row of rows) {
      const employeeId = parseDocument<ScheduledTriggerDocument>(row.document_json).employee?.id;
      if (employeeId) {
        update.run(employeeId, row.id);
      }
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_scheduled_triggers_employee_updated ON scheduled_triggers(employee_id, updated_at DESC)");
  }
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, StoredRun>();

  async save(run: StoredRun): Promise<void> {
    this.runs.set(run.summary.runId, clone(run));
  }

  async get(runId: string): Promise<StoredRun | undefined> {
    const run = this.runs.get(runId);
    return run ? clone(run) : undefined;
  }

  async list(): Promise<RunSummary[]> {
    return [...this.runs.values()]
      .map((run) => run.summary)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async listByEmployee(employeeId: string): Promise<RunSummary[]> {
    return (await this.list()).filter((run) => run.employeeId === employeeId);
  }

  async getForEmployee(employeeId: string, runId: string): Promise<StoredRun | undefined> {
    const run = await this.get(runId);
    return run?.summary.employeeId === employeeId ? run : undefined;
  }

  async delete(runId: string): Promise<boolean> {
    return this.runs.delete(runId);
  }

  async deleteForEmployee(employeeId: string, runId: string): Promise<boolean> {
    const run = await this.get(runId);
    return run?.summary.employeeId === employeeId ? this.delete(runId) : false;
  }

  async clearForEmployee(employeeId: string): Promise<number> {
    const runs = await this.listByEmployee(employeeId);
    let deleted = 0;
    for (const run of runs) {
      if (await this.delete(run.runId)) {
        deleted += 1;
      }
    }
    return deleted;
  }
}

export class JsonFileRunStore implements RunStore {
  constructor(private readonly filePath: string) {}

  async save(run: StoredRun): Promise<void> {
    const runs = await this.readAll();
    const next = runs.filter((existing) => existing.summary.runId !== run.summary.runId);
    next.push(clone(run));
    await writeJsonAtomic(this.filePath, next);
  }

  async get(runId: string): Promise<StoredRun | undefined> {
    const runs = await this.readAll();
    const run = runs.find((candidate) => candidate.summary.runId === runId);
    return run ? clone(run) : undefined;
  }

  async list(): Promise<RunSummary[]> {
    const runs = await this.readAll();
    return runs
      .map((run) => run.summary)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async listByEmployee(employeeId: string): Promise<RunSummary[]> {
    const runs = await this.readAll();
    return runs
      .map((run) => run.summary)
      .filter((run) => run.employeeId === employeeId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getForEmployee(employeeId: string, runId: string): Promise<StoredRun | undefined> {
    const run = await this.get(runId);
    return run?.summary.employeeId === employeeId ? run : undefined;
  }

  async delete(runId: string): Promise<boolean> {
    const runs = await this.readAll();
    const next = runs.filter((run) => run.summary.runId !== runId);
    if (next.length === runs.length) {
      return false;
    }
    await writeJsonAtomic(this.filePath, next);
    return true;
  }

  async deleteForEmployee(employeeId: string, runId: string): Promise<boolean> {
    const run = await this.get(runId);
    return run?.summary.employeeId === employeeId ? this.delete(runId) : false;
  }

  async clearForEmployee(employeeId: string): Promise<number> {
    const runs = await this.readAll();
    const next = runs.filter((run) => run.summary.employeeId !== employeeId);
    const deleted = runs.length - next.length;
    if (deleted > 0) {
      await writeJsonAtomic(this.filePath, next);
    }
    return deleted;
  }

  private async readAll(): Promise<StoredRun[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredRun[];
      if (!Array.isArray(parsed)) {
        throw new Error(`Expected run store ${this.filePath} to contain a JSON array.`);
      }
      return parsed;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

export class SqliteRunStore implements RunStore {
  private db?: DatabaseSync;

  constructor(private readonly filePath: string) {}

  async save(run: StoredRun): Promise<void> {
    const db = await this.database();
    db.prepare(
      `INSERT INTO runs (id, employee_id, document_json, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         employee_id = excluded.employee_id,
         document_json = excluded.document_json,
         updated_at = excluded.updated_at`
    ).run(
      run.summary.runId,
      run.summary.employeeId ?? null,
      JSON.stringify(run),
      run.summary.startedAt,
      run.summary.completedAt ?? new Date().toISOString()
    );
  }

  async get(runId: string): Promise<StoredRun | undefined> {
    const db = await this.database();
    const row = db.prepare("SELECT document_json FROM runs WHERE id = ?").get(runId) as { document_json: string } | undefined;
    return row ? parseDocument<StoredRun>(row.document_json) : undefined;
  }

  async list(): Promise<RunSummary[]> {
    const db = await this.database();
    const rows = db.prepare("SELECT document_json FROM runs ORDER BY started_at DESC").all() as Array<{ document_json: string }>;
    return rows.map((row) => parseDocument<StoredRun>(row.document_json).summary);
  }

  async listByEmployee(employeeId: string): Promise<RunSummary[]> {
    const db = await this.database();
    this.ensureRunEmployeeColumn(db);
    const rows = db.prepare("SELECT document_json FROM runs WHERE employee_id = ? ORDER BY started_at DESC").all(employeeId) as Array<{ document_json: string }>;
    return rows.map((row) => parseDocument<StoredRun>(row.document_json).summary);
  }

  async getForEmployee(employeeId: string, runId: string): Promise<StoredRun | undefined> {
    const db = await this.database();
    this.ensureRunEmployeeColumn(db);
    const row = db.prepare("SELECT document_json FROM runs WHERE id = ? AND employee_id = ?").get(runId, employeeId) as { document_json: string } | undefined;
    return row ? parseDocument<StoredRun>(row.document_json) : undefined;
  }

  async delete(runId: string): Promise<boolean> {
    const db = await this.database();
    const result = db.prepare("DELETE FROM runs WHERE id = ?").run(runId) as { changes?: number };
    return Number(result.changes ?? 0) > 0;
  }

  async deleteForEmployee(employeeId: string, runId: string): Promise<boolean> {
    const db = await this.database();
    this.ensureRunEmployeeColumn(db);
    const result = db.prepare("DELETE FROM runs WHERE id = ? AND employee_id = ?").run(runId, employeeId) as { changes?: number };
    return Number(result.changes ?? 0) > 0;
  }

  async clearForEmployee(employeeId: string): Promise<number> {
    const db = await this.database();
    this.ensureRunEmployeeColumn(db);
    const result = db.prepare("DELETE FROM runs WHERE employee_id = ?").run(employeeId) as { changes?: number };
    const deleted = Number(result.changes ?? 0);
    return deleted > 0 ? deleted : this.clearLegacyEmployeeRuns(db, employeeId);
  }

  private async database(): Promise<DatabaseSync> {
    if (!this.db) {
      await mkdir(dirname(this.filePath), { recursive: true });
      this.db = new DatabaseSync(this.filePath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          employee_id TEXT,
          document_json TEXT NOT NULL,
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      this.ensureRunEmployeeColumn(this.db);
    }
    return this.db;
  }

  private ensureRunEmployeeColumn(db: DatabaseSync): void {
    const columns = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
    const hasEmployeeId = columns.some((column) => column.name === "employee_id");
    if (!hasEmployeeId) {
      db.exec("ALTER TABLE runs ADD COLUMN employee_id TEXT");
    }
    const rows = db.prepare("SELECT id, document_json FROM runs WHERE employee_id IS NULL").all() as Array<{ id: string; document_json: string }>;
    const update = db.prepare("UPDATE runs SET employee_id = ?, document_json = ? WHERE id = ?");
    for (const row of rows) {
      const run = parseDocument<StoredRun>(row.document_json);
      const runIdPrefix = run.summary.runId.split("-")[0];
      const employeeId = run.summary.employeeId ?? (/^p\d+$/i.test(runIdPrefix) ? runIdPrefix : undefined);
      if (employeeId) {
        const normalizedRun = {
          ...run,
          summary: {
            ...run.summary,
            employeeId
          }
        };
        update.run(employeeId, JSON.stringify(normalizedRun), row.id);
      }
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_runs_employee_started ON runs(employee_id, started_at DESC)");
  }

  private clearLegacyEmployeeRuns(db: DatabaseSync, employeeId: string): number {
    const rows = db.prepare("SELECT id, document_json FROM runs").all() as Array<{ id: string; document_json: string }>;
    const deleteRun = db.prepare("DELETE FROM runs WHERE id = ?");
    let deleted = 0;
    for (const row of rows) {
      const run = parseDocument<StoredRun>(row.document_json);
      if (run.summary.employeeId === employeeId || run.summary.runId.startsWith(`${employeeId}-`)) {
        const result = deleteRun.run(row.id) as { changes?: number };
        deleted += Number(result.changes ?? 0);
      }
    }
    return deleted;
  }
}

export class InMemoryWorkflowVersionStore implements WorkflowVersionStore {
  private readonly versions = new Map<string, StoredWorkflowVersion>();

  async save(version: StoredWorkflowVersion): Promise<void> {
    const normalizedVersion = normalizeStoredWorkflowVersion(version);
    this.versions.set(normalizedVersion.summary.versionId, clone(normalizedVersion));
  }

  async get(versionId: string): Promise<StoredWorkflowVersion | undefined> {
    const version = this.versions.get(versionId);
    return version ? clone(version) : undefined;
  }

  async list(): Promise<WorkflowVersionSummary[]> {
    return [...this.versions.values()]
      .map(workflowVersionSummary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listByEmployee(employeeId: string): Promise<WorkflowVersionSummary[]> {
    return [...this.versions.values()]
      .filter((version) => version.employeeId === employeeId)
      .map(workflowVersionSummary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async delete(versionId: string): Promise<boolean> {
    return this.versions.delete(versionId);
  }
}

export class JsonFileWorkflowVersionStore implements WorkflowVersionStore {
  constructor(private readonly filePath: string) {}

  async save(version: StoredWorkflowVersion): Promise<void> {
    const normalizedVersion = normalizeStoredWorkflowVersion(version);
    const versions = await this.readAll();
    const next = versions.filter((existing) => existing.summary.versionId !== normalizedVersion.summary.versionId);
    next.push(clone(normalizedVersion));
    await writeJsonAtomic(this.filePath, next);
  }

  async get(versionId: string): Promise<StoredWorkflowVersion | undefined> {
    const versions = await this.readAll();
    const version = versions.find((candidate) => candidate.summary.versionId === versionId);
    return version ? clone(version) : undefined;
  }

  async list(): Promise<WorkflowVersionSummary[]> {
    const versions = await this.readAll();
    return versions
      .map(workflowVersionSummary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listByEmployee(employeeId: string): Promise<WorkflowVersionSummary[]> {
    const versions = await this.readAll();
    return versions
      .filter((version) => version.employeeId === employeeId)
      .map(workflowVersionSummary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async delete(versionId: string): Promise<boolean> {
    const versions = await this.readAll();
    const next = versions.filter((version) => version.summary.versionId !== versionId);
    if (next.length === versions.length) {
      return false;
    }
    await writeJsonAtomic(this.filePath, next);
    return true;
  }

  private async readAll(): Promise<StoredWorkflowVersion[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredWorkflowVersion[];
      if (!Array.isArray(parsed)) {
        throw new Error(`Expected workflow version store ${this.filePath} to contain a JSON array.`);
      }
      return parsed;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

export class SqliteWorkflowVersionStore implements WorkflowVersionStore {
  private db?: DatabaseSync;

  constructor(private readonly filePath: string) {}

  async save(version: StoredWorkflowVersion): Promise<void> {
    const db = await this.database();
    const normalizedVersion = normalizeStoredWorkflowVersion(version);
    db.prepare(
      `INSERT INTO workflow_versions (id, employee_id, document_json, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         employee_id = excluded.employee_id,
         document_json = excluded.document_json,
         created_at = excluded.created_at`
    ).run(
      normalizedVersion.summary.versionId,
      normalizedVersion.employeeId ?? normalizedVersion.summary.employeeId ?? null,
      JSON.stringify(normalizedVersion),
      normalizedVersion.summary.createdAt
    );
  }

  async get(versionId: string): Promise<StoredWorkflowVersion | undefined> {
    const db = await this.database();
    const row = db.prepare("SELECT document_json FROM workflow_versions WHERE id = ?").get(versionId) as { document_json: string } | undefined;
    return row ? parseDocument<StoredWorkflowVersion>(row.document_json) : undefined;
  }

  async list(): Promise<WorkflowVersionSummary[]> {
    const db = await this.database();
    const rows = db.prepare("SELECT document_json FROM workflow_versions ORDER BY created_at DESC").all() as Array<{ document_json: string }>;
    return rows.map((row) => workflowVersionSummary(parseDocument<StoredWorkflowVersion>(row.document_json)));
  }

  async listByEmployee(employeeId: string): Promise<WorkflowVersionSummary[]> {
    const db = await this.database();
    const rows = db.prepare("SELECT document_json FROM workflow_versions WHERE employee_id = ? ORDER BY created_at DESC").all(employeeId) as Array<{ document_json: string }>;
    return rows.map((row) => workflowVersionSummary(parseDocument<StoredWorkflowVersion>(row.document_json)));
  }

  async delete(versionId: string): Promise<boolean> {
    const db = await this.database();
    const result = db.prepare("DELETE FROM workflow_versions WHERE id = ?").run(versionId) as { changes?: number };
    return Number(result.changes ?? 0) > 0;
  }

  private async database(): Promise<DatabaseSync> {
    if (!this.db) {
      await mkdir(dirname(this.filePath), { recursive: true });
      this.db = new DatabaseSync(this.filePath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_versions (
          id TEXT PRIMARY KEY,
          employee_id TEXT,
          document_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      this.ensureWorkflowVersionEmployeeColumn(this.db);
    }
    return this.db;
  }

  private ensureWorkflowVersionEmployeeColumn(db: DatabaseSync): void {
    ensureColumn(db, "workflow_versions", "employee_id", "TEXT");
    backfillWorkflowVersionEmployeeIds(db);
    db.exec("CREATE INDEX IF NOT EXISTS idx_workflow_versions_employee_created ON workflow_versions(employee_id, created_at DESC)");
  }
}

interface EmployeeRow {
  id: string;
  name?: string | null;
  status?: EmployeeDocument["status"] | null;
  version?: number | null;
  online_version?: string | null;
  latest_version?: string | null;
  document_json: string;
  created_at: string;
  updated_at: string;
}

function defaultEmployeeScript(): EmployeeScriptDocument {
  return {
    workflowId: "browser-operation-digital-employee",
    workflowName: "浏览器操作数字员工脚本",
    source: "default"
  };
}

function hasRunnableVersion(employee: EmployeeDocument): boolean {
  return employee.status !== "disabled" && typeof employee.activeVersion === "number" && employee.versions.some((version) => version.version === employee.activeVersion && version.status === "published");
}

function latestVersion(employee: EmployeeDocument): EmployeeVersionDocument | undefined {
  return [...employee.versions].sort((a, b) => b.version - a.version)[0];
}

function employeeFromRow(row: EmployeeRow): EmployeeDocument {
  const parsed = parseDocument<EmployeeDocument>(row.document_json);
  return normalizeEmployeeDocument({
    ...parsed,
    id: row.id,
    name: row.name ?? parsed.name,
    status: row.status ?? parsed.status,
    version: Number(row.version ?? parsed.version ?? 1),
    onlineVersionId: row.online_version ?? parsed.onlineVersionId,
    latestVersionId: row.latest_version ?? parsed.latestVersionId,
    updatedAt: row.updated_at ?? parsed.updatedAt
  });
}

function normalizeEmployeeDocument(employee: EmployeeDocument): EmployeeDocument {
  const script = sanitizeScriptDocument(employee.script) ?? defaultEmployeeScript();
  const draftScript = sanitizeScriptDocument(employee.draftScript);
  const versions = (employee.versions?.length ? employee.versions : [
    {
      version: employee.version ?? 1,
      status: employee.status === "published" ? "published" as const : "draft" as const,
      script,
      createdAt: employee.updatedAt,
      updatedAt: employee.updatedAt
    }
  ]).map((version) => ({
    ...version,
    script: sanitizeScriptDocument(version.script) ?? script
  }));
  const activeVersion = employee.activeVersion ?? versions.find((version) => version.status === "published")?.version;
  const onlineVersionId = employee.onlineVersionId
    ?? script.workflowVersionId
    ?? versions.find((version) => version.status === "published")?.script.workflowVersionId;
  const latestVersionId = employee.latestVersionId ?? draftScript?.workflowVersionId;
  return {
    ...employee,
    status: employee.status ?? "draft",
    version: Math.max(1, Number(employee.version ?? versions[0]?.version ?? 1)),
    script,
    draftScript,
    versions,
    activeVersion,
    onlineVersionId,
    latestVersionId
  };
}

function sanitizeEmployeeDocument(employee: EmployeeDocument): EmployeeDocument {
  return normalizeEmployeeDocument({
    ...employee,
    script: sanitizeScriptDocument(employee.script ?? defaultEmployeeScript()) ?? defaultEmployeeScript(),
    draftScript: sanitizeScriptDocument(employee.draftScript),
    versions: employee.versions.map((version) => ({
      ...version,
      script: sanitizeScriptDocument(version.script) ?? defaultEmployeeScript()
    }))
  });
}

function sanitizeScriptDocument(script: EmployeeScriptDocument | undefined): EmployeeScriptDocument | undefined {
  if (!script) {
    return undefined;
  }
  const legacy = script as EmployeeScriptDocument & { workflow?: WorkflowDefinition; actions?: unknown[] };
  const summary = { ...legacy };
  delete summary.workflow;
  delete summary.actions;
  return summary;
}

function saveWorkflowVersionIfMissing(db: DatabaseSync, version: StoredWorkflowVersion): void {
  const existing = db.prepare("SELECT id FROM workflow_versions WHERE id = ?").get(version.summary.versionId) as { id: string } | undefined;
  if (existing) {
    return;
  }
  const normalizedVersion = normalizeStoredWorkflowVersion(version);
  db.prepare(
    `INSERT INTO workflow_versions (id, employee_id, document_json, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(
    normalizedVersion.summary.versionId,
    normalizedVersion.employeeId ?? normalizedVersion.summary.employeeId ?? null,
    JSON.stringify(normalizedVersion),
    normalizedVersion.summary.createdAt
  );
}

function ensureColumn(db: DatabaseSync, table: "employees" | "runs" | "scheduled_triggers" | "workflow_versions", column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((existing) => existing.name === column)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function workflowVersionSummary(version: StoredWorkflowVersion): WorkflowVersionSummary {
  return {
    ...version.summary,
    employeeId: version.employeeId ?? version.summary.employeeId
  };
}

function normalizeStoredWorkflowVersion(version: StoredWorkflowVersion): StoredWorkflowVersion {
  const employeeId = version.employeeId ?? version.summary.employeeId;
  return {
    ...version,
    summary: {
      ...version.summary,
      employeeId
    },
    employeeId
  };
}

function backfillWorkflowVersionEmployeeIds(db: DatabaseSync): void {
  const rows = db.prepare("SELECT id, document_json FROM workflow_versions WHERE employee_id IS NULL").all() as Array<{ id: string; document_json: string }>;
  const update = db.prepare("UPDATE workflow_versions SET employee_id = ?, document_json = ? WHERE id = ?");
  for (const row of rows) {
    const version = normalizeStoredWorkflowVersion(parseDocument<StoredWorkflowVersion>(row.document_json));
    const employeeId = version.employeeId ?? version.summary.employeeId;
    if (employeeId) {
      update.run(employeeId, JSON.stringify(version), row.id);
    }
  }
}

function backfillEmployeeColumns(db: DatabaseSync): void {
  const rows = db.prepare(
    "SELECT id, name, status, version, online_version, latest_version, document_json, created_at, updated_at FROM employees"
  ).all() as unknown as EmployeeRow[];
  for (const row of rows) {
    const parsed = parseDocument<EmployeeDocument>(row.document_json);
    const employee = employeeFromRow(row);
    db.prepare(
      `UPDATE employees
       SET name = ?, status = ?, version = ?, online_version = ?, latest_version = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      employee.name,
      employee.status,
      employee.version,
      row.online_version ?? parsed.onlineVersionId ?? employee.onlineVersionId ?? null,
      row.latest_version ?? parsed.latestVersionId ?? employee.latestVersionId ?? null,
      employee.updatedAt,
      employee.id
    );
  }
}

function nextEmployeeId(employees: EmployeeDocument[]): string {
  const maxId = employees.reduce((current, employee) => {
    const match = /^p(\d{4})$/.exec(employee.id);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `p${String(maxId + 1).padStart(4, "0")}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseDocument<T>(value: string): T {
  return JSON.parse(value) as T;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await rename(tempPath, filePath);
}
