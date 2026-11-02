// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { argumentMode, hasArgumentDefault, type ArgumentModes } from '@/features/stored/routineArguments';
import type { GroupedVariables, ReturnValue, TraceSimulator } from "@/shared/types/traceTypes";

import type { ArgInfo } from './storedCommon';
import React, { useState, useEffect, useRef } from 'react';
import { Box, Paper, Typography, IconButton, Tooltip, Tabs, Tab, Popover, FormControl, RadioGroup, FormControlLabel, Radio, TextField, Button, Select, MenuItem, InputAdornment } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';
import { TreeView } from '@mui/x-tree-view/TreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';

import { formatDateString, DEFAULT_DATETIME_FORMAT, DEFAULT_DATE_FORMAT, formatDbmsOutputLog } from "@/shared/utils/dateFormatter";

// ============================================================================
// Group collection variable elements by index.
// ============================================================================
const parseCollectionGroups = (val: GroupedVariables[string]) => {
  const groups: Record<string, Record<string, string>> = {};
  if (!val || typeof val !== 'object') return groups;
  
  Object.keys(val).forEach(k => {
    const m = k.match(/^\(([^)]+)\)\.?(.*)$/);
    if (m) {
      const idx = m[1];
      const prop = m[2] || 'VALUE';
      if (!groups[idx]) groups[idx] = {};
      groups[idx][prop] = val[k];
    } else {
      if (!groups['']) groups[''] = {};
      groups[''][k] = val[k];
    }
  });
  return groups;
};

// ============================================================================
// 1. Bottom panel for results and console output.
// ============================================================================
interface BottomPanelProps {
  bottomTab: number; setBottomTab: (val: number) => void; returnValues: ReturnValue[]; displayOutputs: string[]; handleClearLogs: () => void; handleConsoleClick: (lineText: string) => void;
}

export function SharedBottomPanel({ bottomTab, setBottomTab, returnValues, displayOutputs, handleClearLogs, handleConsoleClick }: BottomPanelProps) {
  const { t } = useTranslation(); 
  const safeOutputs = (displayOutputs || []).filter(line => line && !line.startsWith('[TRACE '));
  
  return (
    <Paper elevation={1} sx={{ flexGrow: 1, flexShrink: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.paper' }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', justifyContent: 'space-between', pr: 1 }}>
        <Tabs value={bottomTab} onChange={(_e, val) => setBottomTab(val)} sx={{ minHeight: 36 }}>
          <Tab label={t("result_return_out")} sx={{ minHeight: 36, py: 0, fontSize: '0.85rem' }} />
          <Tab label={t("console")} sx={{ minHeight: 36, py: 0, fontSize: '0.85rem' }} />
        </Tabs>
        {bottomTab === 1 && (<Tooltip title={t("clear_log")}><IconButton color="error" size="small" onClick={handleClearLogs} sx={{ mt: 0.5 }}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>)}
      </Box>
      <Box sx={{ flexGrow: 1, display: bottomTab === 0 ? 'block' : 'none', overflowY: 'auto', p: 2, bgcolor: 'background.paper' }}>
        {returnValues.length === 0 ? (<Typography variant="body2" color="text.secondary">{t("execution_results_will_be_displayed_here")}</Typography>) : (
          returnValues.map((ret, idx) => (
            <Box key={idx} sx={{ mb: 1, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="primary" fontWeight="bold">{ret.name || 'RETURN_VALUE'}</Typography>
              <Typography variant="body1" sx={{ mt: 0.5, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                {typeof ret.value === 'object' && ret.value !== null ? JSON.stringify(ret.value, null, 2) : String(ret.value ?? '')}
              </Typography>
            </Box>
          ))
        )}
      </Box>
      <Box sx={{ flexGrow: 1, display: bottomTab === 1 ? 'flex' : 'none', flexDirection: 'column', bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 1, color: 'text.primary', fontFamily: 'monospace', fontSize: '0.9rem' }}>
          {safeOutputs.length === 0 ? (<Typography variant="body2" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>{t("no_output")}</Typography>) : (
            safeOutputs.map((line, idx) => {
              const isError = line.startsWith('[ERROR]');
              return (
                <Box 
                  key={idx} 
                  onClick={() => isError && handleConsoleClick(line)} 
                  sx={{ 
                    whiteSpace: 'pre-wrap', 
                    marginBottom: '2px', 
                    color: isError ? 'error.main' : 'inherit', 
                    cursor: isError ? 'pointer' : 'text', 
                    '&:hover': isError ? { textDecoration: 'underline' } : {} 
                  }}
                >
                  {line}
                </Box>
              );
            })
          )}
        </Box>
      </Box>
    </Paper>
  );
}

// ============================================================================
// 2. Context menu for breakpoint conditions.
// ============================================================================
interface BreakpointPopoverProps { anchorEl: HTMLElement | null; menuLineNum: number | null; simulator: TraceSimulator; onClose: () => void; }

export function BreakpointConditionPopover({ anchorEl, menuLineNum, simulator, onClose }: BreakpointPopoverProps) {
  const { t } = useTranslation(); 
  const [conditionType, setConditionType] = useState<'hit_count' | 'variable'>('hit_count');
  const [conditionCount, setConditionCount] = useState<string>('');
  const [conditionVarName, setConditionVarName] = useState<string>('');
  const [conditionOperator, setConditionOperator] = useState<string>('=='); 
  const [conditionExpectedValue, setConditionExpectedValue] = useState<string>('');

  useEffect(() => {
    if (menuLineNum !== null) {
      const cond = simulator.breakpointConditions[menuLineNum];
      if (cond) {
        setConditionType(cond.type);
        if (cond.type === 'hit_count') { 
          setConditionCount(String(cond.count)); 
          setConditionVarName(''); 
          setConditionOperator('==');
          setConditionExpectedValue(''); 
        } else { 
          setConditionCount(''); 
          setConditionVarName(cond.varName ?? ''); 
          setConditionOperator(cond.operator || '==');
          setConditionExpectedValue(cond.expectedValue ?? ''); 
        }
      } else { 
        setConditionType('hit_count'); 
        setConditionCount(''); 
        setConditionVarName(''); 
        setConditionOperator('==');
        setConditionExpectedValue(''); 
      }
    }
  }, [menuLineNum, simulator.breakpointConditions, anchorEl]);

  const handleSaveCondition = () => {
    if (menuLineNum !== null) {
      if (conditionType === 'hit_count') { 
        const val = parseInt(conditionCount, 10); 
        simulator.setBreakpointCondition(menuLineNum, !isNaN(val) && val > 0 ? { type: 'hit_count', count: val } : null); 
      } else { 
        simulator.setBreakpointCondition(
          menuLineNum, 
          conditionVarName.trim() !== '' 
            ? { type: 'variable', varName: conditionVarName.trim(), operator: conditionOperator, expectedValue: conditionExpectedValue } 
            : null
        ); 
      }
    }
    onClose();
  };

  return (
    <Popover open={Boolean(anchorEl)} anchorEl={anchorEl} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}>
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 280, bgcolor: 'background.paper' }}>
        <Typography variant="subtitle2" fontWeight="bold">{t("breakpoint_conditions")}</Typography>
        <FormControl component="fieldset">
          <RadioGroup row value={conditionType} onChange={(e) => setConditionType(e.target.value as 'hit_count' | 'variable')}>
            <FormControlLabel value="hit_count" control={<Radio size="small" />} label={<Typography variant="body2">{t("hit_count")}</Typography>} />
            <FormControlLabel value="variable" control={<Radio size="small" />} label={<Typography variant="body2">{t("variable_value")}</Typography>} />
          </RadioGroup>
        </FormControl>
        
        {conditionType === 'hit_count' ? (
          <TextField size="small" label={t("stop_count")} type="number" value={conditionCount} onChange={(e) => setConditionCount(e.target.value)} />
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField size="small" label={t("variable_name")} value={conditionVarName} onChange={(e) => setConditionVarName(e.target.value)} sx={{ flex: 1 }} />
            
            <Select 
              size="small" 
              value={conditionOperator} 
              onChange={(e) => setConditionOperator(e.target.value as string)} 
              sx={{ width: 75 }}
            >
              <MenuItem value="==">==</MenuItem>
              <MenuItem value="!=">!=</MenuItem>
              <MenuItem value=">">&gt;</MenuItem>
              <MenuItem value="<">&lt;</MenuItem>
              <MenuItem value=">=">&gt;=</MenuItem>
              <MenuItem value="<=">&lt;=</MenuItem>
            </Select>

            <TextField size="small" label={t("compare_value")} value={conditionExpectedValue} onChange={(e) => setConditionExpectedValue(e.target.value)} sx={{ flex: 1 }} />
          </Box>
        )}
        
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
          <Button size="small" color="error" onClick={() => { simulator.setBreakpointCondition(menuLineNum!, null); onClose(); }}>{t("clear")}</Button>
          <Button size="small" variant="contained" onClick={handleSaveCondition}>{t("save")}</Button>
        </Box>
      </Box>
    </Popover>
  );
}

// ============================================================================
// 3. Right panel for arguments, trace variables, and conditions.
// ============================================================================
interface SharedRightPanelProps {
  argumentModes?: ArgumentModes; setArgumentModes?: React.Dispatch<React.SetStateAction<ArgumentModes>>;
  mainTab: number; traceRightTab: number; setTraceRightTab: (val: number) => void; setIsRightPanelOpen: (val: boolean) => void;
  argumentsList: ArgInfo[]; argValues: { [key: string]: string }; setArgValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  traceDateTime: string | null; traceArguments: Record<string, string | number | null>;
  traceConditions?: { [key: string]: string }; 
  simulator: TraceSimulator; groupedVariables: GroupedVariables;
  outputDateFormat?: string; 
  inputDateFormat?: string;
}

export function SharedRightPanel({
  argumentModes, setArgumentModes, mainTab, traceRightTab, setTraceRightTab, setIsRightPanelOpen, argumentsList, argValues, setArgValues, traceDateTime, traceArguments, traceConditions, simulator, groupedVariables,
  outputDateFormat = DEFAULT_DATETIME_FORMAT,
  inputDateFormat = DEFAULT_DATE_FORMAT
}: SharedRightPanelProps) {
  const { t } = useTranslation(); 
  
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  // Variable filter state.
  const [variableFilter, setVariableFilter] = useState<string>('');
  
  const prevGroupedVariablesRef = useRef<GroupedVariables>({});
  const prevStepIndexRef = useRef<number>(-1);

  useEffect(() => {
    const prevVars = prevGroupedVariablesRef.current;
    const prevStep = prevStepIndexRef.current;
    const curStep = simulator.currentStepIndex;
    
    if (curStep === -1) {
       setExpandedItems([]);
    } else if (prevStep !== -1 && curStep > prevStep) {
       if (curStep - prevStep === 1) {
          
          setExpandedItems(prev => {
            const nextSet = new Set(prev);
            Object.keys(groupedVariables).forEach(key => {
              const curVal = groupedVariables[key];
              const prevVal = prevVars[key];
              const isComplex = typeof curVal === 'object' && curVal !== null;
              const prevIsComplex = typeof prevVal === 'object' && prevVal !== null;
              
              let isChanged = false;
              if (isComplex && prevIsComplex) {
                isChanged = JSON.stringify(curVal) !== JSON.stringify(prevVal);
              } else if (!isComplex && !prevIsComplex) {
                isChanged = curVal !== prevVal;
              } else {
                isChanged = true;
              }
              
              if (isChanged && isComplex) {
                nextSet.add(key); 
                
                const curGroups = parseCollectionGroups(curVal);
                const prevGroups = parseCollectionGroups(prevVal || {});
                
                Object.keys(curGroups).forEach(idx => {
                  if (idx !== '' && JSON.stringify(curGroups[idx]) !== JSON.stringify(prevGroups[idx])) {
                    nextSet.add(`${key}__${idx}`);
                  }
                });
              }
            });

            return Array.from(nextSet);
          });
       } else {
          setExpandedItems(prev => {
            const nextSet = new Set(prev);
            Object.keys(groupedVariables).forEach(key => {
              const isComplex = typeof groupedVariables[key] === 'object' && groupedVariables[key] !== null;
              if (isComplex) {
                nextSet.delete(key);
                const curGroups = parseCollectionGroups(groupedVariables[key]);
                Object.keys(curGroups).forEach(idx => {
                  if (idx !== '') nextSet.delete(`${key}__${idx}`);
                });
              }
            });
            return Array.from(nextSet);
          });
       }
    }
    
    prevGroupedVariablesRef.current = groupedVariables;
    prevStepIndexRef.current = curStep;
  }, [groupedVariables, simulator.currentStepIndex]);

  const formatDateTime = (val: unknown, targetFormat: string) => {
    if (!val) return '';
    const safeVal = (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) ? val + 'T00:00:00' : val;
    const dateToParse = typeof safeVal === 'string' ? safeVal.replace(/\//g, '-') : safeVal;
    const d = new Date(dateToParse instanceof Date ? dateToParse : typeof dateToParse === 'number' ? dateToParse : String(dateToParse));
    
    if (!isNaN(d.getTime())) {
      return formatDateString(d, targetFormat);
    }
    return String(val);
  };

  const formattedTraceDateTime = React.useMemo(() => {
    if (!traceDateTime) return null;
    return formatDateTime(traceDateTime, outputDateFormat);
  }, [traceDateTime, outputDateFormat]);

  const argRows = Object.keys(traceArguments).map((key, index) => {
    let val = traceArguments[key];
    if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
    if (typeof val === 'string') val = formatDbmsOutputLog(val, outputDateFormat);
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) val = formatDateTime(val, outputDateFormat);
    return { id: index, name: key, value: val };
  });
  const argColumns: GridColDef[] = [ { field: 'name', headerName: t("argument_name"), flex: 1, sortable: false }, { field: 'value', headerName: t("value"), flex: 2, sortable: false } ];

  const condRows = traceConditions ? Object.keys(traceConditions).map((key, index) => {
    return { id: index, name: key, value: traceConditions[key] };
  }) : [];
  const condColumns: GridColDef[] = [ { field: 'name', headerName: t("target"), flex: 1, sortable: false }, { field: 'value', headerName: t("condition_expression"), flex: 2, sortable: false } ];
  
  const inputArgs = argumentsList.filter(a => a.POSITION > 0 && a.IN_OUT !== 'OUT');

  return (
    <Paper elevation={1} sx={{ flexGrow: 1, flexShrink: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.paper' }}>
      <Box sx={{ p: 0, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Tooltip title={t("close")}><IconButton size="small" onClick={() => setIsRightPanelOpen(false)} sx={{ mx: 0.5 }}><ChevronRightIcon fontSize="small" /></IconButton></Tooltip>
            {mainTab === 0 ? ( <Typography variant="subtitle2" fontWeight="bold" sx={{ px: 1 }}>{t("arguments")}</Typography> ) : (
              <Tabs value={traceRightTab} onChange={(_e, val) => setTraceRightTab(val)} sx={{ minHeight: 36 }}>
                <Tab label={<Tooltip title={t("check_variable_values_per_step")}><span>{t("variable")}</span></Tooltip>} sx={{ minHeight: 36, py: 0, fontSize: '0.85rem' }} />
                <Tab label={<Tooltip title={t("check_execution_arguments")}><span>{t("arguments")}</span></Tooltip>} sx={{ minHeight: 36, py: 0, fontSize: '0.85rem' }} />
                {traceConditions !== undefined && (
                  <Tab label={<Tooltip title={t("check_execution_conditions")}><span>{t("condition")}</span></Tooltip>} sx={{ minHeight: 36, py: 0, fontSize: '0.85rem' }} />
                )}
              </Tabs>
            )}
          </Box>
          {mainTab === 1 && formattedTraceDateTime && (
            <Typography variant="caption" color="text.secondary" sx={{ mr: 2 }}>{t("analyzed", { time: formattedTraceDateTime })}</Typography>
          )}
        </Box>
      </Box>
      
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', p: 2, bgcolor: mainTab === 1 ? 'action.hover' : 'background.paper' }}>
        {mainTab === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {inputArgs.length === 0 ? <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 2 }}>{t("no_arguments_2")}</Typography>
            : inputArgs.map((arg, idx) => {
              const mode = argumentModes ? argumentMode(arg, argumentModes, argValues) : 'value';
              const isDateTime = arg.DATA_TYPE.includes('DATE') || arg.DATA_TYPE.includes('TIMESTAMP');
              return (
              <Box key={idx} sx={{ mb: 2 }}>
                <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>{arg.ARGUMENT_NAME} <span style={{ fontWeight: 'normal' }}>({arg.IN_OUT} / {arg.DATA_TYPE})</span></Typography>
                
                {argumentModes && setArgumentModes && hasArgumentDefault(arg) && <Select size="small" fullWidth value={mode === 'default' ? 'default' : 'value'} aria-label={t('routine_argument_mode', { name: arg.ARGUMENT_NAME })}
                  onChange={event => setArgumentModes(previous => ({ ...previous, [arg.ARGUMENT_NAME]: event.target.value as 'value' | 'default' }))}>
                  <MenuItem value="value">{t('routine_argument_value')}</MenuItem>
                  {hasArgumentDefault(arg) && <MenuItem value="default">{t('routine_argument_default')}</MenuItem>}
                </Select>}
                <Box component="fieldset" disabled={mode === 'default'} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
                {isDateTime ? (
                  <Box sx={{ position: 'relative', display: 'flex', gap: 1, mt: 0.5, alignItems: 'center' }}>
                    <TextField 
                      size="small" fullWidth variant="outlined" type="text"
                      placeholder={t("e_g_2", { format: inputDateFormat })}
                      helperText={t('routine_blank_is_null')}
                      value={argValues[arg.ARGUMENT_NAME] || ''} 
                      onChange={(e) => setArgValues({ ...argValues, [arg.ARGUMENT_NAME]: e.target.value })} 
                    />
                    <Tooltip title={t("select_from_calendar")}>
                      <IconButton 
                        color="primary" 
                        onClick={(e) => {
                          const input = e.currentTarget.nextElementSibling as HTMLInputElement;
                          if (input && typeof input.showPicker === 'function') input.showPicker();
                          else if (input) input.focus();
                        }}
                      >
                        <CalendarTodayIcon />
                      </IconButton>
                    </Tooltip>
                    <input 
                      type={inputDateFormat.match(/H|h|m|s/) ? "datetime-local" : "date"}
                      step="1"
                      style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '1px', opacity: 0.01, padding: 0, border: 0, pointerEvents: 'none' }}
                      onChange={(e) => {
                        if (e.target.value) {
                          const formatted = formatDateTime(e.target.value, inputDateFormat);
                          setArgValues({ ...argValues, [arg.ARGUMENT_NAME]: formatted });
                          e.target.value = '';
                        }
                      }}
                    />
                  </Box>
                ) : (
                  <TextField 
                    size="small" fullWidth variant="outlined" type="text"
                    placeholder={t('routine_blank_is_null')}
                    value={argValues[arg.ARGUMENT_NAME] || ''} 
                    onChange={(e) => setArgValues({ ...argValues, [arg.ARGUMENT_NAME]: e.target.value })} 
                    sx={{ mt: 0.5 }} 
                  />
                )}
                </Box>
              </Box>
            )})}
          </Box>
        ) : (
          <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
            {traceRightTab === 1 ? (
              <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 200, width: '100%' }}>
                {Object.keys(traceArguments).length === 0 ? <Typography variant="body2" color="text.secondary" sx={{p: 2}}>{t("no_arguments")}</Typography> : <DataGrid rows={argRows} columns={argColumns} disableRowSelectionOnClick hideFooter sx={{ border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', flexGrow: 1 }} />}
              </Box>
            ) : traceRightTab === 2 && traceConditions !== undefined ? (
              <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 200, width: '100%' }}>
                {Object.keys(traceConditions).length === 0 ? <Typography variant="body2" color="text.secondary" sx={{p: 2}}>{t("no_condition")}</Typography> : <DataGrid rows={condRows} columns={condColumns} disableRowSelectionOnClick hideFooter sx={{ border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', flexGrow: 1 }} />}
              </Box>
            ) : (
              <>
                {simulator.executionSteps.length === 0 ? <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>{t("please_click_execute_trace")}</Typography>
                : <>
                    {/* Top toolbar including the search filter. */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                      <Typography variant="caption" color={simulator.isSimulating ? "primary.main" : "text.secondary"} fontWeight="bold">
                        {simulator.isSimulating ? `Step: ${simulator.currentStepIndex + 1} / ${simulator.executionSteps.length}` : t("pending")}
                      </Typography>
                      <TextField
                        variant="outlined"
                        size="small"
                        placeholder={t("search_by_var_name")}
                        value={variableFilter}
                        onChange={(e) => setVariableFilter(e.target.value)}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start" sx={{ mr: 0.5 }}>
                              <SearchIcon sx={{ fontSize: 16 }} />
                            </InputAdornment>
                          ),
                          sx: { height: 28, fontSize: '0.8rem', bgcolor: 'background.paper' }
                        }}
                        sx={{ width: 160 }}
                      />
                    </Box>
                    
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {Object.keys(groupedVariables)
                        .filter(key => !variableFilter || key.toLowerCase().includes(variableFilter.toLowerCase()))
                        .map((key) => {
                        let val = groupedVariables[key]; 
                        const isComplex = typeof val === 'object' && val !== null;
                        
                        if (!isComplex && typeof val === 'string') {
                          val = formatDbmsOutputLog(val, outputDateFormat);
                        }

                        if (!isComplex) {
                          return (
                            <Box key={key} id={`var-item-${key}`} sx={{ display: 'flex', px: 2, py: 1, minHeight: 32, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', alignItems: 'flex-start' }}>
                              <Typography variant="caption" fontWeight="bold" color="primary.main" sx={{ width: '40%', flexShrink: 0, pr: 1, wordBreak: 'break-all' }}>{key}</Typography>
                              <Typography variant="body2" sx={{ width: '60%', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{String(val)}</Typography>
                            </Box>
                          );
                        }

                        const groups = parseCollectionGroups(val);
                        const isCollection = Object.keys(groups).some(idx => idx !== '');

                        let treeChildren: React.ReactNode[] = [];

                        if (isCollection) {
                          const mainChildren = Object.keys(groups).sort().map(idx => {
                            if (idx === '') return null;
                            
                            const props = Object.entries(groups[idx]);
                            if (props.length === 1 && props[0][0] === 'VALUE') {
                               return (
                                 <TreeItem 
                                   key={`${key}__${idx}`} 
                                   nodeId={`${key}__${idx}`} 
                                   label={
                                     <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                       <Typography variant="caption" fontWeight="bold" color="text.secondary">[{idx}]</Typography>
                                       <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{String(props[0][1])}</Typography>
                                     </Box>
                                   } 
                                 />
                               );
                            }

                            return (
                              <TreeItem key={`${key}__${idx}`} nodeId={`${key}__${idx}`} label={<Typography variant="caption" fontWeight="bold">[{idx}]</Typography>}>
                                {props.map(([prop, v]) => (
                                  <TreeItem key={`${key}__${idx}__${prop}`} nodeId={`${key}__${idx}__${prop}`} label={
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                      <Typography variant="caption" color="text.secondary">{prop}:</Typography>
                                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{String(v)}</Typography>
                                    </Box>
                                  } />
                                ))}
                              </TreeItem>
                            );
                          }).filter(Boolean);

                          treeChildren.push(...mainChildren);

                          if (groups['']) {
                            const baseChildren = Object.entries(groups['']).map(([prop, v]) => (
                               <TreeItem key={`${key}__base__${prop}`} nodeId={`${key}__base__${prop}`} label={
                                 <Box sx={{ display: 'flex', gap: 1 }}>
                                   <Typography variant="caption" color="text.secondary">{prop}:</Typography>
                                   <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{String(v)}</Typography>
                                 </Box>
                               } />
                            ));
                            treeChildren.push(...baseChildren);
                          }
                        } else {
                          treeChildren = Object.entries(val).map(([prop, v]) => (
                            <TreeItem key={`${key}__${prop}`} nodeId={`${key}__${prop}`} label={
                               <Box sx={{ display: 'flex', gap: 1 }}>
                                 <Typography variant="caption" color="text.secondary">{prop}:</Typography>
                                 <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{String(v)}</Typography>
                               </Box>
                            } />
                          ));
                        }

                        const localExpanded = expandedItems.filter(id => id === key || id.startsWith(`${key}__`));

                        return (
                          <Box key={key} id={`var-item-${key}`} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', overflow: 'hidden' }}>
                            <TreeView
                              expanded={localExpanded}
                              onNodeToggle={(_event, nodeIds) => {
                                 setExpandedItems(prev => {
                                    const others = prev.filter(id => id !== key && !id.startsWith(`${key}__`));
                                    return [...others, ...nodeIds];
                                 });
                              }}
                              defaultCollapseIcon={<ExpandMoreIcon />}
                              defaultExpandIcon={<ChevronRightIcon />}
                              sx={{ '& .MuiTreeItem-content': { py: 0.5, px: 1, minHeight: 32 } }}
                            >
                              <TreeItem nodeId={key} label={<Typography variant="caption" fontWeight="bold" color="primary.main">{key}</Typography>}>
                                {treeChildren}
                              </TreeItem>
                            </TreeView>
                          </Box>
                        );
                      })}
                    </Box>
                  </>
                }
              </>
            )}
          </Box>
        )}
      </Box>
    </Paper>
  );
}