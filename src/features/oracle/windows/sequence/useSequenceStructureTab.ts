// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useSequenceSettings, type SequenceStructureProps } from '@/features/sequence/useSequenceSettings';
export type SequenceStructureTabProps = SequenceStructureProps;
export const useSequenceStructureTab = (props: SequenceStructureTabProps) => useSequenceSettings('oracle', props);
