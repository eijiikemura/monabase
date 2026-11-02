// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext } from 'react';

// Scoped to the mounted workspace, so late callbacks retain their original destination.
export const AiHistoryConnectionContext = createContext<string | undefined>(undefined);
export const useAiHistoryConnectionScope = () => useContext(AiHistoryConnectionContext);
