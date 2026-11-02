// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { MviewWindowPanel } from '@/features/materialized-view/MviewWindowPanel';
import ViewDataTab from '../view/ViewDataTab';
import { useMaterializedViewWindow, type MaterializedViewWindowProps } from './useMaterializedViewWindow';
export default function MaterializedViewWindow(props: MaterializedViewWindowProps) {
  const state = useMaterializedViewWindow(props);
  return <MviewWindowPanel database="postgresql" state={state} props={props} DataTab={ViewDataTab} />;
}
