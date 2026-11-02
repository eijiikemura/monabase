// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { SequenceSettingsStatus } from '@/features/sequence/SequenceSettingsStatus';
import React from 'react';
import { Box, TextField, Checkbox, Button, Typography, Paper, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useSequenceStructureTab, type SequenceStructureTabProps } from './useSequenceStructureTab';

const styles = {
  rootBox: { p: 2, height: '100%', overflowY: 'auto' as const, position: 'relative' as const },
  mainPaper: { p: 3, maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column' as const, gap: 3, bgcolor: 'background.paper' },
  headerTitle: { borderBottom: '2px solid', borderColor: 'primary.main', pb: 1, mb: 1 },
  gridContainer: { display: 'grid', gridTemplateColumns: '150px 1fr', gap: 2, alignItems: 'center' },
  boldText: { fontWeight: 'bold' },
  currentValueBox: { display: 'flex', gap: 1 },
  currentValueInput: { width: 120, bgcolor: 'action.hover' },
  shortInput: { width: 120 },
  cacheInput: { width: 80 },
  checkboxRow: { display: 'flex', gap: 2, alignItems: 'center' },
  checkboxItem: { display: 'flex', alignItems: 'center', cursor: 'pointer' },
  checkboxItemDisabled: { display: 'flex', alignItems: 'center', cursor: 'default', opacity: 0.5 },
  optionsContainer: { display: 'flex', flexWrap: 'wrap' as const, gap: 2 },
  actionButtons: (isNew: boolean) => ({ display: 'flex', justifyContent: isNew ? 'flex-end' : 'space-between', mt: 2 })
};

export default function SequenceStructureTab(props: SequenceStructureTabProps) {
  const { t } = useTranslation();
  const {
    isLoading, seqName, setSeqName, incrementBy, setIncrementBy, startWith, setStartWith,
    currentValue, setCurrentValue, observedValue, metadataReady, loadError, fieldErrors, conflict, restartSupport, loadSequenceInfo, discardChanges, keepLocalChanges, hasMaxValue, setHasMaxValue, maxValue, setMaxValue,
    hasMinValue, setHasMinValue, minValue, setMinValue, isCycle, setIsCycle,
    hasCache, setHasCache, cacheValue, setCacheValue, isOrder, setIsOrder,
    isKeep, setIsKeep, isSession, setIsSession, handleIncrementCurrentValue,
    restartPending, handleRestart, handleDelete, handleSave
  } = useSequenceStructureTab(props);

  return (
    <Box sx={styles.rootBox}>
      <Paper data-testid="sequence-settings" elevation={1} sx={styles.mainPaper}>
        <Typography variant="subtitle1" fontWeight="bold" sx={styles.headerTitle}>
          {props.isNew ? t("create_sequence") : t("alter_sequence")}
        </Typography>

        <SequenceSettingsStatus error={loadError} ready={metadataReady && !props.isNew} busy={isLoading || !!props.isWindowLoading} conflict={conflict} restartSupport={props.isNew ? 'supported' : restartSupport}
          onRetry={() => void loadSequenceInfo()} onDiscard={discardChanges} onKeep={keepLocalChanges} />
        <Box component="fieldset" disabled={isLoading || !!props.isWindowLoading || !metadataReady} sx={[styles.gridContainer, { border: 0, p: 0, m: 0, minWidth: 0, pointerEvents: isLoading || props.isWindowLoading || !metadataReady ? 'none' : undefined }]}>
          
          <Typography variant="body2" sx={styles.boldText}>{t("sequence_name")}</Typography>
          <TextField 
            size="small" 
            fullWidth 
            disabled={!props.isNew} 
            value={props.isNew ? seqName : props.sequenceName} 
            onChange={e => setSeqName(e.target.value)} 
          />

          {!props.isNew && (
            <React.Fragment>
              <Typography variant="body2" sx={styles.boldText}>{t('sequence_observed_value')}</Typography>
              <TextField size="small" inputProps={{ 'aria-label': t('sequence_observed_value') }} value={observedValue ?? t('sequence_value_unknown')} InputProps={{ readOnly: true }} />
              <Typography variant="body2" sx={styles.boldText}>{t("sequence_restart_target")}</Typography>
              <Box sx={styles.currentValueBox}>
                <TextField size="small" disabled={!metadataReady} inputProps={{ 'aria-label': t('sequence_restart_target') }} value={currentValue} onChange={event => setCurrentValue(event.target.value)} error={!!fieldErrors.currentValue} helperText={fieldErrors.currentValue} sx={styles.currentValueInput} />
                <Tooltip title={t("sequence_step_restart_target")}>
                  <span>
                    <Button disabled={isLoading || props.isWindowLoading || !metadataReady} variant="outlined" size="small" onClick={handleIncrementCurrentValue}>{t("sequence_add_increment")}</Button>
                  </span>
                </Tooltip>
                <Button disabled={isLoading || props.isWindowLoading || !metadataReady || !restartPending || restartSupport !== 'supported'} variant="outlined" onClick={handleRestart}>{t('sequence_restart')}</Button>
              </Box>
            </React.Fragment>
          )}

          {!props.isNew && <Typography variant="caption" sx={{ gridColumn: '1 / -1' }}>{t('sequence_value_cache_note')}</Typography>}
          <Typography variant="body2" sx={styles.boldText}>{t("increment_increment_by")}</Typography>
          <TextField size="small" sx={styles.shortInput} inputMode="numeric" inputProps={{ 'aria-label': t('increment_increment_by') }} error={!!fieldErrors.incrementBy} helperText={fieldErrors.incrementBy} value={incrementBy} onChange={e => setIncrementBy(e.target.value)} />

          {props.isNew && (
            <React.Fragment>
              <Typography variant="body2" sx={styles.boldText}>{t("start_value_start_with")}</Typography>
              <TextField size="small" sx={styles.shortInput} inputMode="numeric" error={!!fieldErrors.startWith} helperText={fieldErrors.startWith} value={startWith} onChange={e => setStartWith(e.target.value)} />
            </React.Fragment>
          )}

          <Typography variant="body2" sx={styles.boldText}>{t("maximum_maxvalue")}</Typography>
          <Box sx={styles.checkboxRow}>
            <Box sx={styles.checkboxItem} onClick={() => setHasMaxValue(false)}>
              <Checkbox checked={!hasMaxValue} size="small" />
              <Typography variant="body2">{t("nomaxvalue_no_limit")}</Typography>
            </Box>
            <Box sx={styles.checkboxItem} onClick={() => setHasMaxValue(true)}>
              <Checkbox checked={hasMaxValue} size="small" />
              <TextField size="small" disabled={!hasMaxValue} placeholder={t("specify_number")} error={!!fieldErrors.maxValue} helperText={fieldErrors.maxValue} value={maxValue} onChange={e => setMaxValue(e.target.value)} />
            </Box>
          </Box>

          <Typography variant="body2" sx={styles.boldText}>{t("minimum_minvalue")}</Typography>
          <Box sx={styles.checkboxRow}>
            <Box sx={styles.checkboxItem} onClick={() => setHasMinValue(false)}>
              <Checkbox checked={!hasMinValue} size="small" />
              <Typography variant="body2">{t("nominvalue_no_limit")}</Typography>
            </Box>
            <Box sx={styles.checkboxItem} onClick={() => setHasMinValue(true)}>
              <Checkbox checked={hasMinValue} size="small" />
              <TextField size="small" disabled={!hasMinValue} placeholder={t("specify_number")} error={!!fieldErrors.minValue} helperText={fieldErrors.minValue} value={minValue} onChange={e => setMinValue(e.target.value)} />
            </Box>
          </Box>

          <Typography variant="body2" sx={styles.boldText}>{t("cache_cache")}</Typography>
          <Box sx={styles.checkboxRow}>
            <Box sx={isSession ? styles.checkboxItemDisabled : styles.checkboxItem} onClick={() => !isSession && setHasCache(false)}>
              <Checkbox checked={!hasCache} size="small" disabled={isSession} />
              <Typography variant="body2">{t("nocache")}</Typography>
            </Box>
            <Box sx={isSession ? styles.checkboxItemDisabled : styles.checkboxItem} onClick={() => !isSession && setHasCache(true)}>
              <Checkbox checked={hasCache} size="small" disabled={isSession} />
              <TextField size="small" sx={styles.cacheInput} disabled={!hasCache || isSession} inputProps={{ 'aria-label': t('cache_cache') }} error={!!fieldErrors.cacheValue} helperText={fieldErrors.cacheValue} value={cacheValue} onChange={e => setCacheValue(e.target.value)} />
            </Box>
          </Box>

          <Typography variant="body2" sx={styles.boldText}>{t("options")}</Typography>
          <Box sx={styles.optionsContainer}>
            <Box sx={styles.checkboxItem} onClick={() => setIsCycle(!isCycle)}>
              <Checkbox checked={isCycle} size="small" />
              <Typography variant="body2">{t("cycle_restart_from_min_when_max_is_reached")}</Typography>
            </Box>

            <Box sx={isSession ? styles.checkboxItemDisabled : styles.checkboxItem} onClick={() => !isSession && setIsOrder(!isOrder)}>
              <Checkbox checked={isOrder} size="small" disabled={isSession} />
              <Typography variant="body2">{t("order_guarantees_generation_order")}</Typography>
            </Box>
            
            <Box sx={styles.checkboxItem} onClick={() => setIsKeep(!isKeep)}>
              <Checkbox checked={isKeep} size="small" />
              <Typography variant="body2">{t("keep_12c_keep_original_value_on_replay")}</Typography>
            </Box>

            <Box sx={styles.checkboxItem} onClick={() => setIsSession(!isSession)}>
              <Checkbox checked={isSession} size="small" />
              <Typography variant="body2">{t("session_12c_session_specific_sequence")}</Typography>
            </Box>
          </Box>
        </Box>

        {isSession && (
          <Typography variant="caption" color="error">
            {t("if_session_is_specified_cache_and_order_settings_are_ignored_and_disabled")}
          </Typography>
        )}

        <Box sx={styles.actionButtons(props.isNew)}>
          {!props.isNew && (
            <Button disabled={isLoading || props.isWindowLoading || !metadataReady} variant="outlined" color="error" onClick={handleDelete}>
              {t("drop_sequence")}
            </Button>
          )}
          <Button disabled={isLoading || props.isWindowLoading || !metadataReady} variant="contained" color="primary" size="large" onClick={handleSave}>
            {props.isNew ? t("create_sequence_2") : t("save")}
          </Button>
        </Box>

      </Paper>
    </Box>
  );
}