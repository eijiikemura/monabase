// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo } from 'react';
import { useAiSqlGeneration } from '@/features/ai/useAiSqlGeneration';
import { useAiObjectSelection } from '@/features/ai/useAiObjectSelection';
import { useAiHistoryConnectionScope } from '@/features/ai/AiHistoryConnectionContext';
import { assertMysqlSourceTarget } from './sourceIdentity';
import { parseCodingResponse } from '@/features/ai/codingResponse';
import { normalizeAiSql, isAiSql } from '@/features/ai/useAiSqlGeneration';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import type { AiCodingResponseTarget, AiContext, AiSourceIdentity } from '@/shared/types/aiTypes';

export function useMysqlEditorAi({ text, setText, active, schema, tabId, object, isNew = false, onOpenAi }: {
  text: string; setText: (text: string) => void; active: boolean; schema: string; tabId: number;
  object?: DatabaseObject; isNew?:boolean; onOpenAi: (context: AiContext) => void;
}) {
  const generation = useAiSqlGeneration({ sqlText: text, setSqlText: setText, isActive: active, dbType: 'mysql', schema });
  const scope = useAiHistoryConnectionScope();
  const selection = useAiObjectSelection({ dbType: 'mysql', initialSchema: schema });
  useEffect(() => { if (object&&!isNew) selection.addObjects([object]); }, [object, isNew, selection]);
  const codingTarget = useMemo<AiCodingResponseTarget>(() => ({
    ...generation.responseTarget,
    getReferencePrompt: () => [generation.responseTarget.getReferencePrompt(),
      object ? `${isNew?'Create a new':'Edit the existing'} MySQL 8.4 ${object.category} identified by ${JSON.stringify({ schema: object.schema, name: object.name })}. Keep that exact identity and public parameters. Preserve security and session-mode semantics unless the user explicitly requests a change. Return one complete ${object.category === 'VIEW' ? 'CREATE OR REPLACE VIEW definition' : 'CREATE definition (MySQL routines do not support CREATE OR REPLACE)'}; do not include DROP, USE, SET or DELIMITER commands. Changes are local drafts and must never be described as executed or compiled.` : ''
    ].filter(Boolean).join('\n'),
    review: answer => {
      const review = generation.responseTarget.review(answer);
      if (review && object) assertMysqlSourceTarget(review.after, object);
      return review;
    },
    commit: answer => {
      let source: string | undefined;
      try { const response = parseCodingResponse(answer); if (response.status === 'success') source = response.source; }
      catch { if (isAiSql(answer, 'mysql')) source = normalizeAiSql(answer); }
      if (source && object) assertMysqlSourceTarget(source, object);
      return generation.responseTarget.commit(answer);
    },
    getHistoryIdentity: () => {
      if (isNew || !object || !['FUNCTION', 'PROCEDURE', 'TRIGGER'].includes(object.category)) return null;
      return { connectionScope: scope, dbType: 'mysql', category: object.category as AiSourceIdentity['category'], schema: object.schema, objectName: object.name };
    },
    subscribeHistoryIdentity: () => () => {}
  }), [generation.responseTarget, object, scope, isNew]);
  const open = useEventCallback(() => {
    onOpenAi({ targetTab: object ? `${object.schema}.${object.name}` : `SQL ${tabId}`, targetTabId: tabId,
      requestType: object && ['FUNCTION', 'PROCEDURE', 'TRIGGER'].includes(object.category) ? `coding_${object.category.toLowerCase()}` : 'coding', requestId: crypto.randomUUID(),
      objectSelection: selection, ...(object ? { codingResponse: codingTarget } : { sqlResponse: generation.responseTarget }) });
  });
  return { ...generation, open };
}
