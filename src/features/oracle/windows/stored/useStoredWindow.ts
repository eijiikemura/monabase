// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { StoredIdentity, StoredAiProps } from "@/features/stored/storedCreation";
import type { GroupedVariables } from "@/shared/types/traceTypes";
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { linter, type Diagnostic } from '@codemirror/lint';
import { sql } from '@codemirror/lang-sql';
import { EditorView } from '@codemirror/view';
import { CompletionContext } from '@codemirror/autocomplete';

import { plsqlDialect, oracleFunctionHighlighting, oracleBuiltinCompletions } from '../common/plsqlDialect';
import { useTraceSimulator } from '../common/useTraceSimulator';
import { useDbCompletions } from "@/features/sql/hooks/useDbCompletions";
import { useStoredLogic } from './useStoredLogic';

import { DEFAULT_DATETIME_FORMAT } from "@/shared/utils/dateFormatter";

export interface StoredWindowProps extends StoredAiProps {
  isNew?: boolean;
  onCreated?: (tabId: number, identity: StoredIdentity) => void;
  tabId: number; 
  schema: string; 
  objectName: string; 
  objectType: 'FUNCTION' | 'PROCEDURE'; 
  isActive: boolean;
  outputDateFormat?: string;
  inputDateFormat?: string;
  onDirtyStateChange?: (tabId: number, isDirty: boolean) => void;
}

export const useStoredWindow = (props: StoredWindowProps) => {
  const { t } = useTranslation();
  const { onDirtyStateChange } = props;
  const simulator = useTraceSimulator();
  
  const logic = useStoredLogic(
    props.schema, 
    props.objectName, 
    props.objectType, 
    props.isActive, 
    simulator, 
    props.inputDateFormat || DEFAULT_DATETIME_FORMAT, 
    props.outputDateFormat || DEFAULT_DATETIME_FORMAT,
    { isNew: props.isNew, onCreated: identity => props.onCreated?.(props.tabId, identity) }
  );

  useEffect(() => {
    if (onDirtyStateChange) {
      onDirtyStateChange(props.tabId, logic.hasUnsavedChanges);
    }
  }, [logic.hasUnsavedChanges, props.tabId, onDirtyStateChange]);

  const { dbCompletions, dbSchema } = useDbCompletions(props.schema);

  const [tabState, setTabState] = useState({
    mainTab: 0,
    hasOpenedTraceTab: false
  });
  const { mainTab, hasOpenedTraceTab } = tabState;

  const setMainTab = useCallback((value: number) => {
    setTabState(previous => previous.mainTab === value ? previous : {
      mainTab: value,
      hasOpenedTraceTab: previous.hasOpenedTraceTab || value === 1
    });
  }, []);
  const [bottomTab, setBottomTab] = useState(0); 
  const [traceRightTab, setTraceRightTab] = useState(0);

  useEffect(() => {
    if (logic.compileErrors.length > 0 || (logic.dbmsOutputs.length > 0 && logic.dbmsOutputs[0]?.includes(t("error")))) {
      setBottomTab(1);
    }
  }, [logic.compileErrors, logic.dbmsOutputs, t]);

  // Use a 6:4 horizontal split for the right panel and retain the 7:3 vertical split.
  const [leftWidth, setLeftWidth] = useState<number>(window.innerWidth * 0.6);
  const [topHeight, setTopHeight] = useState<number>((window.innerHeight - 150) * 0.7);
  const ratioRef = useRef({ left: 0.6, top: 0.7 });
  
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);
  const [isResizingH, setIsResizingH] = useState(false);
  const [isResizingV, setIsResizingV] = useState(false);

  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const resizeRef = useRef({ startX: 0, startY: 0, startWidth: 0, startHeight: 0 });
  
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuLineNum, setMenuLineNum] = useState<number | null>(null);

  const groupedVariables = useMemo(() => {
    const groups: GroupedVariables = {};
    Object.entries(simulator.currentVariables).forEach(([key, val]) => {
      const baseMatch = key.match(/^([a-zA-Z0-9_]+)(.*)$/);
      if (baseMatch) {
        if (baseMatch[2] === '') groups[baseMatch[1]] = val;
        else { if (typeof groups[baseMatch[1]] !== 'object') groups[baseMatch[1]] = {}; const group = groups[baseMatch[1]];
            if (typeof group === 'object') group[baseMatch[2]] = val; }
      } else { groups[key] = val; }
    });
    return groups;
  }, [simulator.currentVariables]);

  // Preserve split ratios when the window resizes.
  useEffect(() => {
    const handleWindowResize = () => {
      setLeftWidth(window.innerWidth * ratioRef.current.left);
      setTopHeight(Math.max(150, (window.innerHeight - 150) * ratioRef.current.top));
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingH && isRightPanelOpen) {
        const newWidth = Math.max(200, resizeRef.current.startWidth + (e.clientX - resizeRef.current.startX));
        setLeftWidth(newWidth);
        ratioRef.current.left = newWidth / window.innerWidth;
      } 
      if (isResizingV) {
        const newHeight = Math.max(150, resizeRef.current.startHeight + (e.clientY - resizeRef.current.startY));
        setTopHeight(newHeight);
        ratioRef.current.top = newHeight / Math.max(1, window.innerHeight - 150);
      } 
    };
    const handleMouseUp = () => { setIsResizingH(false); setIsResizingV(false); };
    if (isResizingH || isResizingV) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); document.body.style.userSelect = 'none'; document.body.style.cursor = isResizingH ? 'col-resize' : 'row-resize'; } 
    else { document.body.style.userSelect = ''; document.body.style.cursor = ''; }
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [isResizingH, isResizingV, isRightPanelOpen]);

  useEffect(() => { 
    if (simulator.activeLine) {
        document.getElementById(`trace-line-${simulator.activeLine}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); 
    }
  }, [simulator.activeLine]);

  useEffect(() => {
    if (!logic.traceDateTime && mainTab === 1) {
      setMainTab(0);
    }
  }, [logic.traceDateTime, mainTab, setMainTab]);

  const handleCloseContextMenu = useCallback(() => {
    setAnchorEl(null);
    setMenuLineNum(null);
  }, []);

  const { breakpoints, toggleBreakpoint } = simulator;
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLElement>, lineNum: number) => {
    e.preventDefault();
    if (props.isNew) return;
    if (!breakpoints.includes(lineNum)) toggleBreakpoint(lineNum);
    setMenuLineNum(lineNum);
    setAnchorEl(e.currentTarget); 
  }, [breakpoints, toggleBreakpoint, props.isNew]);

  const oracleLinter = useMemo(() => linter((view) => {
    return logic.compileErrors.map(err => {
      if (err.line > 0 && err.line <= view.state.doc.lines) {
        const line = view.state.doc.line(err.line);
        const from = line.from + (err.col > 0 ? err.col - 1 : 0);
        return { from: Math.min(from, line.to), to: line.to, severity: "error", message: err.text };
      }
      return null;
    }).filter(Boolean) as Diagnostic[];
  }), [logic.compileErrors]);

  const handleConsoleClick = useCallback((lineText: string) => {
    const match = lineText.match(/Line (\d+):/i) || lineText.match(/行\s+(\d+)/i);
    if (match && editorRef.current?.view) {
      const pos = editorRef.current.view.state.doc.line(parseInt(match[1], 10)).from; 
      editorRef.current.view.dispatch({ selection: { anchor: pos, head: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    }
  }, []);

  const argumentCompletions = useMemo(() => {
    return logic.argumentsList.filter((a) => a.POSITION > 0).map((arg) => ({
      label: arg.ARGUMENT_NAME,
      type: 'variable',
      detail: t("arguments") + ` (${arg.DATA_TYPE})`
    }));
  }, [logic.argumentsList, t]);

  const extensions = useMemo(() => {
    return [
      sql({ dialect: plsqlDialect, upperCaseKeywords: true, schema: dbSchema }),
      plsqlDialect.language.data.of({
        autocomplete: (context: CompletionContext) => {
          const word = context.matchBefore(/\w*/);
          const dotBefore = context.matchBefore(/\.\w*/);
          if (dotBefore) return null;
          if (!word || (word.from === word.to && !context.explicit)) return null;
          return {
            from: word.from,
            options: [...dbCompletions, ...logic.localCompletions, ...argumentCompletions, ...oracleBuiltinCompletions]
          };
        }
      }),
      oracleLinter,
      oracleFunctionHighlighting
    ];
  }, [dbCompletions, dbSchema, logic.localCompletions, argumentCompletions, oracleLinter]);

  return {
    t, simulator, logic, mainTab, setMainTab, hasOpenedTraceTab,
    bottomTab, setBottomTab, traceRightTab, setTraceRightTab,
    leftWidth, topHeight, isRightPanelOpen, setIsRightPanelOpen, isResizingH, setIsResizingH, isResizingV, setIsResizingV,
    editorRef, resizeRef, anchorEl, menuLineNum, groupedVariables, handleCloseContextMenu, handleContextMenu, handleConsoleClick, extensions
  };
};
