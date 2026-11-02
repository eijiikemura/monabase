// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react';
import { sql } from '@codemirror/lang-sql';
import type { CompletionContext } from '@codemirror/autocomplete';
import { pgDialect, pgBuiltinCompletions } from '../common/pgDialect';
import { useDbCompletions } from '@/features/sql/hooks/useDbCompletions';
import { useMviewWindow, type MviewWindowProps } from '@/features/materialized-view/useMviewWindow';
export type MaterializedViewWindowProps = MviewWindowProps;
export function useMaterializedViewWindow(props: MaterializedViewWindowProps) {
  const state = useMviewWindow('postgresql', props);
  const { dbCompletions, dbSchema } = useDbCompletions();
  const extensions = useMemo(() => [sql({ dialect: pgDialect, upperCaseKeywords: true, schema: dbSchema }),
    pgDialect.language.data.of({ autocomplete: (context: CompletionContext) => {
      const word = context.matchBefore(/\w*/);
      if (context.matchBefore(/\.\w*/) || !word || word.from === word.to && !context.explicit) return null;
      return { from: word.from, options: [...dbCompletions, ...pgBuiltinCompletions] };
    } })], [dbCompletions, dbSchema]);
  return { ...state, extensions };
}
