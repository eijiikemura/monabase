// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import enGitFeature from '../../../docs/screenshots/git-source-history.png';
import jaGitFeature from '../../../docs/screenshots/git-source-history-ja.png';

import type { ImageMetadata } from 'astro';
import type { Locale } from '../i18n/index';

// Explicit imports keep assets outside the website root visible to the dev server.
import enAdminDirectories from '../../../docs/screenshots/manual/en/admin-directories.png';
import enAdminLocks from '../../../docs/screenshots/manual/en/admin-locks.png';
import enAdminPdb from '../../../docs/screenshots/manual/en/admin-pdb.png';
import enAdminPrivileges from '../../../docs/screenshots/manual/en/admin-privileges.png';
import enAdminSchemas from '../../../docs/screenshots/manual/en/admin-schemas.png';
import enAdminSessions from '../../../docs/screenshots/manual/en/admin-sessions.png';
import enAdminTablespaces from '../../../docs/screenshots/manual/en/admin-tablespaces.png';
import enAdminUsers from '../../../docs/screenshots/manual/en/admin-users.png';
import enAiCodingAssistant from '../../../docs/screenshots/manual/en/ai-coding-assistant.png';
import enCheckConstraints from '../../../docs/screenshots/manual/en/check-constraints.png';
import enCrossTab from '../../../docs/screenshots/manual/en/cross-tab.png';
import enDataGenerator from '../../../docs/screenshots/manual/en/data-generator.png';
import enDatabaseLinks from '../../../docs/screenshots/manual/en/database-links.png';
import enErDiagram from '../../../docs/screenshots/manual/en/er-diagram.png';
import enGitSourceHistory from '../../../docs/screenshots/manual/en/git-source-history.png';
import enIndexes from '../../../docs/screenshots/manual/en/indexes.png';
import enLogin from '../../../docs/screenshots/manual/en/login.png';
import enMaterializedViewLogs from '../../../docs/screenshots/manual/en/materialized-view-logs.png';
import enMaterializedViews from '../../../docs/screenshots/manual/en/materialized-views.png';
import enPackages from '../../../docs/screenshots/manual/en/packages.png';
import enQueryBuilder from '../../../docs/screenshots/manual/en/query-builder.png';
import enSequences from '../../../docs/screenshots/manual/en/sequences.png';
import enSettings from '../../../docs/screenshots/manual/en/settings.png';
import enSqlWorkspace from '../../../docs/screenshots/manual/en/sql-workspace.png';
import enStoredPrograms from '../../../docs/screenshots/manual/en/stored-programs.png';
import enStyleDark from '../../../docs/screenshots/manual/en/style-dark.png';
import enStyleMona from '../../../docs/screenshots/manual/en/style-mona.png';
import enStyleSimple from '../../../docs/screenshots/manual/en/style-simple.png';
import enSynonyms from '../../../docs/screenshots/manual/en/synonyms.png';
import enTables from '../../../docs/screenshots/manual/en/tables.png';
import enTraceDebugging from '../../../docs/screenshots/manual/en/trace-debugging.png';
import enTriggers from '../../../docs/screenshots/manual/en/triggers.png';
import enTypes from '../../../docs/screenshots/manual/en/types.png';
import enViews from '../../../docs/screenshots/manual/en/views.png';
import enWorkspace from '../../../docs/screenshots/manual/en/workspace.png';
import jaAdminDirectories from '../../../docs/screenshots/manual/ja/admin-directories.png';
import jaAdminLocks from '../../../docs/screenshots/manual/ja/admin-locks.png';
import jaAdminPdb from '../../../docs/screenshots/manual/ja/admin-pdb.png';
import jaAdminPrivileges from '../../../docs/screenshots/manual/ja/admin-privileges.png';
import jaAdminSchemas from '../../../docs/screenshots/manual/ja/admin-schemas.png';
import jaAdminSessions from '../../../docs/screenshots/manual/ja/admin-sessions.png';
import jaAdminTablespaces from '../../../docs/screenshots/manual/ja/admin-tablespaces.png';
import jaAdminUsers from '../../../docs/screenshots/manual/ja/admin-users.png';
import jaAiCodingAssistant from '../../../docs/screenshots/manual/ja/ai-coding-assistant.png';
import jaCheckConstraints from '../../../docs/screenshots/manual/ja/check-constraints.png';
import jaCrossTab from '../../../docs/screenshots/manual/ja/cross-tab.png';
import jaDataGenerator from '../../../docs/screenshots/manual/ja/data-generator.png';
import jaDatabaseLinks from '../../../docs/screenshots/manual/ja/database-links.png';
import jaErDiagram from '../../../docs/screenshots/manual/ja/er-diagram.png';
import jaGitSourceHistory from '../../../docs/screenshots/manual/ja/git-source-history.png';
import jaIndexes from '../../../docs/screenshots/manual/ja/indexes.png';
import jaLogin from '../../../docs/screenshots/manual/ja/login.png';
import jaMaterializedViewLogs from '../../../docs/screenshots/manual/ja/materialized-view-logs.png';
import jaMaterializedViews from '../../../docs/screenshots/manual/ja/materialized-views.png';
import jaPackages from '../../../docs/screenshots/manual/ja/packages.png';
import jaQueryBuilder from '../../../docs/screenshots/manual/ja/query-builder.png';
import jaSequences from '../../../docs/screenshots/manual/ja/sequences.png';
import jaSettings from '../../../docs/screenshots/manual/ja/settings.png';
import jaSqlWorkspace from '../../../docs/screenshots/manual/ja/sql-workspace.png';
import jaStoredPrograms from '../../../docs/screenshots/manual/ja/stored-programs.png';
import jaStyleDark from '../../../docs/screenshots/manual/ja/style-dark.png';
import jaStyleMona from '../../../docs/screenshots/manual/ja/style-mona.png';
import jaStyleSimple from '../../../docs/screenshots/manual/ja/style-simple.png';
import jaSynonyms from '../../../docs/screenshots/manual/ja/synonyms.png';
import jaTables from '../../../docs/screenshots/manual/ja/tables.png';
import jaTraceDebugging from '../../../docs/screenshots/manual/ja/trace-debugging.png';
import jaTriggers from '../../../docs/screenshots/manual/ja/triggers.png';
import jaTypes from '../../../docs/screenshots/manual/ja/types.png';
import jaViews from '../../../docs/screenshots/manual/ja/views.png';
import jaWorkspace from '../../../docs/screenshots/manual/ja/workspace.png';

export const screenshots: Record<Locale, Record<string, ImageMetadata>> = {
  en: {
    'admin-directories': enAdminDirectories,
    'admin-locks': enAdminLocks,
    'admin-pdb': enAdminPdb,
    'admin-privileges': enAdminPrivileges,
    'admin-schemas': enAdminSchemas,
    'admin-sessions': enAdminSessions,
    'admin-tablespaces': enAdminTablespaces,
    'admin-users': enAdminUsers,
    'ai-coding-assistant': enAiCodingAssistant,
    'check-constraints': enCheckConstraints,
    'cross-tab': enCrossTab,
    'data-generator': enDataGenerator,
    'database-links': enDatabaseLinks,
    'er-diagram': enErDiagram,
    'git-source-history': enGitSourceHistory,
    'git-source-history-feature': enGitFeature,
    'indexes': enIndexes,
    'login': enLogin,
    'materialized-view-logs': enMaterializedViewLogs,
    'materialized-views': enMaterializedViews,
    'packages': enPackages,
    'query-builder': enQueryBuilder,
    'sequences': enSequences,
    'settings': enSettings,
    'sql-workspace': enSqlWorkspace,
    'stored-programs': enStoredPrograms,
    'style-dark': enStyleDark,
    'style-mona': enStyleMona,
    'style-simple': enStyleSimple,
    'synonyms': enSynonyms,
    'tables': enTables,
    'trace-debugging': enTraceDebugging,
    'triggers': enTriggers,
    'types': enTypes,
    'views': enViews,
    'workspace': enWorkspace,
  },
  ja: {
    'admin-directories': jaAdminDirectories,
    'admin-locks': jaAdminLocks,
    'admin-pdb': jaAdminPdb,
    'admin-privileges': jaAdminPrivileges,
    'admin-schemas': jaAdminSchemas,
    'admin-sessions': jaAdminSessions,
    'admin-tablespaces': jaAdminTablespaces,
    'admin-users': jaAdminUsers,
    'ai-coding-assistant': jaAiCodingAssistant,
    'check-constraints': jaCheckConstraints,
    'cross-tab': jaCrossTab,
    'data-generator': jaDataGenerator,
    'database-links': jaDatabaseLinks,
    'er-diagram': jaErDiagram,
    'git-source-history': jaGitSourceHistory,
    'git-source-history-feature': jaGitFeature,
    'indexes': jaIndexes,
    'login': jaLogin,
    'materialized-view-logs': jaMaterializedViewLogs,
    'materialized-views': jaMaterializedViews,
    'packages': jaPackages,
    'query-builder': jaQueryBuilder,
    'sequences': jaSequences,
    'settings': jaSettings,
    'sql-workspace': jaSqlWorkspace,
    'stored-programs': jaStoredPrograms,
    'style-dark': jaStyleDark,
    'style-mona': jaStyleMona,
    'style-simple': jaStyleSimple,
    'synonyms': jaSynonyms,
    'tables': jaTables,
    'trace-debugging': jaTraceDebugging,
    'triggers': jaTriggers,
    'types': jaTypes,
    'views': jaViews,
    'workspace': jaWorkspace,
  },
};
