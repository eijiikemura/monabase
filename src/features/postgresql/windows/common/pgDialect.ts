// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { type ViewUpdate, MatchDecorator, ViewPlugin, Decoration, EditorView } from '@codemirror/view';
import { SQLDialect } from '@codemirror/lang-sql';

import i18next from 'i18next'; 

// Define PostgreSQL keywords.
export const pgDialect = SQLDialect.define({
  keywords: "abort absolute access action add admin after aggregate all also alter always analyse analyze and any array as asc assertion assignment asymmetric at atomic attach attribute authid authorization backwards before begin between bigserial bit bool boolean both by cache call called cascade cascaded case cast catalog chain char character characteristics check checkpoint class close cluster coalesce collate collation column columns comment comments commit committed concurrently configuration conflict connection constraint constraints content continue conversion copy cost create cross csv cube current current_catalog current_date current_role current_schema current_time current_timestamp current_user cursor cycle data database day deallocate dec decimal declare default defaults deferrable deferred definer delete delimiter delimiters depends desc detach dictionary disable discard document domain double drop each else enable encoding encrypted end enum escape event except exclude excluding exclusive execute exists explain expression extension external extract false family fetch filter first float following for force foreign forward freeze from full function functions generated global grant granted greatest group grouping groups handler hash having header hold hour identity if ilike immediate immutable implicit import in include including increment index indexes inherit inherits initially inline inner inout input insensitive insert instead int integer intersect interval into invoker is isnull isolation join key label language large last lateral leading leakproof least left level like limit listen load local localtime localtimestamp location lock locked logged mapping match materialized maxvalue method minute minvalue mode month move name names national natural new next no nonulls not nothing notify notnull nowait null nullif nulls numeric object of off offset oids old on only operator option options or order ordinality out outer over overlaps overlay overriding owned owner parallel parser partial partition passing password placing plans policy position preceding precision preserve prepare prepared primary prior privileges procedural procedure procedures program publication quote range read real reassign recheck recursive ref references referencing refresh reindex relative release rename repeatable replace replica reset restart restrict returning returns revoke right role rollback rollup routine routines row rows rule savepoint schema schemas scroll search second security select sequence sequences serial serializable server session session_user set setof share show simple skip smallint smallserial snapshot some sql stable standalone start statement statistics stdin stdout storage strict strip substring support symmetric sysid system table tables tablespace temp template temporary text then tie time timestamp to trailing transaction transform treat trigger trim true truncate trusted type types unbounded uncommitted unencrypted union unique unknown unlisten unlogged until update user using vacuum valid validate value values varchar variadic varying view views volatile when where whitespace window with within without work wrapper write xml year yes zone",
  builtin: "",
  types: "bigint bigserial bit varying boolean box bytea character varying cidr circle date double precision inet integer interval json jsonb line lseg macaddr macaddr8 money numeric path pg_lsn point polygon real smallint smallserial serial text time without time zone timestamp without time zone tsquery tsvector txid_snapshot uuid xml",
  operatorChars: "+-*/=<>&|~!"
});

// ============================================================================
// Safe function highlighting color (#3300aa).
// ============================================================================
const builtinRegex = /\b(abs|acos|ascii|asin|atan|atan2|avg|bit_length|btrim|cbrt|ceil|ceiling|char_length|character_length|chr|coalesce|concat|concat_ws|convert|convert_from|convert_to|cos|cot|count|cume_dist|current_date|current_time|current_timestamp|date_part|date_trunc|decode|degrees|dense_rank|div|encode|exp|extract|first_value|floor|format|greatest|initcap|lag|last_value|lead|least|left|length|ln|log|lower|lpad|ltrim|max|md5|min|mod|now|nth_value|ntile|nullif|octet_length|percent_rank|pi|position|power|radians|random|rank|regexp_match|regexp_matches|regexp_replace|regexp_split_to_array|regexp_split_to_table|repeat|replace|reverse|right|round|row_number|rpad|rtrim|setseed|sign|sin|split_part|sqrt|strpos|substr|substring|sum|tan|to_ascii|to_char|to_date|to_hex|to_number|to_timestamp|translate|trim|trunc|upper)\b/gi;

const builtinDeco = Decoration.mark({ class: "cm-pg-func" });

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
  ".cm-pg-func": { color: "#3300aa" }
});

export const pgFunctionHighlighting = [builtinHighlightPlugin, builtinTheme];

// ============================================================================
// Autocomplete data definitions.
// ============================================================================

const builtinFuncsStr = "abs acos ascii asin atan atan2 avg bit_length btrim cbrt ceil ceiling char_length character_length chr coalesce concat concat_ws convert convert_from convert_to cos cot count cume_dist current_date current_time current_timestamp date_part date_trunc decode degrees dense_rank div encode exp extract first_value floor format greatest initcap lag last_value lead least left length ln log lower lpad ltrim max md5 min mod now nth_value ntile nullif octet_length percent_rank pi position power radians random rank regexp_match regexp_matches regexp_replace regexp_split_to_array regexp_split_to_table repeat replace reverse right round row_number rpad rtrim setseed sign sin split_part sqrt strpos substr substring sum tan to_ascii to_char to_date to_hex to_number to_timestamp translate trim trunc upper";

const baseCompletions = builtinFuncsStr.split(' ').map(func => ({
  label: func.toUpperCase(),
  type: "function",
  detail: i18next.t("built_in_function", { defaultValue: "Built-in Function" })
}));

export const pgBuiltinCompletions = [...baseCompletions];