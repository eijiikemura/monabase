// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useId, useState, useSyncExternalStore, useEffect, useRef } from 'react';
import { listRelatedObjects } from './relatedObjects';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import { Alert, Box, Button, CircularProgress, Collapse, IconButton, List, ListItem, ListItemText, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import { getAiCategoryLabel } from './aiObjectRepository';
import type { AiObjectSelectionStore } from '@/shared/types/aiTypes';
import AiObjectPickerDialog from './AiObjectPickerDialog';

export default function AiObjectSelectionPanel({ selection, disabled, allowEmpty = false }: {
  selection: AiObjectSelectionStore; disabled: boolean; allowEmpty?: boolean;
}) {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<DatabaseObject[]>([]);
  const [finding, setFinding] = useState(false);
  const [relatedError, setRelatedError] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const targets = useSyncExternalStore(selection.subscribe, selection.getSnapshot);
  const listId = useId();
  const [expanded, setExpanded] = useState(true);
  const [open, setOpen] = useState(false);
  const ready = targets.filter(target => target.status === 'ready').length;
  const loading = targets.filter(target => target.status === 'loading').length;
  const failed = targets.filter(target => target.status === 'error').length;
  const summary = targets.length && ready === targets.length ? t('ready') : [
    loading ? t('ai_references_loading', { total: loading }) : '',
    failed ? t('ai_references_failed', { total: failed }) : '',
    ready ? t('ai_references_ready', { total: ready }) : ''
  ].filter(Boolean).join(' · ');
  const unavailable = !selection.isAvailable();
  const findRelated = async () => {
    if (finding || disabled || unavailable) return;
    const selected = selection.getSnapshot().filter(target => target.status === 'ready').map(target => target.object);
    const identity = JSON.stringify(selected.map(object => object.key));
    setFinding(true); setRelatedError(false); setCandidates([]);
    try {
      const found = new Map<string, DatabaseObject>();
      for (const object of selected.slice(0, 20)) {
        for (const candidate of await listRelatedObjects(object)) found.set(candidate.key, candidate);
      }
      if (active.current && selection.isAvailable() && identity === JSON.stringify(selection.getSnapshot().filter(target => target.status === 'ready').map(target => target.object.key))) {
        setCandidates([...found.values()].filter(object => !selected.some(value => value.key === object.key)).slice(0, 100));
      }
    } catch { if (active.current) setRelatedError(true); }
    finally { if (active.current) setFinding(false); }
  };
  return (
    <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider', maxHeight: '35%', overflowY: 'auto', flexShrink: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Button size="small" color="inherit" startIcon={expanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
          aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>
          {t('target_object_2')} ({targets.length})
        </Button>
        <Tooltip title={t("add_objects_for_ai_to_reference")}>
          <span><Button size="small" startIcon={<AddIcon />} disabled={disabled || unavailable} onClick={() => setOpen(true)}>{t("add")}</Button></span>
        </Tooltip>
      </Box>
      <Typography role="status" aria-live="polite" aria-atomic="true" variant="caption" color={failed ? 'error' : 'text.secondary'}>{summary}</Typography>
      <Box component="details" sx={{ mt: 0.5 }}>
        <Typography component="summary" variant="caption" sx={{ cursor: 'pointer' }}>{t('ai_related_objects')}</Typography>
        <Typography variant="caption" color="text.secondary">{t('ai_related_objects_help')}</Typography>
        <Button size="small" onClick={() => void findRelated()} disabled={disabled || unavailable || finding || !ready}>{t('ai_find_related_objects')}</Button>
        {finding && <CircularProgress size={14} />}
        {relatedError && <Alert severity="warning">{t('ai_related_objects_failed')}</Alert>}
        <Box sx={{ maxHeight: 140, overflow: 'auto' }}>
          {candidates.filter(candidate => !targets.some(target => target.object.key === candidate.key)).map(candidate => (
            <Button key={candidate.key} size="small" fullWidth disabled={disabled || unavailable} sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
              onClick={() => selection.addObjects([candidate])}>{t('add')}: {candidate.schema}.{candidate.displayName} ({candidate.category})</Button>
          ))}
        </Box>
      </Box>
      {unavailable ? <Alert severity="info">{t("the_target_sql_window_has_been_closed")}</Alert>
        : targets.length === 0 ? <Typography variant="caption" color="text.secondary">{allowEmpty ? t("ai_optional_target_objects")
          : t("add_the_required_objects_before_sending_an_ai_request")}</Typography> : null}
      <Collapse in={expanded} unmountOnExit><List id={listId} dense sx={{ maxHeight: 160, overflow: 'auto', py: 0 }}>
        {targets.map(target => (
          <ListItem key={target.object.key} disableGutters sx={{ alignItems: 'flex-start', gap: 0.5 }}>
            <ListItemText sx={{ minWidth: 0 }} primary={
              <Tooltip title={`${target.object.schema}.${target.object.displayName}`}>
                <Typography variant="body2" noWrap>{target.object.schema}.{target.object.displayName}</Typography>
              </Tooltip>
            } secondary={
              <Box component="span" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                {getAiCategoryLabel(target.object.category, t)} ·
                {target.status === 'loading' ? <><CircularProgress size={12} />{t("loading_definition")}</>
                  : target.status === 'ready' ? t("ready")
                  : <Tooltip title={target.error || ''}><Typography component="span" variant="caption" color="error">{t("load_failed")}</Typography></Tooltip>}
              </Box>
            } />
            {target.status === 'error' && (
              <Tooltip title={t("reload_object_definitions")}><span>
                <IconButton size="small" disabled={disabled || unavailable} onClick={() => selection.retryObject(target.object.key)} aria-label={t("reload_definitions")}><RefreshIcon fontSize="small" /></IconButton>
              </span></Tooltip>
            )}
            <Tooltip title={t("remove_from_ai_targets_without_deleting_the_database_object")}><span>
              <IconButton size="small" disabled={disabled || unavailable} onClick={() => selection.removeObject(target.object.key)} aria-label={t("remove_target")}><CloseIcon fontSize="small" /></IconButton>
            </span></Tooltip>
          </ListItem>
        ))}
      </List></Collapse>
      <AiObjectPickerDialog key={selection.id} open={open && !unavailable} onClose={() => setOpen(false)} selection={selection} disabled={disabled} />
    </Box>
  );
}
