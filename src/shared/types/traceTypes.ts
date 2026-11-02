// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface TraceTarget { schema: string; objectName: string; objectType: string; signature?: string; tableName?: string; }

export interface TraceStep {
  lineNum: number;
  variables: Record<string, string>;
  loopPath?: string;
  logText?: string;
}

export interface BreakpointCondition {
  type: 'hit_count' | 'variable';
  count?: number;
  varName?: string;
  operator?: string;
  expectedValue?: string;
}

export type TraceAction = 'start' | 'auto_start' | 'resume' | 'step_over' | 'step_into' | 'step_out' | 'stop';

// Both database adapters implement this contract without depending on each other.
export interface TraceSimulator {
  executionSteps: TraceStep[];
  isSimulating: boolean;
  currentStepIndex: number;
  activeLine: number | null;
  currentVariables: Record<string, string>;
  breakpoints: number[];
  breakpointConditions: Record<number, BreakpointCondition>;
  parseTraceLogs: (logs: string[], autoStart?: boolean) => void;
  clearSimulation: () => void;
  loadSimulation: (steps: TraceStep[]) => void;
  handleSimulateStep: (action: TraceAction) => void;
  toggleBreakpoint: (lineNum: number) => void;
  setBreakpointCondition: (lineNum: number, condition: BreakpointCondition | null) => void;
}
export type GroupedVariables = Record<string, string | Record<string, string>>;
export interface ReturnValue { name: string; value: unknown; }
