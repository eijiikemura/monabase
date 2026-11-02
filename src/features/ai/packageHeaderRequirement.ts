// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { AiContext, SelectedAiObject } from '@/shared/types/aiTypes';


// Allow body requests only after loading the corresponding header definition.
export function hasRequiredPackageHeader(
  targets: readonly SelectedAiObject[],
  requirement: AiContext['requiredPackageHeader']
): boolean {
  if (!requirement) return true;
  return targets.some(target =>
    target.object.dbType === 'oracle' &&
    target.object.category === 'PACKAGE' &&
    target.object.schema === requirement.schema &&
    (!requirement.objectName || target.object.name === requirement.objectName) &&
    target.status === 'ready' &&
    Boolean(target.reference?.definition.trim())
  );
}
