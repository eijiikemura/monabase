// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react';
import { linter } from '@codemirror/lint';
import { CompletionContext } from '@codemirror/autocomplete';
import { useViewEditor, type ViewEditorProps } from '@/features/view/useViewEditor';
import { useDbCompletions } from '@/features/sql/hooks/useDbCompletions';
import { sql } from '@codemirror/lang-sql';
import { plsqlDialect, oracleBuiltinCompletions } from '../common/plsqlDialect';

export type ViewWindowProps = ViewEditorProps;
export const useViewWindow = (props: ViewWindowProps) => {
  const editor = useViewEditor('oracle', props);
  const { dbCompletions, dbSchema } = useDbCompletions(editor.schema);
  const extensions = useMemo(() => {
    return [
      linter(view => editor.compileErrors.filter(error => error.line >= 1 && error.line <= view.state.doc.lines).map(error => {
        const line = view.state.doc.line(error.line);
        return { from: Math.min(line.to, line.from + Math.max(0, error.col - 1)), to: line.to, severity: 'error' as const, message: error.text };
      })),
      sql({ dialect: plsqlDialect, upperCaseKeywords: true, schema: dbSchema }),
      plsqlDialect.language.data.of({
        autocomplete: (context: CompletionContext) => {
          const word = context.matchBefore(/\w*/);
          const dotBefore = context.matchBefore(/\.\w*/);
          if (dotBefore) return null;
          if (!word || (word.from === word.to && !context.explicit)) return null;
          return {
            from: word.from,
            options: [...dbCompletions, ...oracleBuiltinCompletions]
          };
        }
      })
    ];
  }, [dbCompletions, dbSchema, editor.compileErrors]);

  return { ...editor, extensions };
};
