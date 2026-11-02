// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { type ViewUpdate, MatchDecorator, ViewPlugin, Decoration, EditorView } from '@codemirror/view';
import { SQLDialect } from '@codemirror/lang-sql';

import i18next from 'i18next';

export const plsqlDialect = SQLDialect.define({
  // Include exit.
  keywords: "access add all alter and any as asc audit begin binary_integer body between by case check cluster column column_value comment compress connect create current cursor declare default delete desc distinct drop editionable else elsif end exclusive exists exit fetch file for forall from function goto grant group having identified if immediate in increment index initial insert intersect into is level like lock maxextents minus mode modify nested_table_id noaudit nocompress not nowait null of offline on online option or order out package pctfree prior procedure public rename replace resource return revoke row rownum rows select session set share size start successful synonym table then to trigger union unique update validate values view when whenever where while with loop exception others type rowtype access_into_null case_not_found collection_is_null cursor_already_open dup_val_on_index invalid_cursor invalid_number login_denied no_data_found no_data_needed not_logged_on program_error rowtype_mismatch self_is_null storage_error subscript_beyond_count subscript_outside_limit sys_invalid_rowid timeout_on_resource too_many_rows value_error zero_divide raise_application_error",
  
  builtin: "",
  types: "char date decimal float integer long mlslabel number raw rowid smallint varchar varchar2",
  operatorChars: "+-*/=<>&|~!"
});

// ============================================================================
// Safe function highlighting color (#3300aa).
// ============================================================================
const builtinRegex = /\b(add_months|ascii|avg|ceil|chr|coalesce|concat|count|decode|dense_rank|floor|initcap|instr|instrb|last_day|length|lengthb|lower|lpad|ltrim|max|min|mod|nvl|rank|round|row_number|rpad|rtrim|substr|substrb|sum|sysdate|to_char|to_date|to_number|translate|trim|trunc|uid|upper|user)\b/gi;

const builtinDeco = Decoration.mark({ class: "cm-oracle-func" });

const builtinMatcher = new MatchDecorator({
  regexp: builtinRegex,
  decoration: builtinDeco
});

const builtinHighlightPlugin = ViewPlugin.fromClass(class {
  decorations;
  constructor(view: EditorView) {
    this.decorations = builtinMatcher.createDeco(view);
  }
  update(update: ViewUpdate) {
    this.decorations = builtinMatcher.updateDeco(update, this.decorations);
  }
}, {
  decorations: (v) => v.decorations
});

const builtinTheme = EditorView.theme({
  ".cm-oracle-func": { color: "#3300aa" }
});

export const oracleFunctionHighlighting = [builtinHighlightPlugin, builtinTheme];


// ============================================================================
// Autocomplete data definitions.
// ============================================================================

// 1. Built-in functions.
const builtinFuncsStr = "add_months ascii avg ceil chr coalesce concat count decode dense_rank floor initcap instr instrb last_day length lengthb lower lpad ltrim max min mod nvl rank round row_number rpad rtrim substr substrb sum sysdate to_char to_date to_number translate trim trunc uid upper user";

const baseCompletions = builtinFuncsStr.split(' ').map(func => ({
  label: func.toUpperCase(),
  type: "function",
  // Apply translations.
  detail: i18next.t("built_in_function", { defaultValue: "Built-in Function" })
}));

// 2. Standard Oracle packages, offered as completions without highlighting.
// Representative entries; add others here separated by spaces.
const oraclePackagesStr = "dbms_output dbms_sql dbms_lob dbms_metadata dbms_utility dbms_random dbms_crypto dbms_scheduler dbms_job dbms_stats utl_file utl_http utl_smtp utl_mail utl_url htp htf owa owa_util";

const packageCompletions = oraclePackagesStr.split(' ').map(pkg => ({
  label: pkg.toUpperCase(),
  type: "class",
  // Apply translations.
  detail: i18next.t("oracle_standard_packages", { defaultValue: "Oracle Standard Packages" })
}));

// 3. Combine and export both lists.
export const oracleBuiltinCompletions = [...baseCompletions, ...packageCompletions];