// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { TFunction } from 'i18next';
import type { AiContext, AiObjectSelectionStore, AiCodingResponseTarget } from '@/shared/types/aiTypes';

interface PackageAiRequestOptions {
  isNew: boolean;
  schema: string;
  objectName: string;
  objectType: 'PACKAGE' | 'PACKAGE BODY';
  isAiEnabled?: boolean;
  onOpenAiSidebar?: (context: AiContext) => void;
  objectSelection: AiObjectSelectionStore;
  responseTarget: AiCodingResponseTarget;
  t: TFunction;
}

export function requestPackageAi({
  isNew, schema, objectName, objectType, isAiEnabled,
  onOpenAiSidebar, objectSelection, responseTarget, t
}: PackageAiRequestOptions) {
  if (!isAiEnabled || !onOpenAiSidebar) {
    alert(t("ai_configure_support_instructions"));
    return;
  }
  // Identify an existing body's header using the edited schema and name.
  if (!isNew && objectType === 'PACKAGE BODY') {
    objectSelection.addObjects([{
      key: JSON.stringify(['oracle', schema, 'PACKAGE', objectName]),
      dbType: 'oracle',
      schema,
      category: 'PACKAGE',
      name: objectName,
      displayName: objectName
    }]);
  }
  onOpenAiSidebar({
    targetTab: `${isNew ? t("create_new") : objectName} (${schema} · ${objectType})`,
    requestType: "coding_package", requestId: crypto.randomUUID(), objectSelection,
    requiredPackageHeader: objectType === 'PACKAGE BODY'
      ? { schema, objectName: isNew ? undefined : objectName }
      : undefined,
    referencePrompt: [
      t("this_is_a_request", {
        requestType: t("coding_package")
      }),
      objectType === 'PACKAGE'
        ? t("ai_package_header_instruction")
        : t("ai_package_body_instruction")
    ].join('\n'),
    codingResponse: responseTarget
  });
}
