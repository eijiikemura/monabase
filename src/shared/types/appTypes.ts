// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface ConnectionConfig {
  /** Runtime-only scope issued after a successful database connection. */
  aiHistoryScope?: string;
  dbType: string;
  user: string;
  name?: string;
  environmentLabel?: string;
  environmentColor?: 'neutral' | 'blue' | 'green' | 'orange' | 'red' | 'purple';
  host?: string;
  port?: string;
  database?: string;
  password?: string;
  readonly?: boolean;
  useOsAuth?: boolean;
  useSysdba?: boolean;
  pgSslMode?: 'disable' | 'verify-full';
  pgSslCaFile?: string;
  pgSslServerName?: string;
  useSshTunnel?: boolean;
  sshHost?: string;
  sshPort?: string;
  sshUser?: string;
  sshAuthType?: string;
  sshPassword?: string;
  sshKeyFile?: string;
  unavailableCredentials?: Array<'password' | 'sshPassword'>;
}

export type AiSendKey = 'enter' | 'modifier-enter';

export interface AiResponseLimits {
  aiResponseMaxMb: number;
  aiIdleTimeoutSeconds: number;
  aiRequestTimeoutSeconds: number;
}

export interface FileReadLimits {
  sqlFileMaxMb: number;
  erFileMaxMb: number;
}

export interface AppSettings extends Partial<AiResponseLimits>, Partial<FileReadLimits> {
  aiSendKey?: AiSendKey;
  language: string;
  maxTabs: number;
  sqlHistoryLimit: number;
  sqlHistoryEnabled?: boolean;
  outputDateFormat: string;
  inputDateFormat: string;
  numberFormat: string;
  timezone: string;
  theme: string;
  queryTimeout: number;
  erNotation?: string;
  oracleClientPath?: string;
}
