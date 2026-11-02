// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { getErrorMessage } from '@/shared/utils/errorUtils';
import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { useEventCallback } from '@/shared/hooks/useEventCallback';

// Loading status is independent of editable text; an empty draft is valid user input.
export function useEditableSource(identity: string, fetchSource: () => Promise<string>, initialText: string, failureText: string) {
  const [sourceText, setSource] = useState(initialText);
  const [savedSourceText, setSavedSourceText] = useState(initialText);
  const [sourceStatus, setSourceStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [sourceError, setSourceError] = useState('');
  const ready = useRef(false);
  const hasLoaded = useRef(false);
  const requestVersion = useRef(0);
  const editVersion = useRef(0);
  const reset = useEventCallback(() => {
    requestVersion.current++;
    editVersion.current++;
    setSource(initialText);
    setSavedSourceText(initialText);
    setSourceStatus('idle'); setSourceError(''); ready.current = false; hasLoaded.current = false;
  });
  useEffect(() => {
    reset();
    const version = requestVersion;
    return () => { version.current++; };
  }, [identity, reset]);
  const setSourceText = useEventCallback((update: SetStateAction<string>) => {
    editVersion.current++;
    setSource(update);
  });
  const loadSource = useEventCallback(async () => {
    const request = ++requestVersion.current;
    const edit = editVersion.current;
    const keepDraft = hasLoaded.current && sourceText !== savedSourceText;
    setSourceStatus('loading'); setSourceError(''); ready.current = false;
    try {
      const source = await fetchSource();
      if (request !== requestVersion.current) return;
      if (typeof source !== 'string' || !source.trim()) throw new Error('Empty source definition.');
      setSavedSourceText(source);
      if (edit === editVersion.current && !keepDraft) setSource(source);
      setSourceStatus('success'); ready.current = true; hasLoaded.current = true;
    } catch (error) {
      if (request !== requestVersion.current) return;
      setSourceError(`${failureText}: ${getErrorMessage(error)}`);
      setSourceStatus('error'); ready.current = false;
    }
  });
  const isSourceReady = useEventCallback(() => ready.current);
  return { sourceError, isSourceReady, sourceText, setSourceText, savedSourceText, setSavedSourceText, sourceStatus, loadSource };
}
