// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import CrossTabPanel from '@/features/cross-tab/CrossTabPanel';
import { useCrossTabWindow, type CrossTabWindowProps } from './useCrossTabWindow';
export default function CrossTabWindow(props: CrossTabWindowProps) {
  const controller = useCrossTabWindow(props);
  return <CrossTabPanel {...props} controller={controller} />;
}
