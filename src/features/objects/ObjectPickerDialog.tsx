// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { KeyboardEvent } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, CircularProgress, Collapse, Dialog, DialogActions,
  DialogContent, DialogTitle, FormControl, InputLabel, List, ListItemButton,
  ListItemText, MenuItem, Radio, Select, TextField, Typography
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from "@/shared/utils/errorUtils";
import { OBJECT_CATEGORIES, OBJECT_PAGE_SIZE, getObjectCategoryLabel, listObjects, listObjectSchemas } from './objectRepository';
import type { DatabaseObject, ObjectCategory, DbType } from '@/shared/types/objectTypes';
export interface ObjectPickerDialogProps {
  open: boolean;
  dbType: DbType;
  initialSchema?: string;
  initialCategory?: ObjectCategory;
  fixedSchema?: string;
  multiple?: boolean;
  categories?: readonly ObjectCategory[];
  disabled?: boolean;
  title?: string;
  isObjectAdded?: (object: DatabaseObject) => boolean;
  onConfirm: (objects: DatabaseObject[]) => void | Promise<void>;
  onClose: () => void;
}
export default function ObjectPickerDialog({ open, dbType, initialSchema = '', initialCategory, fixedSchema, multiple = true, categories,
  disabled = false, title, isObjectAdded, onConfirm, onClose }: ObjectPickerDialogProps) {
  const { t } = useTranslation();
  const selectionId = useId();
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [focusedKey, setFocusedKey] = useState('');
  const [showSelection, setShowSelection] = useState(false);
  const allowedCategories = useMemo(() => OBJECT_CATEGORIES[dbType].filter(value =>
    !categories || categories.includes(value)), [dbType, categories]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(false);
  const blocked = disabled || submitting;
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState('');
  const [category, setCategory] = useState<ObjectCategory | ''>('');
  const [searchText, setSearchText] = useState('');
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: DatabaseObject[] }>({ key: '', rows: [] });
  const [draft, setDraft] = useState(new Map<string, DatabaseObject>());
  const [loading, setLoading] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [error, setError] = useState('');
  const [schemaError, setSchemaError] = useState('');
  const [reload, setReload] = useState(0);
  const queryKey = JSON.stringify([dbType, schema, category, searchText, offset]);
  // Do not display stale categories or results after conditions change.
  const rows = result.key === queryKey ? result.rows : [];

  useEffect(() => {
    if (!open || !initialCategory || !allowedCategories.includes(initialCategory)) return;
    setCategory(initialCategory);
    setOffset(0);
    setSearchText('');
    setResult({ key: '', rows: [] });
  }, [open, initialCategory, allowedCategories]);

  useEffect(() => {
    if (!open) { setDraft(new Map()); setShowSelection(false); return; }
    let active = true;
    setSchemaLoading(true); setSchemaError('');
    void (fixedSchema ? Promise.resolve([fixedSchema]) : listObjectSchemas(dbType)).then(values => {
      if (!active) return;
      setSchemas(values);
      setSchema(previous => fixedSchema || (values.includes(previous) ? previous
        : values.includes(initialSchema) ? initialSchema : ''));
    }).catch((err: unknown) => {
      if (active) { setSchemas([]); setSchema(''); setSchemaError(getErrorMessage(err)); }
    }).finally(() => { if (active) setSchemaLoading(false); });
    return () => { active = false; };
  }, [open, dbType, initialSchema, fixedSchema, reload]);

  useEffect(() => {
    setResult({ key: queryKey, rows: [] }); setError('');
    if (!open || !schema || !category || !allowedCategories.includes(category) || schemaLoading || schemaError) {
      setLoading(false); return;
    }
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void listObjects({ dbType, schema, category, searchText, offset })
        .then(values => { if (active) setResult({ key: queryKey, rows: values }); })
        .catch((err: unknown) => { if (active) setError(getErrorMessage(err)); })
        .finally(() => { if (active) setLoading(false); });
    }, searchText ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [open, dbType, allowedCategories, schema, category, searchText, offset, schemaLoading, schemaError, reload, queryKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    if (category && !allowedCategories.includes(category)) { setCategory(''); setOffset(0); }
    setDraft(previous => {
      const valid = [...previous.entries()].filter(([, object]) =>
        object.dbType === dbType && allowedCategories.includes(object.category));
      return valid.length === previous.size ? previous : new Map(valid);
    });
  }, [dbType, allowedCategories, category]);

  const close = () => {
    if (submittingRef.current) return;
    setDraft(new Map()); onClose();
  };
  const confirmObjects = async (candidates: readonly DatabaseObject[]) => {
    if (blocked || submittingRef.current) return;
    const objects = candidates.filter(object => object.dbType === dbType &&
      allowedCategories.includes(object.category) && !isObjectAdded?.(object));
    if (!objects.length) return;
    submittingRef.current = true; setSubmitting(true); setError('');
    try {
      await onConfirm(objects);
      if (mountedRef.current) { setDraft(new Map()); onClose(); }
    } catch (err: unknown) {
      if (mountedRef.current) setError(getErrorMessage(err));
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };
  const confirm = () => confirmObjects([...draft.values()]);
  const confirmSingle = (object: DatabaseObject) => {
    if (multiple || blocked || submittingRef.current || loading || schemaLoading || schemaError ||
        !rows.some(row => row.key === object.key) || isObjectAdded?.(object)) return;
    setDraft(new Map([[object.key, object]]));
    void confirmObjects([object]);
  };
  const keyboardReady = !blocked && !loading && !schemaLoading && !schemaError && !error;
  const selectableRows = rows.filter(object => !isObjectAdded?.(object));
  const tabKey = selectableRows.some(object => object.key === focusedKey) ? focusedKey : selectableRows[0]?.key;
  const focusRow = (object: DatabaseObject | undefined) => {
    if (!keyboardReady || !object) return;
    setFocusedKey(object.key);
    rowRefs.current.get(object.key)?.focus();
    rowRefs.current.get(object.key)?.scrollIntoView({ block: 'nearest' });
  };
  const toggleObject = (object: DatabaseObject) => {
    if (!keyboardReady || submittingRef.current || isObjectAdded?.(object)) return;
    setFocusedKey(object.key);
    setDraft(previous => {
      const next = multiple ? new Map(previous) : new Map<string, DatabaseObject>();
      if (multiple && next.has(object.key)) next.delete(object.key); else next.set(object.key, object);
      return next;
    });
  };
  const isComposing = (event: KeyboardEvent) => event.nativeEvent.isComposing || event.keyCode === 229;
  const handleRowKeyDown = (event: KeyboardEvent, object: DatabaseObject) => {
    if (isComposing(event) || event.altKey || event.ctrlKey || event.metaKey) return;
    const index = selectableRows.findIndex(row => row.key === object.key);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? selectableRows.length - 1
        : Math.max(0, Math.min(selectableRows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      focusRow(selectableRows[next]);
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      if (!keyboardReady || event.repeat) return;
      if (event.key === ' ') toggleObject(object);
      else if (!multiple) confirmSingle(object);
    }
  };
  if (!open) return null;
  return (
    <Dialog open onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>{title || t("add_objects")}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <FormControl required size="small" fullWidth disabled={blocked || schemaLoading || !!fixedSchema}>
            <InputLabel>{t("schema")}</InputLabel>
            <Select value={schema} label={t("schema")} onChange={event => {
              setSchema(event.target.value); setOffset(0);
            }}>
              {schemas.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl required size="small" fullWidth disabled={blocked}>
            <InputLabel>{t("category")}</InputLabel>
            <Select value={category} label={t("category")} onChange={event => {
              setCategory(event.target.value as ObjectCategory); setOffset(0);
            }}>
              {allowedCategories.map(value => (
                <MenuItem key={value} value={value}>{getObjectCategoryLabel(value, t)}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        <TextField size="small" label={t("search_by_partial_name")} value={searchText}
          onKeyDown={event => {
            if (event.key !== 'ArrowDown' || isComposing(event) || event.altKey || event.ctrlKey || event.metaKey || !keyboardReady) return;
            event.preventDefault(); focusRow(selectableRows[0]);
          }}
          disabled={blocked || !schema || !category} onChange={event => {
            setSearchText(event.target.value); setOffset(0);
          }} />
        <Typography variant="caption" color="text.secondary">{t(multiple ? 'picker_keyboard_multiple' : 'picker_keyboard_single')}</Typography>
        {!multiple && <Typography variant="caption" color="text.secondary">{t('object_picker_double_click_hint')}</Typography>}
        {(error || schemaError) && (
          <Alert severity="error" action={<Button disabled={blocked} onClick={() => setReload(value => value + 1)}>{t("reload")}</Button>}>
            {error || schemaError}
          </Alert>
        )}
        {loading || schemaLoading ? (
          <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>
        ) : !schema || !category ? (
          <Typography color="text.secondary">{t("select_a_schema_and_category")}</Typography>
        ) : rows.length === 0 && !error && !schemaError ? (
          <Typography color="text.secondary">{t("no_matching_objects")}</Typography>
        ) : (
          <List dense role="listbox" aria-label={title || t("add_objects")} aria-multiselectable={multiple} sx={{ maxHeight: '45vh', overflow: 'auto', border: 1, borderColor: 'divider' }}>
            {rows.map(object => (
              <ListItemButton key={object.key} role="option" aria-selected={draft.has(object.key) || Boolean(isObjectAdded?.(object))}
                ref={element => { if (element) rowRefs.current.set(object.key, element); else rowRefs.current.delete(object.key); }}
                tabIndex={object.key === tabKey ? 0 : -1}
                onFocus={() => setFocusedKey(object.key)}
                onKeyDown={event => handleRowKeyDown(event, object)}
                onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter' || isComposing(event)) event.preventDefault(); }} onDoubleClick={multiple ? undefined : () => confirmSingle(object)} disabled={blocked || Boolean(isObjectAdded?.(object))}
                onClick={event => {
                  // ButtonBase synthesizes keyboard clicks; keyboard actions are handled above.
                  if (event?.type === 'keydown' || event?.type === 'keyup') return;
                  toggleObject(object);
                }}>
                {multiple ? <Checkbox size="small" checked={draft.has(object.key) || Boolean(isObjectAdded?.(object))} tabIndex={-1} disableRipple />
                  : <Radio size="small" checked={draft.has(object.key)} tabIndex={-1} disableRipple />}
                <ListItemText primary={object.displayName}
                  secondary={isObjectAdded?.(object) ? t("already_added") : `${object.schema} · ${getObjectCategoryLabel(object.category, t)}`} />
              </ListItemButton>
            ))}
          </List>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button disabled={blocked || loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - OBJECT_PAGE_SIZE))}>{t("previous_100")}</Button>
          <Typography variant="caption">{rows.length ? `${offset + 1}–${offset + rows.length}` : '0'}{t("items")}</Typography>
          <Button disabled={blocked || loading || rows.length < OBJECT_PAGE_SIZE} onClick={() => setOffset(value => value + OBJECT_PAGE_SIZE)}>{t("next_100")}</Button>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Button size="small" aria-expanded={showSelection} aria-controls={selectionId} onClick={() => setShowSelection(value => !value)}>{t('selected_3', { count: draft.size })}</Button>
          <Button size="small" disabled={blocked || draft.size === 0} onClick={() => setDraft(new Map())}>{t('ux_clear_selection')}</Button>
        </Box>
        <Collapse in={showSelection} unmountOnExit>
          <Box id={selectionId} sx={{ maxHeight: '25vh', overflowY: 'auto' }}>
            <Typography variant="caption" color="text.secondary">{t('ux_selection_help')}</Typography>
            {[...draft.values()].map(object => <Box key={object.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
              <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                <Typography variant="body2">{object.displayName}</Typography>
                <Typography variant="caption" color="text.secondary">{object.schema} · {getObjectCategoryLabel(object.category, t)}</Typography>
              </Box>
              <Button size="small" disabled={blocked} aria-label={t('ux_remove_selected_object', { name: object.displayName })} onClick={() => setDraft(previous => { const next = new Map(previous); next.delete(object.key); return next; })}>{t('ux_remove_selection')}</Button>
            </Box>)}
            {!draft.size && <Typography variant="body2">{t('ux_no_selection')}</Typography>}
          </Box>
        </Collapse>
      </DialogContent>
      <DialogActions>
        <Button disabled={blocked} onClick={close}>{t("cancel")}</Button>
        <Button variant="contained" disabled={blocked || draft.size === 0}
          onClick={confirm}>{submitting ? t("adding") : t("add")}</Button>
      </DialogActions>
    </Dialog>
  );
}
