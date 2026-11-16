// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import type {ComponentProps} from 'react';
import ProcedureWindow from '../procedure/ProcedureWindow';

// Share the Oracle-style routine layout while selecting MySQL function semantics.
export default function FunctionWindow(props:Omit<ComponentProps<typeof ProcedureWindow>,'kind'>){
  return <ProcedureWindow {...props} kind="FUNCTION"/>;
}
