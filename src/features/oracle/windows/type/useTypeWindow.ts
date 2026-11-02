// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useRef, useCallback } from 'react';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { linter, type Diagnostic } from '@codemirror/lint';
import { sql } from '@codemirror/lang-sql';
import { EditorView } from '@codemirror/view';
import { plsqlDialect, oracleFunctionHighlighting } from '../common/plsqlDialect';
import { useDbCompletions } from '@/features/sql/hooks/useDbCompletions';
import { useTypeEditor, type TypeEditorProps } from '@/features/type/useTypeEditor';

export type TypeWindowProps = TypeEditorProps;
export const useTypeWindow = (props: TypeWindowProps) => {
  const logic = useTypeEditor('oracle', props);
  const { compileErrors } = logic;
  const { dbSchema } = useDbCompletions(props.schema);
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const oracleLinter = useMemo(() => {
    return linter((view) => {
      return compileErrors.map(err => {
        if (err.line > 0 && err.line <= view.state.doc.lines) {
          const line = view.state.doc.line(err.line);
          const from = line.from + (err.col > 0 ? err.col - 1 : 0);
          return { from: Math.min(from, line.to), to: line.to, severity: err.severity, message: err.text };
        }
        return null;
      }).filter(Boolean) as Diagnostic[];
    });
  }, [compileErrors]);

  const extensions = useMemo(() => [
    sql({ dialect: plsqlDialect, upperCaseKeywords: true, schema: dbSchema }),
    oracleFunctionHighlighting,
    oracleLinter
  ], [dbSchema, oracleLinter]);

  const handleConsoleClick = useCallback((lineText: string) => {
    const match = lineText.match(/Line\s+(\d+)/i) || lineText.match(/行\s+(\d+)/i);
    if (match && editorRef.current?.view) {
      const lineNum = parseInt(match[1], 10);
      const docLines = editorRef.current.view.state.doc.lines; 
      const safeLine = Math.min(Math.max(1, lineNum), docLines); 
      const pos = editorRef.current.view.state.doc.line(safeLine).from; 
      editorRef.current.view.dispatch({ selection: { anchor: pos, head: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    }
  }, []);

  return { ...logic, editorRef, extensions, handleConsoleClick };
};
