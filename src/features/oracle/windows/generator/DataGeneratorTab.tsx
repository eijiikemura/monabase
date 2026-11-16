// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import DataGeneratorPanel from '@/features/data-generator/DataGeneratorPanel';
import type { AiContext } from '@/shared/types/aiTypes';
import { useDataGenerator } from './useDataGenerator';

export default function DataGeneratorTab({ isActive, isAiEnabled = false, onOpenAiSidebar }: {
  isActive: boolean; isAiEnabled?: boolean; onOpenAiSidebar?: (context: AiContext | null) => void;
}) {
  const controller = useDataGenerator(isActive, isAiEnabled, onOpenAiSidebar);
  return <DataGeneratorPanel controller={controller} dbType="oracle" isActive={isActive} isAiEnabled={isAiEnabled} />;
}
