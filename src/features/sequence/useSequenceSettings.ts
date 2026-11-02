// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import { ipcRenderer } from '@/shared/api/desktop';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { qualifiedObjectName } from '@/shared/utils/objectIdentity';
import { readSequenceMetadata } from './sequenceMetadata';
import { desiredSequence, mergeSequenceChanges, oracleSequenceRestartSupported, sequenceChanges, sequenceDraft, sequenceStatement, SequenceValidationError, validateSequence, type SequenceDatabase, type SequenceDraft, type SequenceField, type SequenceMetadata, type SequenceSettings } from './sequenceModel';
import { sequenceInteger } from './sequenceValues';
export interface SequenceStructureProps {
  tabId: number; schema: string; sequenceName: string; isNew: boolean; isActive?: boolean; reloadKey?: number;
  onReload: () => void; onLoadingChange?: (loading: boolean) => void; isWindowLoading?: boolean;
}
export interface SequenceConflict { baseline: SequenceSettings; desired: SequenceSettings; latest: SequenceSettings; fields: (keyof SequenceSettings)[]; }
const initialDraft: SequenceDraft = { incrementBy: '1', hasMinValue: false, minValue: '', hasMaxValue: false, maxValue: '', hasCache: true, cacheValue: '20', isCycle: false, isOrder: false, isKeep: false, isSession: false };
export function useSequenceSettings(database: SequenceDatabase, props: SequenceStructureProps) {
  const { schema, sequenceName, isNew, isActive = true, reloadKey = 0, onLoadingChange, isWindowLoading = false } = props;
  const { t } = useTranslation();
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter();
  const [draft, setDraft] = useState<SequenceDraft>(initialDraft), [seqName, setSeqName] = useState(sequenceName), [startWith, setStartWith] = useState('1');
  const [currentValue, setRestartValue] = useState('1'), [restartPending, setRestartPending] = useState(false), [observedValue, setObservedValue] = useState<string | null>(null);
  const [metadataReady, setMetadataReady] = useState(isNew), [loadError, setLoadError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SequenceField, string>>>({});
  const [conflict, setConflict] = useState<SequenceConflict | null>(null);
  const [restartSupport, setRestartSupport] = useState<'supported' | 'unsupported' | 'unknown'>(database === 'postgresql' ? 'supported' : 'unknown');
  const baseline = useRef<SequenceMetadata | null>(null), ready = useRef(isNew), requestVersion = useRef(0), editVersion = useRef(0), restartTouched = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  const activeIdentity = useRef('');
  const message = (error: unknown) => { const value = getErrorMessage(error); return value.startsWith('sequence_') ? t(value) : value; };
  const invalid = (error: unknown) => {
    const text = message(error);
    if (error instanceof SequenceValidationError) setFieldErrors({ [error.field]: t(error.key) });
    alert(text);
  };
  const isDirty = () => {
    if (!baseline.current) return false;
    try { return sequenceChanges(baseline.current.settings, desiredSequence(database, draftRef.current, baseline.current.settings.dataType)).length > 0; }
    catch { return true; }
  };
  const loadSequenceInfo = useEventCallback(async (discard = false) => {
    if (isNew || !sequenceName) return;
    const request = ++requestVersion.current, edit = editVersion.current, dirty = isDirty();
    ready.current = false; setMetadataReady(false); setLoadError(''); beginLoading();
    try {
      const [metadata, version] = await Promise.all([readSequenceMetadata(database, schema, sequenceName), database === 'oracle' ? ipcRenderer.invoke('get-db-info').catch(() => null) : null]);
      if (request !== requestVersion.current) return;
      if (database === 'oracle') setRestartSupport(version?.success && version.info ? oracleSequenceRestartSupported(version.info) ? 'supported' : /Oracle Database\s+\d+/i.test(version.info) ? 'unsupported' : 'unknown' : 'unknown');
      setObservedValue(metadata.observed);
      if (edit === editVersion.current && (!dirty || discard)) { baseline.current = metadata; setDraft(sequenceDraft(database, metadata.settings)); setConflict(null); setFieldErrors({}); }
      // A dirty draft keeps its original baseline so concurrent changes remain detectable.
      if (!baseline.current) baseline.current = metadata;
      if (!restartTouched.current) setRestartValue(metadata.observed ?? metadata.start);
      ready.current = true; setMetadataReady(true);
    } catch (error) { if (request === requestVersion.current) setLoadError(message(error)); }
    finally { endLoading(); }
  });
  useEffect(() => {
    const identity = JSON.stringify([database, schema, sequenceName, isNew]);
    if (activeIdentity.current !== identity) {
      activeIdentity.current = identity; baseline.current = null; ready.current = isNew; editVersion.current = 0; restartTouched.current = false;
      setDraft(initialDraft); setSeqName(sequenceName); setStartWith('1'); setRestartValue('1'); setRestartPending(false); setObservedValue(null); setConflict(null); setLoadError(''); setFieldErrors({}); setMetadataReady(isNew);
    }
    const version = requestVersion; return () => { version.current++; };
  }, [database, schema, sequenceName, isNew]);
  useEffect(() => { if (isActive && !isNew && sequenceName) void loadSequenceInfo(); }, [isActive, isNew, schema, sequenceName, reloadKey, loadSequenceInfo]);
  useEffect(() => { onLoadingChange?.(isLoading); }, [isLoading, onLoadingChange]);
  const setter = <K extends keyof SequenceDraft>(key: K) => (update: SetStateAction<SequenceDraft[K]>) => {
    editVersion.current++; setFieldErrors({}); setConflict(null);
    setDraft(previous => ({ ...previous, [key]: typeof update === 'function' ? (update as (value: SequenceDraft[K]) => SequenceDraft[K])(previous[key]) : update }));
  };
  const setCurrentValue = (update: SetStateAction<string>) => { restartTouched.current = true; setRestartPending(true); setFieldErrors({}); setRestartValue(update); };
  const handleIncrementCurrentValue = () => {
    if (isBusy() || isWindowLoading || !ready.current) return;
    try { const increment = sequenceInteger(draft.incrementBy); if (BigInt(increment) === 0n) throw new SequenceValidationError('incrementBy', 'sequence_increment_must_not_be_zero'); setCurrentValue(previous => (BigInt(sequenceInteger(previous)) + BigInt(increment)).toString()); }
    catch (error) { invalid(error); }
  };
  const refresh = () => { window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema, objType: 'SEQUENCE' } })); props.onReload(); };
  const handleSave = useEventCallback(async () => {
    if (isBusy() || isWindowLoading) return;
    if (!ready.current) { alert(t('sequence_metadata_unavailable')); return; }
    if (isNew && !seqName.trim()) { alert(t('please_enter_a_sequence_name')); return; }
    const edited = editVersion.current, identity = activeIdentity.current;
    beginLoading(); setFieldErrors({});
    try {
      const desired = desiredSequence(database, draft, baseline.current?.settings.dataType || (database === 'oracle' ? 'NUMBER' : 'bigint'));
      validateSequence(database, desired, isNew ? { value: startWith, field: 'startWith' } : undefined);
      const targetName = isNew ? database === 'oracle' ? seqName.toUpperCase() : seqName.toLowerCase() : sequenceName;
      let latest: SequenceMetadata | undefined, applied = desired;
      if (!isNew) {
        const base = baseline.current!.settings;
        if (!sequenceChanges(base, desired).length) { alert(t('sequence_no_changes')); return; }
        latest = await readSequenceMetadata(database, schema, sequenceName);
        const { merged, conflicts } = mergeSequenceChanges(base, desired, latest.settings);
        if (conflicts.length) { setConflict({ baseline: base, desired, latest: latest.settings, fields: conflicts }); return; }
        applied = merged; validateSequence(database, applied);
      }
      const statement = sequenceStatement(database, schema, targetName, applied, latest?.settings, isNew ? startWith : undefined);
      if (!statement) {
        if (latest && identity === activeIdentity.current) {
          baseline.current = latest;
          if (editVersion.current === edited) setDraft(sequenceDraft(database, latest.settings));
          setConflict(null);
        }
        alert(t('sequence_no_changes')); return;
      }
      const response = await ipcRenderer.invoke('execute-sql', statement);
      if (!response.success) throw new Error(response.error);
      if (identity !== activeIdentity.current) return;
      if (!isNew) {
        baseline.current = { ...latest!, settings: applied };
        if (editVersion.current === edited) setDraft(sequenceDraft(database, applied));
      }
      setConflict(null); alert(t('sequence_settings_saved')); refresh();
      if (isNew) window.dispatchEvent(new CustomEvent('sequence-created', { detail: { tabId: props.tabId, schema, sequenceName: targetName } }));
    } catch (error) { invalid(error); }
    finally { endLoading(); }
  });
  const handleRestart = useEventCallback(async () => {
    if (isBusy() || isWindowLoading || !ready.current || !restartPending || isNew) return;
    if (restartSupport !== 'supported') { alert(t('sequence_restart_unavailable')); return; }
    beginLoading(); setFieldErrors({});
    try {
      const latest = await readSequenceMetadata(database, schema, sequenceName);
      validateSequence(database, latest.settings, { value: currentValue, field: 'currentValue' });
      const value = sequenceInteger(currentValue), target = qualifiedObjectName({ schema, objectName: sequenceName });
      if (!window.confirm(t('sequence_restart_named_confirmation', { target, value, observed: latest.observed ?? t('sequence_value_unknown') }))) return;
      const response = await ipcRenderer.invoke('execute-sql', `ALTER SEQUENCE ${target} RESTART ${database === 'oracle' ? 'START ' : ''}WITH ${value}`);
      if (!response.success) throw new Error(response.error);
      restartTouched.current = false; setRestartPending(false); alert(t('sequence_restart_completed')); refresh();
    } catch (error) { invalid(error); }
    finally { endLoading(); }
  });
  const handleDelete = useEventCallback(async () => {
    if (isBusy() || isWindowLoading || !ready.current || isNew) return;
    if (!window.confirm(t('sequence_5') + sequenceName + t('this_operation_cannot_be_undone_2'))) return;
    beginLoading();
    try {
      const response = await ipcRenderer.invoke('execute-sql', `DROP SEQUENCE ${qualifiedObjectName({ schema, objectName: sequenceName })}`);
      if (!response.success) throw new Error(response.error);
      window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema, objType: 'SEQUENCE' } }));
      window.dispatchEvent(new CustomEvent('object-deleted', { detail: { schema, objectName: sequenceName, objectType: 'SEQUENCE' } }));
      window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId: props.tabId } })); alert(t('sequence_dropped'));
    } catch (error) { invalid(error); }
    finally { endLoading(); }
  });
  const keepLocalChanges = () => {
    if (!conflict || !baseline.current || isBusy()) return;
    const { merged } = mergeSequenceChanges(conflict.baseline, conflict.desired, conflict.latest);
    baseline.current = { ...baseline.current, settings: conflict.latest }; editVersion.current++; setDraft(sequenceDraft(database, merged)); setConflict(null);
  };
  const discardChanges = () => { if (!isBusy() && window.confirm(t('sequence_discard_edits_confirmation'))) void loadSequenceInfo(true); };
  return { ...draft, seqName, setSeqName, startWith, setStartWith, currentValue, setCurrentValue, observedValue, restartPending, restartSupport,
    incrementBy: draft.incrementBy, setIncrementBy: setter('incrementBy'), setHasMinValue: setter('hasMinValue'), setMinValue: setter('minValue'), setHasMaxValue: setter('hasMaxValue'), setMaxValue: setter('maxValue'), setHasCache: setter('hasCache'), setCacheValue: setter('cacheValue'), setIsCycle: setter('isCycle'), setIsOrder: setter('isOrder'), setIsKeep: setter('isKeep'), setIsSession: setter('isSession'),
    metadataReady, loadError, fieldErrors, conflict, keepLocalChanges, discardChanges, loadSequenceInfo, isLoading, handleSave, handleRestart, handleDelete, handleIncrementCurrentValue };
}
