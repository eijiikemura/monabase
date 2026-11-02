// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import DiffLayoutControls, { useDiffLayout } from '@/components/data/DiffLayoutControls';
import GitHistoryPagination from '@/features/git/GitHistoryPagination';
import GitWorkspaceDialog from './GitWorkspaceDialog';
import GitRevisionCompareDialog from './GitRevisionCompareDialog';

import React, { memo, useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, Paper, Typography, Button, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Tabs, Tab, CircularProgress, Backdrop, InputAdornment
} from '@mui/material';
import { useTheme } from '@mui/material/styles'; 
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import CodeMirror from '@uiw/react-codemirror';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import Prism from 'prismjs';
import 'prismjs/components/prism-sql';
import 'prismjs/themes/prism.css';

import { useVersionControlTab, type VersionControlTabProps } from './useVersionControlTab';

// Reuse settings to avoid editor renders when only Git metadata changes.
const SOURCE_SETUP = { lineNumbers: true, searchKeymap: true };
const MemoCodeMirror = memo(CodeMirror);
const SOURCE_HOST_STYLE = {
  position: 'absolute' as const,
  inset: 0,
  height: '100%',
  width: '100%'
};

const styles = {
  loadingOverlay: {
    position: 'absolute' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    bgcolor: 'transparent',
    zIndex: 10
  }
};

export default function VersionControlTab(props: VersionControlTabProps) {
  const logic = useVersionControlTab(props);
  const { splitView, setLayout } = useDiffLayout();
  const [workspaceOpen, setWorkspaceOpen] = useState(false), [compareOpen, setCompareOpen] = useState(false);
  const { t, isSourceLoading } = logic;
  const theme = useTheme(); 

  // ==========================================
  // Independent search state and handlers.
  // ==========================================
  const [leftShowSearch, setLeftShowSearch] = useState(false);
  const [rightShowSearch, setRightShowSearch] = useState(false);
  const [leftSearchText, setLeftSearchText] = useState('');
  const [rightSearchText, setRightSearchText] = useState('');
  const [leftMatchIndex, setLeftMatchIndex] = useState(0);
  const [leftTotalMatches, setLeftTotalMatches] = useState(0);
  const [rightMatchIndex, setRightMatchIndex] = useState(0);
  const [rightTotalMatches, setRightTotalMatches] = useState(0);
  
  const leftSearchInputRef = useRef<HTMLInputElement>(null);
  const rightSearchInputRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  
  const activePaneRef = useRef<'left' | 'right'>('left');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (logic.activeSubTab === 1 && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault(); 
        
        if (activePaneRef.current === 'left') {
          setLeftShowSearch(true);
          setTimeout(() => {
            if (leftSearchInputRef.current) {
              leftSearchInputRef.current.focus();
              leftSearchInputRef.current.select();
            }
          }, 100);
        } else {
          setRightShowSearch(true);
          setTimeout(() => {
            if (rightSearchInputRef.current) {
              rightSearchInputRef.current.focus();
              rightSearchInputRef.current.select();
            }
          }, 100);
        }
      }
      if (e.key === 'Escape') {
        setLeftShowSearch(false);
        setRightShowSearch(false);
        setLeftSearchText('');
        setRightSearchText('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [logic.activeSubTab]);

  const highlightSyntax = useCallback((str: string): React.ReactElement => {
    if (!str) return <span />; 
    
    let htmlContent = Prism.highlight(str, Prism.languages.sql, 'sql');

    const addHighlight = (text: string, className: string) => {
      if (!text) return;
      const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?![^<]*>)(${escaped})`, 'gi');
      htmlContent = htmlContent.replace(regex, `<mark class="${className}">$1</mark>`);
    };

    if (leftSearchText && leftSearchText === rightSearchText) {
      addHighlight(leftSearchText, 'search-mark-both');
    } else {
      if (leftSearchText) addHighlight(leftSearchText, 'search-mark-left');
      if (rightSearchText) addHighlight(rightSearchText, 'search-mark-right');
    }

    return (
      <span
        style={{ display: 'inline', fontFamily: 'monospace' }}
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    );
  }, [leftSearchText, rightSearchText]);

  const updateActiveMatch = useCallback((marks: readonly Element[], index: number) => {
    marks.forEach(m => m.classList.remove('search-mark-active'));
    const active = marks[index] as HTMLElement;
    if (active) {
      active.classList.add('search-mark-active');
      active.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const searchMarks = useCallback((side: 'left' | 'right') => {
    const marks = viewerRef.current?.querySelectorAll(`.search-mark-${side}, .search-mark-both`);
    return Array.from(marks || []).filter(mark => {
      const cell = mark.closest('td');
      if (splitView) return cell?.classList.contains(side);
      // Unified context lines have both line numbers; additions/removals have only one.
      return Boolean(cell?.closest('tr')?.cells[side === 'left' ? 0 : 1]?.textContent?.trim());
    });
  }, [splitView]);

  useEffect(() => {
    if (!leftShowSearch || !leftSearchText) {
      setLeftTotalMatches(0);
      setLeftMatchIndex(0);
      return;
    }
    const timer = setTimeout(() => {
      if (!viewerRef.current) return;
      const marks = searchMarks('left');
      setLeftTotalMatches(marks.length);
      if (marks.length > 0) {
        setLeftMatchIndex(1); 
        updateActiveMatch(marks, 0);
      } else {
        setLeftMatchIndex(0);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [leftSearchText, leftShowSearch, logic.pastSource, logic.fullSource, updateActiveMatch, searchMarks]);

  useEffect(() => {
    if (!rightShowSearch || !rightSearchText) {
      setRightTotalMatches(0);
      setRightMatchIndex(0);
      return;
    }
    const timer = setTimeout(() => {
      if (!viewerRef.current) return;
      const marks = searchMarks('right');
      setRightTotalMatches(marks.length);
      if (marks.length > 0) {
        setRightMatchIndex(1); 
        updateActiveMatch(marks, 0);
      } else {
        setRightMatchIndex(0);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [rightSearchText, rightShowSearch, logic.pastSource, logic.fullSource, updateActiveMatch, searchMarks]);

  const handleLeftSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (leftTotalMatches === 0 || !viewerRef.current) return;
      const direction = e.shiftKey ? -1 : 1;
      let nextIndex = leftMatchIndex - 1 + direction;
      if (nextIndex >= leftTotalMatches) nextIndex = 0;
      if (nextIndex < 0) nextIndex = leftTotalMatches - 1;
      setLeftMatchIndex(nextIndex + 1);
      const marks = searchMarks('left');
      updateActiveMatch(marks, nextIndex);
    } else if (e.key === 'Escape') {
      setLeftShowSearch(false);
      setLeftSearchText('');
    }
  };

  const handleRightSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (rightTotalMatches === 0 || !viewerRef.current) return;
      const direction = e.shiftKey ? -1 : 1;
      let nextIndex = rightMatchIndex - 1 + direction;
      if (nextIndex >= rightTotalMatches) nextIndex = 0;
      if (nextIndex < 0) nextIndex = rightTotalMatches - 1;
      setRightMatchIndex(nextIndex + 1);
      const marks = searchMarks('right');
      updateActiveMatch(marks, nextIndex);
    } else if (e.key === 'Escape') {
      setRightShowSearch(false);
      setRightSearchText('');
    }
  };
  // ==========================================

  const objectUnpushedCount = logic.historyList.filter(h => !h.isPushed && h.hasRemote).length;

  const historyColumns: GridColDef[] = [
    { field: 'id', headerName: t("commit_id"), width: 100 },
    { 
      field: 'date', 
      headerName: t("datetime"),
      width: 160,
      valueFormatter: (params) => {
        if (!params.value) return '';
        const date = new Date(params.value);
        return isNaN(date.getTime()) ? params.value : date.toLocaleString('ja-JP');
      }
    },
    { 
      field: 'status', 
      headerName: t("status_4"),
      width: 140,
      renderCell: (params) => {
        if (!params.row.hasRemote) {
          return <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>💻 {t("local")}</Typography>;
        }

        const isActuallyPushed = params.row.isPushed;

        if (isActuallyPushed) {
          return <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>☁️ {t("synced")}</Typography>;
        } else if (params.row.isMerge) {
          return <Typography variant="caption" color="warning.main" sx={{ display: 'flex', alignItems: 'center', height: '100%', fontWeight: 'bold' }}>🔄 {t("merged_push_required")}</Typography>;
        } else {
          return <Typography variant="caption" color="error.main" sx={{ display: 'flex', alignItems: 'center', height: '100%', fontWeight: 'bold' }}>⬆️ {t("unpushed_4")}</Typography>;
        }
      }
    },
    { field: 'message', headerName: t("commit_message"), flex: 1 },
  ];

  return (
    <Paper elevation={1} sx={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, px: 1 }}>
          <Tabs value={logic.activeSubTab} onChange={(_e, val) => logic.setActiveSubTab(val)} sx={{ minHeight: 32, flexGrow: 1 }}>
            <Tab label={t('current_source')} sx={{ minHeight: 32, py: 0, fontSize: '0.85rem' }} />
            <Tab label={t('version_history')} sx={{ minHeight: 32, py: 0, fontSize: '0.85rem' }} />
          </Tabs>
          <Button size="small" disabled={!logic.isLocalRepo || logic.isProcessing} onClick={() => setWorkspaceOpen(true)}>{t('git_schema_changes')}</Button>
          <Button size="small" disabled={!logic.isLocalRepo || logic.isProcessing} onClick={() => setCompareOpen(true)}>{t('git_compare_revisions')}</Button>
        </Box>
      </Box>

      {!logic.isLocalRepo && (
        <Box sx={{ p: 1.5, bgcolor: theme.palette.mode === 'dark' ? '#3e2723' : '#fff3e0', borderBottom: '1px solid', borderColor: theme.palette.mode === 'dark' ? '#4e342e' : '#ffe0b2', display: 'flex', alignItems: 'center' }}>
          <Typography variant="body2" color={theme.palette.mode === 'dark' ? '#ffcc80' : 'warning.dark'} sx={{ fontWeight: 'bold', flexGrow: 1 }}>
            {t("git_initialize_repository_help")}
          </Typography>
        </Box>
      )}

      {logic.activeSubTab === 0 && (
        <Box sx={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
          
          <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.default', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', minWidth: 0 }}>
              {logic.branchName && <Tooltip title={logic.repoPath}><Typography variant="caption" noWrap sx={{ maxWidth: 180 }}>{logic.branchName}</Typography></Tooltip>}
              <Tooltip title={!logic.isLocalRepo ? t("please_initialize_git_from_the_top_menu_first") : t("record_current_source")}>
                <span>
                  <Button 
                    variant="contained" 
                    color="primary" 
                    size="small" 
                    startIcon={<SaveIcon />} 
                    onClick={() => logic.setCommitDialogOpen(true)}
                    disabled={!logic.isLocalRepo || logic.isProcessing || isSourceLoading}
                    disableElevation
                  >
                    Git Commit
                  </Button>
                </span>
              </Tooltip>
              {objectUnpushedCount > 0 && logic.remoteUrl && (
                <Typography variant="caption" color="error.main" sx={{ fontWeight: 'bold', ml: 0.5 }}>
                  {t("git_history_page_unpushed", { count: objectUnpushedCount })}
                </Typography>
              )}
            </Box>
            
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Tooltip title={t("copy_source")}>
                <span>
                  <IconButton size="small" aria-label={t("copy_source")} onClick={logic.handleCopy} disabled={logic.isProcessing || isSourceLoading}>
                    <ContentCopyIcon fontSize="small" color="action" />
                  </IconButton>
                </span>
              </Tooltip>
              {props.onRefresh && (
                <Tooltip title={t("fetch_latest_source")}>
                  <span>
                    <IconButton aria-label={t("fetch_latest_source")} onClick={props.onRefresh} size="small" color="primary" disabled={logic.isProcessing || isSourceLoading}>
                      <RefreshIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
            </Box>
          </Box>
          
          <Box sx={{ flex: '1 1 0', minHeight: 0, minWidth: 0, overflow: 'hidden', position: 'relative', '& .cm-editor': { height: '100%', outline: 'none' }, '& .cm-scroller': { fontFamily: 'monospace', fontSize: '0.95rem' } }}>
            {/* Source loading indicator centered in the editor. */}
            {isSourceLoading && (
              <Box sx={styles.loadingOverlay}>
                <CircularProgress size={36} />
              </Box>
            )}
            <MemoCodeMirror
              value={logic.fullSource} 
              height="100%" 
              extensions={logic.codeMirrorExtensions} 
              readOnly={true} 
              basicSetup={SOURCE_SETUP}
              style={SOURCE_HOST_STYLE}
              theme={theme.palette.mode === 'dark' ? 'dark' : 'light'} 
            />
          </Box>
        </Box>
      )}

      {logic.activeSubTab === 1 && (
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.default' }}>
          
          <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', gap: 1, alignItems: 'center' }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Button 
                variant="outlined" 
                size="small" 
                onClick={logic.handleRestore}
                disabled={!logic.selectedHistory || logic.isProcessing || isSourceLoading}
              >
                {t("open_recovery_sql")}
              </Button>
            </Box>
            
            <Box sx={{ flexGrow: 1 }} />
            
            <Tooltip title={t("refresh_history_and_source")}>
              <span>
                <IconButton 
                  onClick={() => { 
                    if (props.onRefresh) props.onRefresh(); 
                  }} 
                  size="small" 
                  color="primary"
                  disabled={!logic.isLocalRepo || logic.isProcessing || isSourceLoading}
                >
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Box>

          <Paper elevation={0} sx={{ height: logic.diffHeight, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', m: 1, border: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ p: 0.5, px: 1.5, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="caption" fontWeight="bold" color="text.secondary">{t("diff_viewer")}</Typography>
              <DiffLayoutControls splitView={splitView} onChange={setLayout} />
              {!leftShowSearch && !rightShowSearch && (
                <Typography variant="caption" color="text.disabled">{t("click_the_side_you_want_to_search_then_press_ctrl_f")}</Typography>
              )}
            </Box>
            
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.paper' }}>
              {!logic.selectedHistory ? (
                <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography variant="body2" color="text.disabled">{t("select_a_version_from_the_history_below_to_view_differences_here")}</Typography>
                </Box>
              ) : (
                <>
                  <Box sx={{ display: 'flex', width: '100%', borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Box sx={{ flex: 1, minWidth: 0, p: 0.5, px: 1, borderRight: '1px solid', borderColor: 'divider', bgcolor: theme.palette.mode === 'dark' ? '#3e2723' : '#fff3e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 1 }}>{t("past_source", { id: logic.selectedHistory.id })}</Typography>
                      {leftShowSearch ? (
                        <TextField
                          inputRef={leftSearchInputRef}
                          size="small"
                          variant="outlined"
                          placeholder={t("search_left")}
                          value={leftSearchText}
                          onChange={(e) => setLeftSearchText(e.target.value)}
                          onKeyDown={handleLeftSearchKeyDown}
                          InputProps={{
                            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" sx={{ fontSize: 16 }} /></InputAdornment>,
                            endAdornment: (
                              <InputAdornment position="end">
                                {leftSearchText && (
                                  <Typography variant="caption" sx={{ mr: 0.5, color: 'text.secondary', whiteSpace: 'nowrap', fontSize: '0.7rem' }}>
                                    {leftTotalMatches > 0 ? `${leftMatchIndex}/${leftTotalMatches}` : '0/0'}
                                  </Typography>
                                )}
                                <IconButton size="small" onClick={() => { setLeftShowSearch(false); setLeftSearchText(''); }} sx={{ p: 0.25 }}>
                                  <CloseIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </InputAdornment>
                            ),
                            style: { fontSize: '0.75rem', height: 26, backgroundColor: theme.palette.background.paper }
                          }}
                          sx={{ width: 180, ml: 1 }}
                        />
                      ) : (
                        <Tooltip title={t("click_the_left_side_then_press_ctrl_f_to_search")}><IconButton size="small" onClick={() => { activePaneRef.current = 'left'; setLeftShowSearch(true); setTimeout(() => leftSearchInputRef.current?.focus(), 100); }} sx={{ p: 0.25 }}><SearchIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                      )}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, p: 0.5, px: 1, bgcolor: theme.palette.mode === 'dark' ? '#1b5e20' : '#e8f5e9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 1 }}>{t("current_source_latest_in_db")}</Typography>
                      {rightShowSearch ? (
                        <TextField
                          inputRef={rightSearchInputRef}
                          size="small"
                          variant="outlined"
                          placeholder={t("search_right")}
                          value={rightSearchText}
                          onChange={(e) => setRightSearchText(e.target.value)}
                          onKeyDown={handleRightSearchKeyDown}
                          InputProps={{
                            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" sx={{ fontSize: 16 }} /></InputAdornment>,
                            endAdornment: (
                              <InputAdornment position="end">
                                {rightSearchText && (
                                  <Typography variant="caption" sx={{ mr: 0.5, color: 'text.secondary', whiteSpace: 'nowrap', fontSize: '0.7rem' }}>
                                    {rightTotalMatches > 0 ? `${rightMatchIndex}/${rightTotalMatches}` : '0/0'}
                                  </Typography>
                                )}
                                <IconButton size="small" onClick={() => { setRightShowSearch(false); setRightSearchText(''); }} sx={{ p: 0.25 }}>
                                  <CloseIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </InputAdornment>
                            ),
                            style: { fontSize: '0.75rem', height: 26, backgroundColor: theme.palette.background.paper }
                          }}
                          sx={{ width: 180, ml: 1 }}
                        />
                      ) : (
                        <Tooltip title={t("click_the_right_side_then_press_ctrl_f_to_search")}><IconButton size="small" onClick={() => { activePaneRef.current = 'right'; setRightShowSearch(true); setTimeout(() => rightSearchInputRef.current?.focus(), 100); }} sx={{ p: 0.25 }}><SearchIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                      )}
                    </Box>
                  </Box>
                  
                  <Box 
                    ref={viewerRef}
                    onMouseMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      activePaneRef.current = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
                    }}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      activePaneRef.current = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
                    }}
                    sx={{ 
                      flexGrow: 1, 
                      overflow: 'auto', 
                      width: '100%', 
                      minHeight: 0,
                      '& [class*="-sticky-header"]': { display: 'none !important' },
                      '& [role="banner"]': { display: 'none !important' },
                      '& table': { 
                        tableLayout: 'fixed !important', 
                        width: '100% !important',
                        minWidth: 'auto !important'
                      },
                      '& pre': { 
                        whiteSpace: 'pre-wrap !important', 
                        overflowWrap: 'anywhere !important',
                        wordBreak: 'break-all !important'
                      },
                      '& .search-mark-left, & .search-mark-right, & .search-mark-both': { backgroundColor: '#ffeb3b', color: '#000', borderRadius: '2px', padding: '0 2px' },
                      ...(splitView ? {
                        '& td.left .search-mark-right, & td.right .search-mark-left': { background: 'transparent', color: 'inherit' }
                      } : {
                        '& tr:has(td:nth-of-type(1) pre:empty) .search-mark-left, & tr:has(td:nth-of-type(2) pre:empty) .search-mark-right': { background: 'transparent', color: 'inherit' }
                      }),

                      '& .search-mark-active': { backgroundColor: '#ff9800 !important', outline: '2px solid #e65100', color: '#fff !important' }
                    }}
                  >
                    <ReactDiffViewer 
                      leftTitle={`${t('git_compare_from')}: ${logic.selectedHistory?.id || ''}`}
                      rightTitle={t('current_source')}
                      oldValue={logic.pastSource} 
                      newValue={logic.fullSource} 
                      splitView={splitView}
                      compareMethod={DiffMethod.WORDS} 
                      showDiffOnly={false} 
                      useDarkTheme={theme.palette.mode === 'dark'}
                      renderContent={highlightSyntax}
                      styles={{
                        line: {
                          fontSize: '0.85rem',
                          fontFamily: 'monospace',
                        }
                      }}
                    />
                  </Box>
                </>
              )}
            </Box>
          </Paper>

          <Box 
            onMouseDown={() => logic.setIsResizing(true)} 
            sx={{ 
              height: 10, 
              cursor: 'row-resize', 
              bgcolor: logic.isResizing ? 'primary.main' : 'divider', 
              '&:hover': { bgcolor: 'primary.main' }, 
              transition: 'background-color 0.2s', 
              mx: 1,
              mb: 1,
              borderRadius: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }} 
          >
            <Box sx={{ width: 40, height: 3, bgcolor: 'background.paper', borderRadius: 1 }} />
          </Box>

          <Paper elevation={0} sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', mx: 1, mb: 1, border: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ p: 0.5, px: 1.5, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="caption" fontWeight="bold" color="text.secondary">{t("history_list")}</Typography>
              <GitHistoryPagination page={logic.historyPage} hasMore={logic.historyHasMore} loading={logic.historyLoading} onChange={page => { void logic.loadHistory(page); }} />
            </Box>
            
            <Box sx={{ flexGrow: 1, display: 'flex', bgcolor: 'background.paper', width: '100%', minHeight: 0 }}>
              {logic.historyList.length === 0 ? (
                <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography variant="body2" color="text.disabled">{t("no_past_history")}</Typography>
                </Box>
              ) : (
                <DataGrid 
                  rows={logic.historyList} 
                  columns={historyColumns} 
                  density="compact"
                  hideFooter
                  disableColumnMenu
                  onRowClick={logic.handleHistoryRowClick}
                  sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }} 
                />
              )}
            </Box>
          </Paper>

        </Box>
      )}

      {/* Backdrop for operations such as Git commits. */}
      <Backdrop
        sx={{
          color: theme.palette.mode === 'dark' ? '#fff' : '#000',
          backgroundColor: theme.palette.mode === 'dark' 
            ? 'rgba(0, 0, 0, 0.7)' 
            : 'rgba(255, 255, 255, 0.7)',
          zIndex: (theme) => theme.zIndex.drawer + 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 2
        }}
        open={logic.isProcessing}
      >
        <CircularProgress color="primary" />
        <Typography variant="h6" fontWeight="bold">
          {t("communicating_with_git_server")}
        </Typography>
      </Backdrop>

      <Dialog open={logic.commitDialogOpen} onClose={() => !logic.isProcessing && logic.setCommitDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t("execute_git_commit")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("save_current_source_on_database_to_a_file_and_record_as_history")}<br />
            {t("enter_details_so_it_s_easy_to_understand_when_looking_at_history_later")}
          </Typography>
          {['FUNCTION', 'PROCEDURE', 'TRIGGER', 'PACKAGE', 'PACKAGE BODY'].includes(props.objectType.toUpperCase()) && <Box sx={{ mb: 2 }}>
            <Button onClick={logic.handleUseAiSummary} disabled={logic.isProcessing || logic.isAiSummaryLoading}>{t('ai_use_change_summary')}</Button>
            <Typography variant="caption" display="block">{t('ai_summary_commit_hint')}</Typography>
          </Box>}
          <TextField
            autoFocus
            fullWidth
            multiline
            rows={3}
            variant="outlined"
            label={t("commit_message_optional")}
            placeholder={t("e_g_added_index_on_employee_id_for_performance")}
            value={logic.commitMessage}
            onChange={(e) => logic.setCommitMessage(e.target.value)}
            disabled={logic.isProcessing}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => logic.setCommitDialogOpen(false)} disabled={logic.isProcessing}>{t("cancel")}</Button>
          <Button onClick={logic.handleCommit} variant="contained" disabled={logic.isProcessing || logic.isAiSummaryLoading} disableElevation>
            {t("record")}
          </Button>
        </DialogActions>
      </Dialog>
      {workspaceOpen && <GitWorkspaceDialog key={`${props.dbType}:${props.schema}`} dbType={props.dbType?.toUpperCase().startsWith('POSTGRES') ? 'postgresql' : 'oracle'} schema={props.schema} onClose={() => setWorkspaceOpen(false)} />}
      {compareOpen && <GitRevisionCompareDialog object={{ dbType: props.dbType || 'ORACLE', schema: props.schema, objectType: props.objectType, objectName: props.objectName, signature: props.signature, tableName: props.tableName }} onClose={() => setCompareOpen(false)} />}
    </Paper>
  );
}
