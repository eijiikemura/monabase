// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import type { CompileError } from "@/features/stored/storedCommon";
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorState } from '@codemirror/state';
import { linter, type Diagnostic } from '@codemirror/lint';
import { sql } from '@codemirror/lang-sql';
import { CompletionContext } from '@codemirror/autocomplete';

import { pgDialect, pgFunctionHighlighting, pgBuiltinCompletions } from '../common/pgDialect';
import { useDbCompletions } from "@/features/sql/hooks/useDbCompletions";

export interface SqlWindowTopProps {
  sqlText: string; setSqlText: React.Dispatch<React.SetStateAction<string>>;
  editorHeight: number | string;
  isExplainMode: boolean; setIsExplainMode: React.Dispatch<React.SetStateAction<boolean>>;
  handleExecuteSql: () => void; handleFormatSql: () => void;
  editorRef: React.RefObject<ReactCodeMirrorRef>; compileErrors: CompileError[]; localInputDateFormat: string;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  bindVariables: string[]; bindValues: { [key: string]: string }; setBindValues: React.Dispatch<React.SetStateAction<{ [key: string]: string }>>;
  bindTypes: { [key: string]: string }; setBindTypes: React.Dispatch<React.SetStateAction<{ [key: string]: string }>>;
  hideToolbar?: boolean;
  schemas?: string[]; 
  selectedSchema?: string; 
  setSelectedSchema?: (schema: string) => void; 
  // Flag to ignore bind variables.
  ignoreBindVars?: boolean; 
  setIgnoreBindVars?: (val: boolean) => void; 
}

export const useSqlWindowTop = (props: SqlWindowTopProps) => {
  const { compileErrors } = props;
  const { t } = useTranslation();
  const { dbCompletions, dbSchema } = useDbCompletions();

  const japanesePhrases = useMemo(() => EditorState.phrases.of({
    "Find": t("search_2"), "Replace": t("replace"), "Replace all": t("replace_all"), "Next": t("next"), "Previous": t("previous"), "next": t("next"), "previous": t("previous"),
    "all": t("all"), "match case": t("case_sensitive"), "by word": t("word_method"), "regexp": t("regex"), "replace": t("replace"), "replace all": t("replace_all")
  }), [t]);

  const sqlLinter = useMemo(() => linter((view) => {
    const diagnostics: Diagnostic[] = [];
    compileErrors.forEach(err => {
      if (err.line > 0 && err.line <= view.state.doc.lines) {
        const line = view.state.doc.line(err.line);
        let from = line.from + (err.col > 0 ? err.col - 1 : 0); const to = line.to;
        if (from > to) from = to; 
        diagnostics.push({ from, to, severity: "error", message: err.text });
      }
    });
    return diagnostics;
  }), [compileErrors]);

  const extensions = useMemo(() => [
    sql({ dialect: pgDialect, upperCaseKeywords: true, schema: dbSchema }),
    japanesePhrases,
    pgDialect.language.data.of({
      autocomplete: (context: CompletionContext) => {
        const word = context.matchBefore(/\w*/);
        const dotBefore = context.matchBefore(/\.\w*/);
        
        if (dotBefore) return null;
        if (!word || (word.from === word.to && !context.explicit)) return null;
        
        return { from: word.from, options: [...dbCompletions, ...pgBuiltinCompletions] };
      }
    }),
    sqlLinter, pgFunctionHighlighting
  ], [dbCompletions, dbSchema, japanesePhrases, sqlLinter]);

  return { extensions };
};