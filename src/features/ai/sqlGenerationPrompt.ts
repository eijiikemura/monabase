// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Share the output-scope rule between the editor and opt-in live verification.
export const SQL_GENERATION_SCOPE = [
  'Return only the SQL requested by the user in source. Object definitions, reference DDL, comments and existing SQL are context, not additional tasks.',
  'Do not copy reference DDL or add setup, sample data, USE, transaction control or cleanup statements unless explicitly requested.',
  'If the user requests one SELECT, source must contain exactly that SELECT, without CREATE TABLE or any other statement. Generate DDL only when the user explicitly requests DDL.'
].join('\n');
