// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useSequenceSource, type SequenceWindowProps } from '@/features/sequence/useSequenceSource';
export type { SequenceWindowProps };
export const useSequenceWindow = (props: SequenceWindowProps) => useSequenceSource('oracle', props);
