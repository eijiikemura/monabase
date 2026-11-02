// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { createTheme, type ThemeOptions } from '@mui/material/styles';

// Shared compact controls retain the application's dense workspace layout.
const workspaceControls: ThemeOptions = {
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: 'none', borderRadius: 4 }, sizeSmall: { minHeight: 24, padding: '2px 8px', fontSize: '0.8125rem' } } },
    MuiIconButton: { styleOverrides: { sizeSmall: { minWidth: 24, minHeight: 24 }, root: { '&.Mui-focusVisible': { outline: '2px solid currentColor', outlineOffset: 2 } } } },
    MuiButtonBase: { styleOverrides: { root: { '&.Mui-focusVisible': { outline: '2px solid currentColor', outlineOffset: -2 } } } },
    MuiTooltip: { defaultProps: { enterDelay: 400, arrow: true } },
    MuiDialogTitle: { styleOverrides: { root: { padding: '12px 20px', fontSize: '1rem', fontWeight: 600 } } },
    MuiDialogActions: { styleOverrides: { root: { padding: '8px 20px', gap: 4 } } },
    MuiCssBaseline: { styleOverrides: {
      '@media (prefers-reduced-motion: reduce)': {
        '*, *::before, *::after': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' },
        // Keep essential busy feedback visible; remove arc pulsing and slow the remaining motion.
        '.MuiCircularProgress-root.MuiCircularProgress-indeterminate': { animationDuration: '2s !important' },
        '.MuiCircularProgress-circleIndeterminate': { animation: 'none !important' },
        '.MuiLinearProgress-bar1Indeterminate, .MuiLinearProgress-bar2Indeterminate': { animationDuration: '3s !important' },
        '.MuiLinearProgress-bar2Indeterminate': { animationDelay: '1.5s !important' },
      }
    } }
  }
};

// 1. Mona style: mocha and brown tones.
export const monaTheme = createTheme({
  ...workspaceControls,
  palette: {
    primary: {
      main: '#6D4C41', // Primary brown.
      light: '#D7CCC8',
      dark: '#4E342E',
    },
    secondary: {
      main: '#8D6E63',
    },
    background: {
      default: '#EFEBE9', // Application background.
      paper: '#ffffff',   // Panel background.
    },
  },
  typography: {
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
  },
});

// 2. Simple style: blue and white tones for business applications.
export const simpleTheme = createTheme({
  ...workspaceControls,
  palette: {
    primary: {
      main: '#1976d2', // Standard blue.
      light: '#42a5f5',
      dark: '#1565c0',
    },
    secondary: {
      main: '#9c27b0',
    },
    background: {
      default: '#f0f2f5', // Simple gray background.
      paper: '#ffffff',
    },
  },
});

// 3. Dark style: black and gray tones.
export const darkTheme = createTheme({
  ...workspaceControls,
  palette: {
    mode: 'dark', // Automatically switch text and related colors to light tones.
    primary: {
      main: '#90caf9', // Slightly brighter blue for contrast against a dark background.
      light: '#e3f2fd',
      dark: '#42a5f5',
    },
    secondary: {
      main: '#ce93d8',
    },
    background: {
      default: '#121212', // Use dark gray instead of pure black for a softer background.
      paper: '#1e1e1e',   // Panel background, slightly lighter than the main background.
    },
  },
  typography: {
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
  },
});
