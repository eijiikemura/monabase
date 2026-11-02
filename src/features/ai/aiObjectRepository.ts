// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Keep existing AI call names and delegate fetching to shared helpers.
export { OBJECT_CATEGORIES as AI_OBJECT_CATEGORIES, OBJECT_PAGE_SIZE as AI_OBJECT_PAGE_SIZE, getObjectCategoryLabel as getAiCategoryLabel, listObjectSchemas as listAiSchemas, listObjects as listAiObjects, loadObjectReference as loadAiObjectReference } from '../objects/objectRepository';
export type { DbType as AiDbType, ObjectCategory as AiObjectCategory, DatabaseObject as AiDatabaseObject, ObjectReference as AiObjectReference } from '@/shared/types/objectTypes';
