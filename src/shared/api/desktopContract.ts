// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { OraclePrincipalSnapshot, OraclePrincipalTarget, OraclePrincipalDetail, OraclePrincipalRequest, OraclePrincipalReview, OraclePrincipalExecution, OraclePrincipalResult, OraclePrincipalFailure } from '@/shared/types/oracleUserRoleTypes';
import type { PgRoleSnapshot, PgRoleTarget, PgRoleDetail, PgRoleRequest, PgRoleReview, PgRoleExecution, PgRoleResult } from '@/shared/types/postgresRoleTypes';
import type { PgTablespaceSnapshot, PgTablespaceTarget, PgTablespaceDetail, PgTablespaceRequest, PgTablespaceReview, PgTablespaceExecution, PgTablespaceResult, PgTablespaceFailure } from '@/shared/types/postgresTablespaceTypes';
import type { PostgresSessionSnapshot, PostgresSessionCommand, PostgresSessionResult } from '@/shared/types/postgresSessionTypes';
import type { PgSchemaSnapshot, PgSchemaTarget, PgSchemaDetail, PgSchemaRequest, PgSchemaReview, PgSchemaExecution, PgSchemaResult } from '@/shared/types/postgresSchemaTypes';
import type { PgPrivilegeContext, PgPrivilegePrincipal, PgPrivilegeListRequest, PgPrivilegeList, PgPrivilegeTarget, PgPrivilegeDetail, PgPrivilegeRequest, PgPrivilegeReview, PgPrivilegeExecution, PgPrivilegeFailure } from '@/shared/types/postgresPrivilegeTypes';
import type { PostgresLockSnapshot, PostgresLockCommand, PostgresLockResult } from '@/shared/types/postgresLockTypes';
import type { TablespaceSnapshot, TablespaceTarget, TablespaceDetail, TablespaceOperation, TablespaceReview, TablespaceExecution, TablespaceOutcome } from '@/shared/types/oracleTablespaceTypes';
import type { OracleSessionSnapshot, OracleSessionDetail, OracleSessionTarget, OracleSessionCommand } from '@/shared/types/oracleSessionTypes';
import type { PdbAccess, PdbSnapshot, PdbDetail, PdbOperation, PdbReview, PdbExecution, PdbFailure, PdbStage } from '@/shared/types/pdbTypes';
import type { PrivilegeTarget, PrivilegePrincipals, ObjectPrivilegeDetail, ObjectPrivilegeMutation } from '@/shared/types/objectPrivilegeTypes';
import type { OracleLockSnapshot, OracleLockCommand, OracleLockResult } from '@/shared/types/oracleLockTypes';
import type { OpenDialogOptions, OpenDialogReturnValue, SaveDialogOptions, SaveDialogReturnValue } from 'electron';
import type { AppSettings, ConnectionConfig } from '@/shared/types/appTypes';
import type { ColumnMetadata, DatabaseRow, GitRevision, NamedObject } from '@/shared/types/databaseTypes';
import type { SessionRow, SessionStatistic, LockRow, TablespaceRow, DatafileRow, DirectoryRow, GrantedPrivilege, UserRow } from '@/shared/types/dbaTypes';
import type { AiSourceIdentity, SourceConversation, AiDatabaseContext } from '@/shared/types/aiTypes';
import type { SqlHistoryEntry } from '@/shared/types/sqlTypes';
import type { DbLinkIdentity, DbLinkRead, DbLinkSave, DbLinkPhase } from '@/shared/types/dbLinkTypes';
import type { DirectoryList, DirectoryDetail, DirectoryMutation } from '@/shared/types/directoryTypes';
import type { TraceStep, TraceTarget } from '@/shared/types/traceTypes';

export type Response<T = object> =
  | ({ success: true; error?: never } & T)
  | ({ success: false; error: string } & Partial<T>);
export interface TransactionState { hasUncommittedTx?: boolean; }
export type SqlArguments = [sql: string, binds?: Record<string, unknown>, schema?: string | null, batchId?: string | null];
export interface SqlData<Row = DatabaseRow> extends TransactionState {
  rows: Row[];
  metaData: ColumnMetadata[];
  rowsAffected?: number;
  command?: string;
  executionTime: number;
  executionSchema?: string;
  cancelled?: boolean;
  errorPosition?: number;
  errorContext?: string;
  notices?: string[];
}
export type SqlResponse<Row = DatabaseRow> = Response<SqlData<Row>>;
export interface PostgresTriggerIdentity { schema: string; triggerName: string; tableName?: string; }
export interface PostgresTriggerExpected { triggerOid: string; triggerDefinition: string; functionDefinition: string; enabled: string; }
export interface PostgresTriggerSave extends PostgresTriggerIdentity {
  tableName: string; isNew: boolean; body: string; timing: string; events: string[]; forEachRow: boolean;
  expected?: PostgresTriggerExpected;
}
export interface PostgresTriggerMetadata {
  trigger_oid: string; trigger_name: string; tgtype: number; enabled: string; relkind: string;
  table_name: string; schema_name: string; function_name: string; function_schema: string;
  function_body: string; language: string; trigger_ddl: string; function_ddl: string;
  function_users: number | string; complex: boolean; when_condition: string | null; update_columns: string[];
}
export interface OracleTriggerMetadata {
  TRIGGER_TYPE: string; TRIGGERING_EVENT: string; TABLE_OWNER: string; TABLE_NAME: string;
  BASE_OBJECT_TYPE: string; REFERENCING_NAMES: string; WHEN_CLAUSE: string | null;
  STATUS: string; ACTION_TYPE: string; CROSSEDITION: string;
  source: string; header: string; body: string; headerLines: number; editable: boolean; updateColumns: string[];
  errors: { LINE: number; POSITION: number; TEXT: string }[];
}
export interface OracleTriggerSave extends Omit<PostgresTriggerSave, 'expected'> {
  updateColumns: string[]; aliasNew: string; aliasOld: string;
  expected?: { source: string; status: string };
}
export interface LoadingOptions { skipGlobalLoader?: boolean; }
export interface StoredRequest {
  subProgram?: string;
  subProgramId?: number;
  argumentModes?: Record<string, 'value' | 'null' | 'default'>;
  signature?: string;
  schema: string;
  objectName: string;
  objectType: string;
  args: Record<string, unknown>;
  argTypes: Record<string, string>;
  argDirections: Record<string, string>;
  inputDateFormat: string;
  isSubProgramFunction?: boolean;
}
export interface TraceRequest extends StoredRequest {
  sourceText: string;
  originalSourceText?: string;
  traceTarget?: TraceTarget;
  skipParse?: boolean;
}
export interface TraceInfo {
  compile_date: string;
  arguments: string;
  target_compile_date?: string | null;
  sub_program?: string | null;
  executed_source?: string;
  source_sha256?: string;
  source_kind?: 'original' | 'instrumented';
  line_mapping?: string;
  procedure_to_source?: Record<string, number>;
}
export interface StoredData extends TransactionState {
  returnValues?: { name: string; value: unknown }[];
  dbmsOutput?: string[];
}
export interface TraceData extends StoredData {
  generatedSource?: string;
  variablesTrace?: string[];
  traceDate?: string;
  targetCompileDate?: string | null;
  info?: TraceInfo | null;
  steps?: TraceStep[];
  traceLogs?: string[];
  errorCode?: string;
}
export interface AiSettings {
  isAiEnabled: boolean;
  provider: string;
  apiKey: string;
  modelName: string;
  endpointUrl: string;
  ollamaEndpoint?: string;
  unavailableCredentials?: Array<'apiKey'>;
}
export interface AiUsageRecord {
  requestedAt: string;
  requestType: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
}
export interface AiAnswer {
  answer: string;
  cancelled?: boolean;
  historyError?: string;
  usage?: { promptTokens: number; completionTokens: number };
}
export interface GitReviewSource extends GitObject { key: string; displayName: string; sourceText: string; }
export interface GitReviewRow extends GitReviewSource { path: string; headPath?: string; headSource: string | null; localSource: string | null; }
export interface GitConflict { path: string; base: string | null; ours: string | null; theirs: string | null; working: string | null; token: string; }
export interface GitObject { tableName?: string; signature?: string; dbType: string; schema: string; objectType: string; objectName: string; }
export interface ErObject { dbType: string; objectName: string; }
export interface GitPullData { isConflict?: boolean; statusUnavailable?: boolean; }

interface Request<Args extends unknown[], Result> { args: Args; result: Result; }
export type FocusElementKind = 'input' | 'textarea' | 'contenteditable' | 'other' | 'none';
export interface FocusStateReport {
  reason: 'startup' | 'window-focus' | 'window-blur' | 'visibility-change' | 'input-attempt' | 'recovery-check';
  documentHasFocus: boolean;
  visibility: 'visible' | 'hidden';
  activeElement: FocusElementKind;
  activeElementDisabled: boolean;
  activeElementReadOnly: boolean;
}
export interface FocusDiagnosticRecord {
  sequence: number;
  time: string;
  event: string;
  platform: string;
  appVersion: string;
  electronVersion: string | null;
  windowFocused: boolean | null;
  webContentsFocused: boolean | null;
  devToolsFocused: boolean | null;
  minimized: boolean | null;
  visible: boolean | null;
  documentHasFocus: boolean | null;
  activeElement: FocusElementKind | null;
  activeElementDisabled: boolean | null;
  activeElementReadOnly: boolean | null;
}
// Mirror the preload allowlist. There is deliberately no catch-all channel signature.
export interface DesktopRequests {
  'get-focus-diagnostics': Request<[], FocusDiagnosticRecord[]>;
  'report-focus-state': Request<[report: FocusStateReport], { recoveryAttempted: boolean }>;
  'copy-to-clipboard': Request<[text: string], boolean>;
  'get-connections': Request<[], ConnectionConfig[]>;
  'save-connection': Request<[config: ConnectionConfig, originalName?: string], Response<{ credentialsPersisted: boolean }>>;
  'delete-connection': Request<[name: string], Response>;
  'save-connections-order': Request<[connections: ConnectionConfig[]], Response>;
  'load-settings': Request<[], AppSettings & { dateFormat?: string }>;
  'save-settings': Request<[settings: AppSettings], Response>;
  'get-app-version': Request<[], string>;
  'open-external': Request<[url: string], void>;
  'inspect-sql-privacy': Request<[statements: string[], dialect: 'oracle' | 'postgresql'], Array<{ sensitive: boolean; command: string }>>;
  'get-sql-history': Request<[], SqlHistoryEntry[]>;
  'add-sql-history': Request<[entry: Omit<SqlHistoryEntry, 'id'>], SqlHistoryEntry[]>;
  'clear-sql-history': Request<[], SqlHistoryEntry[]>;
  'open-sql-file': Request<[], Response<{ canceled: boolean; filePath?: string; sql?: string }>>;
  'show-save-dialog': Request<[options: SaveDialogOptions], SaveDialogReturnValue & { writeToken?: string }>;
  'show-open-dialog': Request<[options: OpenDialogOptions], OpenDialogReturnValue>;
  'show-open-folder-dialog': Request<[title?: string], OpenDialogReturnValue>;
  'save-file': Request<[path: string, data: string | ArrayBuffer | Uint8Array, encoding: string, writeToken?: string], Response>;
  'connect-db': Request<[config: ConnectionConfig], Response<{ aiHistoryScope: string }>>;
  'disconnect-db': Request<[], boolean>;
  'get-db-info': Request<[], Response<{ info: string }>>;
  'get-oracle-dblink': Request<[request: DbLinkIdentity], Response<DbLinkRead & { errorCode?: string }>>;
  'save-oracle-dblink': Request<[request: DbLinkSave], Response<DbLinkRead & TransactionState & { phase?: DbLinkPhase; errorCode?: string }>>;
  'test-oracle-dblink': Request<[request: DbLinkIdentity & { expected: string }], Response<{ elapsedMs: number; errorCode?: string }>>;
  'list-oracle-privilege-principals': Request<[], Response<PrivilegePrincipals & { errorCode?: string }>>;
  'get-oracle-object-privileges': Request<[target: PrivilegeTarget], Response<{ detail: ObjectPrivilegeDetail; errorCode?: string }>>;
  'mutate-oracle-object-privileges': Request<[request: ObjectPrivilegeMutation], Response<TransactionState & { detail: ObjectPrivilegeDetail; applied: boolean; errorCode?: string }>>;
  'inspect-oracle-pdb-access': Request<[], Response<PdbAccess & PdbFailure>>;
  'list-oracle-pdbs': Request<[], Response<PdbSnapshot & PdbFailure>>;
  'get-oracle-pdb-detail': Request<[target: string], Response<PdbDetail & PdbFailure>>;
  'review-oracle-pdb-operation': Request<[request: PdbOperation], Response<PdbReview & PdbFailure>>;
  'execute-oracle-pdb-operation': Request<[request: PdbExecution], Response<{ snapshot: PdbSnapshot; stage: PdbStage; applied: boolean } & PdbFailure>>;
  'list-oracle-tablespaces': Request<[], Response<TablespaceSnapshot & Partial<TablespaceOutcome>>>;
  'get-oracle-tablespace-detail': Request<[target: TablespaceTarget], Response<TablespaceDetail & Partial<TablespaceOutcome>>>;
  'review-oracle-tablespace-operation': Request<[request: TablespaceOperation], Response<TablespaceReview & Partial<TablespaceOutcome>>>;
  'execute-oracle-tablespace-operation': Request<[request: TablespaceExecution], Response<TablespaceOutcome & { snapshot: TablespaceSnapshot }>>;
  'list-oracle-sessions': Request<[], Response<OracleSessionSnapshot & { errorCode?: string }>>;
  'get-oracle-session-detail': Request<[target: OracleSessionTarget], Response<OracleSessionDetail & { errorCode?: string }>>;
  'manage-oracle-session': Request<[request: OracleSessionCommand], Response<{ status: 'requested' | 'marked'; errorCode?: string }>>;
  'list-oracle-user-roles': Request<[], Response<OraclePrincipalSnapshot & OraclePrincipalFailure>>;
  'get-oracle-user-role-detail': Request<[target: OraclePrincipalTarget], Response<{ detail: OraclePrincipalDetail } & OraclePrincipalFailure>>;
  'review-oracle-user-role-operation': Request<[request: OraclePrincipalRequest], Response<OraclePrincipalReview & OraclePrincipalFailure>>;
  'execute-oracle-user-role-operation': Request<[request: OraclePrincipalExecution], Response<OraclePrincipalResult & OraclePrincipalFailure>>;
  'list-postgres-roles': Request<[], Response<PgRoleSnapshot & { errorCode?: string }>>;
  'get-postgres-role-detail': Request<[target: PgRoleTarget], Response<{ detail: PgRoleDetail } & { errorCode?: string }>>;
  'review-postgres-role-operation': Request<[request: PgRoleRequest], Response<PgRoleReview & { errorCode?: string }>>;
  'execute-postgres-role-operation': Request<[request: PgRoleExecution], Response<PgRoleResult & { errorCode?: string }>>;
  'list-postgres-tablespaces': Request<[], Response<PgTablespaceSnapshot & PgTablespaceFailure>>;
  'get-postgres-tablespace-detail': Request<[target: PgTablespaceTarget], Response<{ detail: PgTablespaceDetail } & PgTablespaceFailure>>;
  'review-postgres-tablespace-operation': Request<[request: PgTablespaceRequest], Response<PgTablespaceReview & PgTablespaceFailure>>;
  'execute-postgres-tablespace-operation': Request<[request: PgTablespaceExecution], Response<PgTablespaceResult & PgTablespaceFailure>>;
  'list-postgres-schemas': Request<[], Response<PgSchemaSnapshot & PgPrivilegeFailure>>;
  'get-postgres-schema-detail': Request<[target: PgSchemaTarget], Response<{ detail: PgSchemaDetail } & PgPrivilegeFailure>>;
  'review-postgres-schema-operation': Request<[request: PgSchemaRequest], Response<PgSchemaReview & PgPrivilegeFailure>>;
  'execute-postgres-schema-operation': Request<[request: PgSchemaExecution], Response<PgSchemaResult & PgPrivilegeFailure>>;
  'list-postgres-privilege-principals': Request<[], Response<{ context: PgPrivilegeContext; principals: PgPrivilegePrincipal[] } & PgPrivilegeFailure>>;
  'list-postgres-privilege-objects': Request<[request: PgPrivilegeListRequest], Response<PgPrivilegeList & PgPrivilegeFailure>>;
  'get-postgres-object-privileges': Request<[target: PgPrivilegeTarget], Response<{ detail: PgPrivilegeDetail } & PgPrivilegeFailure>>;
  'review-postgres-object-privilege': Request<[request: PgPrivilegeRequest], Response<PgPrivilegeReview & PgPrivilegeFailure>>;
  'mutate-postgres-object-privilege': Request<[request: PgPrivilegeExecution], Response<{ detail: PgPrivilegeDetail; applied: boolean } & PgPrivilegeFailure>>;
  'list-postgres-sessions': Request<[], Response<PostgresSessionSnapshot & { errorCode?: string }>>;
  'manage-postgres-session': Request<[request: PostgresSessionCommand], Response<PostgresSessionResult & { errorCode?: string }>>;
  'list-postgres-locks': Request<[], Response<PostgresLockSnapshot & { errorCode?: string }>>;
  'manage-postgres-lock': Request<[request: PostgresLockCommand], Response<PostgresLockResult & { errorCode?: string }>>;
  'list-oracle-locks': Request<[], Response<OracleLockSnapshot & { errorCode?: string }>>;
  'terminate-oracle-lock-session': Request<[request: OracleLockCommand], Response<OracleLockResult & { errorCode?: string }>>;
  'list-oracle-directories': Request<[], Response<DirectoryList & { errorCode?: string }>>;
  'get-oracle-directory': Request<[name: string], Response<{ detail: DirectoryDetail; errorCode?: string }>>;
  'mutate-oracle-directory': Request<[request: DirectoryMutation], Response<{ detail: DirectoryDetail | null; applied: boolean; errorCode?: string } & TransactionState>>;
  'open-data-export': Request<[sql: string], Response<{ exportId: string; rowCount: number }>>;
  'read-data-export': Request<[id: string, offset: number, limit: number], Response<{ rows: DatabaseRow[]; done: boolean }>>;
  'close-data-export': Request<[id: string], Response>;
  'get-oracle-trigger': Request<[request: PostgresTriggerIdentity], Response<{ trigger: OracleTriggerMetadata }>>;
  'save-oracle-trigger': Request<[request: OracleTriggerSave], Response<{ trigger: OracleTriggerMetadata } & TransactionState>>;
  'get-postgres-trigger': Request<[request: PostgresTriggerIdentity], Response<{ trigger: PostgresTriggerMetadata }>>;
  'save-postgres-trigger': Request<[request: PostgresTriggerSave], Response<TransactionState>>;
  'execute-ddl-batch': Request<[statements: string[]], Response<TransactionState>>;
  'execute-sql': Request<SqlArguments, SqlResponse>;
  'execute-sql-bg': Request<[sql: string, binds?: Record<string, unknown>, schema?: string | null, container?: string | null], SqlResponse>;
  'explain-sql': Request<SqlArguments, SqlResponse>;
  'commit-db': Request<[], Response<TransactionState>>;
  'rollback-db': Request<[], Response<TransactionState>>;
  'get-schemas': Request<[includeMaintained?: boolean, detailed?: boolean], Response<{ schemas: (string | UserRow)[] }>>;
  'get-objects': Request<[owner: string, type: string, loading?: LoadingOptions], Response<{ objects: NamedObject[] }>>;
  'get-columns': Request<[schema: string, table: string, loading?: LoadingOptions], Response<{ columns: string[] }>>;
  'get-tablespaces': Request<[], Response<{ tablespaces: Omit<TablespaceRow, 'id'>[] }>>;
  'get-tablespace-details': Request<[name: string], Response<{ datafiles: Omit<DatafileRow, 'id'>[] }>>;
  'get-directories': Request<[], Response<{ directories: Omit<DirectoryRow, 'id'>[] }>>;
  'get-directory-privileges': Request<[name: string], Response<{ privileges: GrantedPrivilege[] }>>;
  'get-sessions': Request<[], Response<{ sessions: Omit<SessionRow, 'id'>[] }>>;
  'get-session-stats': Request<[sid: number], Response<{ stats: Omit<SessionStatistic, 'id'>[] }>>;
  'get-locks': Request<[], Response<{ locks: Omit<LockRow, 'id'>[] }>>;
  'kill-session': Request<[sid: number, serial: number], Response>;
  'cancel-sql': Request<[sid: number, serial: number], Response>;
  'execute-stored': Request<[params: StoredRequest], Response<StoredData>>;
  'cancel-execution': Request<[batchId?: string], Response>;
  'begin-sql-batch': Request<[batchId: string], Response>;
  'end-sql-batch': Request<[batchId: string], Response>;
  'start-debug': Request<[params: StoredRequest], Response<TraceData>>;
  'step-debug': Request<[params: Record<string, unknown>], Response<TraceData>>;
  'execute-trace': Request<[params: TraceRequest], Response<TraceData>>;
  'delete-trace-db': Request<[target: TraceTarget], Response>;
  'get-trace-data': Request<[target: TraceTarget], Response<{ info: TraceInfo | null; steps: TraceStep[] }>>;
  'get-trace-for-ai': Request<[params: TraceTarget & { dbType: 'oracle' | 'postgresql'; approvedBytes?: number }], { success: true; content: string } | { success: false; requiresConfirmation: true; sizeBytes: number } | { success: false; requiresConfirmation?: false; error: string }>;
  'get-ai-settings': Request<[], Response<AiSettings>>;
  'get-ai-database-context': Request<[], Response<{ environment: AiDatabaseContext }>>;
  'save-ai-settings': Request<[settings: AiSettings], Response<{ credentialsPersisted: boolean }>>;
  'get-ai-usage-history': Request<[year: number], Response<{ records: AiUsageRecord[] }>>;
  'load-ai-source-history': Request<[identity: AiSourceIdentity], Response<{ conversation: SourceConversation | null }>>;
  'save-ai-source-history': Request<[identity: AiSourceIdentity, conversation: SourceConversation], Response>;
  'load-ai-debug-history': Request<[identity: AiSourceIdentity], Response<{ conversation: SourceConversation | null }>>;
  'save-ai-debug-history': Request<[identity: AiSourceIdentity, conversation: SourceConversation], Response>;
  'delete-ai-object-history': Request<[identity: AiSourceIdentity], Response>;
  'ask-ai': Request<[prompt: string, history?: { role: string; content: string }[], requestType?: string, requestId?: string, options?: { stream?: boolean }], Response<AiAnswer>>;
  'cancel-ai': Request<[requestId: string], { success: boolean; cancelled: boolean }>;
  'git-review-sources': Request<[sources: GitReviewSource[]], Response<{ head: string | null; rows: GitReviewRow[] }>>;
  'git-commit-sources': Request<[request: { head: string | null; rows: GitReviewRow[]; message: string }], Response<{ committed?: boolean; commitId?: string }>>;
  'git-get-conflicts': Request<[], Response<{ files: GitConflict[]; token: string }>>;
  'git-resolve-conflict': Request<[request: { path: string; token: string; choice: 'ours' | 'theirs' | 'manual'; content?: string }], Response<{ files: GitConflict[]; token: string }>>;
  'git-complete-merge': Request<[request: { message: string; token: string }], Response<{ commitId: string }>>;
  'git-status-check': Request<[], Response<{ isRepo: boolean; remoteUrl: string | null; repoPath: string; ahead: number | null; branch: string | null; tracking: string | null }>>;
  'git-init-local': Request<[], Response>;
  'git-set-remote': Request<[remote: { url: string; branch: string }], { success: boolean; needsPull?: boolean; error?: string }>;
  'git-commit': Request<[object: GitObject & { sourceText: string; message: string }], Response>;
  'git-get-history': Request<[object: GitObject & { page?: number }], Response<{ history: GitRevision[]; hasMore?: boolean; page?: number }>>;
  'git-get-file-content': Request<[object: GitObject & { commitId: string }], Response<{ content: string }>>;
  'git-push': Request<[], Response>;
  'git-pull': Request<[], Response<GitPullData>>;
  'git-pull-force': Request<[strategy?: 'ours' | 'theirs'], Response<GitPullData>>;
  'git-merge-abort': Request<[], Response>;
  'git-push-force': Request<[], Response>;
  'git-delete-object': Request<[object: GitObject], Response>;
  'git-rename-object': Request<[object: Omit<GitObject, 'objectName'> & { oldName: string; newName: string }], Response>;
  'git-commit-er': Request<[object: ErObject & { sourceText: string; message: string }], Response>;
  'git-get-history-er': Request<[object: ErObject & { page?: number }], Response<{ history: GitRevision[]; hasMore?: boolean; page?: number }>>;
  'git-get-file-content-er': Request<[object: ErObject & { commitId: string }], Response<{ content: string }>>;
  'get-er-diagrams': Request<[dbType: string], Response<{ files: string[] }>>;
  'load-er-diagram': Request<[object: ErObject], Response<{ data: string }>>;
  'save-er-diagram': Request<[object: ErObject & { sourceText: string }], Response<{ filePath: string }>>;
  'delete-er-diagram': Request<[object: ErObject], Response>;
}
export interface DesktopEvents {
  'focus-diagnostics': [records: FocusDiagnosticRecord[]];
  'ai-response-chunk': [payload: { requestId: string; text: string }];
  'ai-usage-history-updated': [year: number];
}
export type RequestChannel = keyof DesktopRequests;
export type RequestArgs<C extends RequestChannel> = DesktopRequests[C]['args'];
export type RequestResult<C extends RequestChannel> = DesktopRequests[C]['result'];
export interface Invoke {
  (channel: 'get-schemas', includeMaintained?: boolean, detailed?: false): Promise<Response<{ schemas: string[] }>>;
  (channel: 'get-schemas', includeMaintained: boolean, detailed: true): Promise<Response<{ schemas: Omit<UserRow, 'id'>[] }>>;
  <C extends Exclude<RequestChannel, 'execute-sql' | 'execute-sql-bg' | 'explain-sql' | 'get-schemas'>>(channel: C, ...args: RequestArgs<C>): Promise<RequestResult<C>>;
  <Row = DatabaseRow>(channel: 'execute-sql' | 'explain-sql', ...args: SqlArguments): Promise<SqlResponse<Row>>;
  <Row = DatabaseRow>(channel: 'execute-sql-bg', ...args: [sql: string, binds?: Record<string, unknown>, schema?: string | null, container?: string | null]): Promise<SqlResponse<Row>>;
  <Row = DatabaseRow>(channel: 'execute-sql' | 'execute-sql-bg' | 'explain-sql', ...args: SqlArguments): Promise<SqlResponse<Row>>;
}
export type EventListener<C extends keyof DesktopEvents> = (event: undefined, ...args: DesktopEvents[C]) => void;
