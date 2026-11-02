// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { TraceSimulator } from "@/shared/types/traceTypes";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Paper, Typography, IconButton, InputBase, Divider } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PetsIcon from '@mui/icons-material/Pets';
import CircleIcon from '@mui/icons-material/Circle';
import { useTranslation } from 'react-i18next';

export interface TraceDebugAreaProps {
  sourceText: string;
  simulator: TraceSimulator;
  monaStyle?: boolean;
  isDarkTheme: boolean;
  isActiveTab: boolean;
  onContextMenu: (e: React.MouseEvent<HTMLElement>, actualLineNum: number) => void;
  highlightLine: (line: string, isDark: boolean) => string;
  getActualLineNum?: (displayLine: number) => number | undefined;
  getDisplayLineNum?: (actualLine: number) => number | undefined;
}

const styles = {
  container: { position: 'relative' as const, flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const },
  searchPaper: { position: 'absolute' as const, top: 8, right: 24, zIndex: 10, display: 'flex', alignItems: 'center', p: '2px 4px', width: 300, border: '1px solid', borderColor: 'divider' },
  searchInput: { ml: 1, flex: 1, fontSize: '0.85rem' },
  searchCount: { color: 'text.secondary', mr: 1, whiteSpace: 'nowrap' },
  traceArea: { flexGrow: 1, overflow: 'auto' as const, color: 'text.primary', fontFamily: 'monospace', fontSize: '0.95rem', pt: 1, pb: 2 },
  traceLineBox: (isActiveLine: boolean, isCurrentMatch: boolean, isMatch: boolean) => ({ 
    display: 'flex', 
    width: 'fit-content',
    minWidth: '100%',
    bgcolor: isActiveLine ? 'action.selected' : (isCurrentMatch ? 'rgba(255, 152, 0, 0.35)' : (isMatch ? 'rgba(255, 152, 0, 0.12)' : 'transparent')), 
    '&:hover': { bgcolor: isActiveLine ? 'action.selected' : 'action.hover' } 
  }),
  traceLineNumBox: (isBreakpoint: boolean, isClickable: boolean) => ({ 
    width: 40, flexShrink: 0, textAlign: 'right' as const, pr: 1, 
    cursor: isClickable ? 'pointer' : 'default', userSelect: 'none' as const, 
    color: isBreakpoint ? 'error.main' : 'text.disabled', 
    borderRight: '1px solid', borderColor: 'divider', mr: 1, position: 'relative' as const 
  }),
  breakpointIcon: (hasCondition: boolean) => ({ position: 'absolute' as const, left: 3, top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: hasCondition ? '#ff9800' : 'error.main' }),
  traceLineContent: { whiteSpace: 'pre' as const, overflowWrap: 'normal' as const }
};

export const TraceDebugArea: React.FC<TraceDebugAreaProps> = (props) => {
  const { t } = useTranslation();
  const { getDisplayLineNum } = props;
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const highlightedLines = useMemo(() => {
    return (props.sourceText || '').split('\n').map(
      line => props.highlightLine(line, props.isDarkTheme)
    );
  }, [props]);

  const matchedLines = useMemo(() => {
    if (!searchQuery || !props.sourceText) return [];
    const query = searchQuery.toLowerCase();
    const matches: number[] = [];
    props.sourceText.split('\n').forEach((line, idx) => {
      if (line.toLowerCase().includes(query)) {
        matches.push(idx + 1);
      }
    });
    return matches;
  }, [props.sourceText, searchQuery]);

  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchOpen]);

  useEffect(() => {
    if (matchedLines.length > 0) {
      setCurrentMatchIndex(0);
    } else {
      setCurrentMatchIndex(-1);
    }
  }, [matchedLines]);

  useEffect(() => {
    if (currentMatchIndex >= 0 && currentMatchIndex < matchedLines.length && props.isActiveTab) {
      const lineNum = matchedLines[currentMatchIndex];
      const el = document.getElementById(`trace-line-${lineNum}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentMatchIndex, matchedLines, props.isActiveTab]);

  useEffect(() => {
    if (props.simulator.activeLine && props.isActiveTab) {
      const displayLine = getDisplayLineNum ? getDisplayLineNum(props.simulator.activeLine) : props.simulator.activeLine;
      if (displayLine) {
        document.getElementById(`trace-line-${displayLine}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [props.simulator.activeLine, props.isActiveTab, getDisplayLineNum]);

  const handleSearchNext = useEventCallback((reverse: boolean = false) => {
    if (matchedLines.length === 0) return;
    setCurrentMatchIndex(prev => {
      if (reverse) {
        return prev <= 0 ? matchedLines.length - 1 : prev - 1;
      } else {
        return prev >= matchedLines.length - 1 ? 0 : prev + 1;
      }
    });
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!props.isActiveTab) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
      if (e.key === 'Escape' && isSearchOpen) {
        setIsSearchOpen(false);
        setSearchQuery('');
      }
      if (e.key === 'F3' && isSearchOpen) {
        e.preventDefault();
        handleSearchNext(e.shiftKey);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [props.isActiveTab, isSearchOpen, matchedLines.length, handleSearchNext]);

  return (
    <Box sx={styles.container}>
      {isSearchOpen && (
        <Paper sx={styles.searchPaper} elevation={3}>
          <InputBase
            sx={styles.searchInput}
            placeholder={t("search_enter_for_next")}
            inputRef={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearchNext(e.shiftKey);
            }}
          />
          <Typography variant="caption" sx={styles.searchCount}>
            {matchedLines.length > 0 ? `${currentMatchIndex + 1} / ${matchedLines.length}` : '0 / 0'}
          </Typography>
          <Divider sx={{ height: 28, m: 0.5 }} orientation="vertical" />
          <IconButton type="button" sx={{ p: '5px' }} size="small" onClick={() => { setIsSearchOpen(false); setSearchQuery(''); }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Paper>
      )}
      
      <Box sx={styles.traceArea}>
        {highlightedLines.map((highlightedLine, idx) => {
          const displayLineNum = idx + 1; 
          const actualLineNum = props.getActualLineNum ? props.getActualLineNum(displayLineNum) : displayLineNum;
          const isActiveLine = props.simulator.activeLine !== null && (getDisplayLineNum
            ? getDisplayLineNum(props.simulator.activeLine) === displayLineNum
            : props.simulator.activeLine === displayLineNum);
            
          const isBreakpoint = actualLineNum ? props.simulator.breakpoints.includes(actualLineNum) : false;
          const isMatch = matchedLines.includes(displayLineNum);
          const isCurrentMatch = matchedLines[currentMatchIndex] === displayLineNum;
          const isClickable = !!actualLineNum;

          return (
            <Box key={idx} id={`trace-line-${displayLineNum}`} sx={styles.traceLineBox(isActiveLine, isCurrentMatch, isMatch)}>
              <Box 
                onClick={() => { if (actualLineNum) props.simulator.toggleBreakpoint(actualLineNum); }} 
                onContextMenu={(e) => { if (actualLineNum) props.onContextMenu(e, actualLineNum); }} 
                sx={styles.traceLineNumBox(isBreakpoint, isClickable)}
              >
                {isBreakpoint && actualLineNum && (
                  props.monaStyle 
                    ? <PetsIcon sx={styles.breakpointIcon(props.simulator.breakpointConditions[actualLineNum] !== undefined)} />
                    : <CircleIcon sx={styles.breakpointIcon(props.simulator.breakpointConditions[actualLineNum] !== undefined)} />
                )}
                {displayLineNum}
              </Box>
              <Box 
                sx={styles.traceLineContent} 
                dangerouslySetInnerHTML={{ __html: highlightedLine }}
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
