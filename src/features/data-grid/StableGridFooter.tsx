// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext, type ReactNode } from 'react';
import { GridFooterContainer } from '@mui/x-data-grid';

// Update footer contents without replacing the slot component and its dialog state.
export const GridFooterContent = createContext<ReactNode>(null);

export function StableGridFooter() {
  return <GridFooterContainer>{useContext(GridFooterContent)}</GridFooterContainer>;
}
