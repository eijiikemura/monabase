// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Alert, Box } from '@mui/material';
import DataGeneratorPanel from '@/features/data-generator/DataGeneratorPanel';
import { useDataGenerator, type GeneratorProps } from './useDataGenerator';

export default function DataGeneratorTab(props: GeneratorProps) {
  const controller = useDataGenerator(props);
  return <Box data-testid="mysql-data-generator" sx={{ flex: 1, minHeight: 0, display: props.active ? 'flex' : 'none', flexDirection: 'column' }}>
    {controller.error && <Alert severity="error">{controller.error}</Alert>}
    <DataGeneratorPanel controller={controller} dbType="mysql" isActive={props.active} isAiEnabled={props.aiEnabled} readonly={props.readonly} />
  </Box>;
}
