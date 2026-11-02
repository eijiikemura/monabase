// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { GenerationPreviewDialog } from '@/features/data-generator/GenerationPreviewDialog';
import { GenerationStatus } from '@/features/data-generator/GenerationStatus';
import type { GenerationFieldIssues } from '@/features/data-generator/generatorValidation';
import type { AiContext } from '@/shared/types/aiTypes';
import { memo, useState } from 'react';
import { WindowLoadingIndicator } from "@/components/feedback/WindowLoadingIndicator";
import { 
  Box, Paper, Typography, Button, Select, MenuItem, TextField, 
  FormControl, Checkbox, FormControlLabel,
  IconButton, Tooltip
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import TableChartIcon from '@mui/icons-material/TableChart';
import ObjectPickerDialog from '@/features/objects/ObjectPickerDialog';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import AiRequestButton from "@/features/ai/AiRequestButton";
import { useTranslation } from 'react-i18next';
import { useDataGenerator, type RuleType, type ColumnRule } from './useDataGenerator';

const GENERATOR_OBJECT_CATEGORIES = ['TABLE'] as const;

interface Props {
  isActive: boolean;
  isAiEnabled?: boolean;
  onOpenAiSidebar?: (context: AiContext | null) => void;
}

interface ColumnRuleRowProps {
  rule: ColumnRule;
  idx: number;
  isLoading: boolean;
  errors?: GenerationFieldIssues;
  handleRuleChange: ReturnType<typeof useDataGenerator>['handleRuleChange'];
}

const ColumnRuleRow = memo(function ColumnRuleRow({
  rule, idx, isLoading, handleRuleChange, errors = {}
}: ColumnRuleRowProps) {
  const { t, i18n } = useTranslation();
  const feedback = (field: keyof ColumnRule) => ({ error: !!errors[field], helperText: errors[field] });
  const isNotNull = rule.NULLABLE === 'N';
  const isDisabled = rule.ruleType === 'DISABLED';

  return (
    <Box key={rule.COLUMN_NAME} sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: isDisabled ? 'action.disabledBackground' : 'background.paper' }}>
      <Box sx={{ width: 200, flexShrink: 0 }}>
        <Typography variant="body2" fontWeight="bold" color={isDisabled ? 'text.disabled' : 'text.primary'} sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={rule.COLUMN_NAME}>
          {rule.COLUMN_NAME}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {rule.DATA_TYPE}({rule.DATA_LENGTH}) {isNotNull && <span style={{ color: isDisabled ? 'gray' : 'error.main' }}>{t("required_2")}</span>}
        </Typography>
      </Box>

      <FormControl error={!!errors.ruleType} disabled={isLoading} size="small" sx={{ width: 150, flexShrink: 0 }}>
        <Select
          value={rule.ruleType}
          disabled={isLoading || isDisabled}
          onChange={(e) => handleRuleChange(idx, 'ruleType', e.target.value as RuleType)}
          sx={{ fontSize: '0.85rem' }}
        >
          <MenuItem value="UNSPECIFIED" disabled={isNotNull}>{t("unspecified_2")}</MenuItem>
          <MenuItem value="SEQ_NUM">{t("sequence_7")}</MenuItem>
          <MenuItem value="SEQ_DATE">{t("seq_date")}</MenuItem>
          <MenuItem value="RANDOM_NUM">{t("random_number")}</MenuItem>
          <MenuItem value="RANDOM_CHAR">{t("random_string")}</MenuItem>
          <MenuItem value="RANDOM_DATE">{t("random_date")}</MenuItem>
          <MenuItem value="CHOICE">{t("choice")}</MenuItem>
          <MenuItem value="FIXED">{t("fixed")}</MenuItem>
          {isDisabled && <MenuItem value="DISABLED">{t("exclude_lob_etc")}</MenuItem>}
        </Select>
        {errors.ruleType && <Typography color="error" variant="caption" role="alert">{errors.ruleType}</Typography>}
      </FormControl>

      <Box sx={{ flexGrow: 1, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {rule.ruleType === 'SEQ_NUM' && (
          <>
            <TextField {...feedback('seqStart')} disabled={isLoading} label={t("start_value_2")} type="number" size="small" value={rule.seqStart} onChange={e => handleRuleChange(idx, 'seqStart', e.target.value)} sx={{ width: 100 }} />
            <TextField {...feedback('seqStep')} disabled={isLoading} label={t("increment")} type="number" size="small" value={rule.seqStep} onChange={e => handleRuleChange(idx, 'seqStep', e.target.value)} sx={{ width: 100 }} />
            <TextField {...feedback('seqPrefix')} disabled={isLoading} label={t("prefix")} size="small" value={rule.seqPrefix} onChange={e => handleRuleChange(idx, 'seqPrefix', e.target.value)} sx={{ width: 120 }} />
            <FormControlLabel control={<Checkbox disabled={isLoading} size="small" checked={rule.seqPadZero} onChange={e => handleRuleChange(idx, 'seqPadZero', e.target.checked)} />} label={<Typography variant="body2">{t("pad_digits")}</Typography>} />
          </>
        )}

        {rule.ruleType === 'SEQ_DATE' && (
          <TextField {...feedback('seqStartDate')} disabled={isLoading} label={t("start_date")} size="small" placeholder="YYYY/MM/DD" value={rule.seqStartDate} onChange={e => handleRuleChange(idx, 'seqStartDate', e.target.value)} sx={{ width: 150 }} />
        )}

        {rule.ruleType === 'RANDOM_NUM' && (
          <>
            <TextField {...feedback('randNumMin')} disabled={isLoading} label={t("min")} type="number" size="small" value={rule.randNumMin} onChange={e => handleRuleChange(idx, 'randNumMin', e.target.value)} sx={{ width: 100 }} />
            <TextField {...feedback('randNumMax')} disabled={isLoading} label={t("max")} type="number" size="small" value={rule.randNumMax} onChange={e => handleRuleChange(idx, 'randNumMax', e.target.value)} sx={{ width: 100 }} />
            <TextField {...feedback('randNumRound')} disabled={isLoading} label={t("round_unit")} type="number" size="small" value={rule.randNumRound} onChange={e => handleRuleChange(idx, 'randNumRound', e.target.value)} sx={{ width: 100 }} />
            <FormControlLabel control={<Checkbox disabled={isLoading} size="small" checked={rule.randNumUnique} onChange={e => handleRuleChange(idx, 'randNumUnique', e.target.checked)} />} label={<Typography variant="body2">{t("unique")}</Typography>} />
          </>
        )}

        {rule.ruleType === 'RANDOM_CHAR' && (
          <>
            <FormControl disabled={isLoading} size="small" sx={{ width: 130 }}>
              <Select value={rule.randCharType} onChange={e => handleRuleChange(idx, 'randCharType', e.target.value as ColumnRule['randCharType'])}>
                <MenuItem value="ALPHA">{t("alphabets_only")}</MenuItem>
                <MenuItem value="NUM">{t("numbers_only")}</MenuItem>
                <MenuItem value="ALPHANUM">{t("alphanumeric")}</MenuItem>
                {i18n.language === 'ja' && (
                  <MenuItem value="ZENKAKU">{t("full_width")}</MenuItem>
                )}
                <MenuItem value="REGEX">{t("regex")}</MenuItem>
              </Select>
            </FormControl>

            {rule.randCharType === 'REGEX' ? (
              <TextField {...feedback('randCharRegex')}
                disabled={isLoading}
                label={t("regex_pattern")}
                size="small"
                placeholder="\d{3}-\d{4}"
                value={rule.randCharRegex}
                onChange={e => handleRuleChange(idx, 'randCharRegex', e.target.value)}
                sx={{ width: 220 }}
              />
            ) : (
              <FormControlLabel control={<Checkbox disabled={isLoading} size="small" checked={rule.randCharFill} onChange={e => handleRuleChange(idx, 'randCharFill', e.target.checked)} />} label={<Typography variant="body2">{t("pad_digits")}</Typography>} />
            )}

            <FormControlLabel control={<Checkbox disabled={isLoading} size="small" checked={rule.randCharUnique} onChange={e => handleRuleChange(idx, 'randCharUnique', e.target.checked)} />} label={<Typography variant="body2">{t("unique")}</Typography>} />
          </>
        )}

        {rule.ruleType === 'RANDOM_DATE' && (
          <>
            <TextField {...feedback('randDateMin')} disabled={isLoading} label={t("min")} size="small" placeholder="YYYY/MM/DD" value={rule.randDateMin} onChange={e => handleRuleChange(idx, 'randDateMin', e.target.value)} sx={{ width: 130 }} />
            <TextField {...feedback('randDateMax')} disabled={isLoading} label={t("max")} size="small" placeholder="YYYY/MM/DD" value={rule.randDateMax} onChange={e => handleRuleChange(idx, 'randDateMax', e.target.value)} sx={{ width: 130 }} />
            <FormControlLabel control={<Checkbox disabled={isLoading} size="small" checked={rule.randDateIncludeTime} onChange={e => handleRuleChange(idx, 'randDateIncludeTime', e.target.checked)} />} label={<Typography variant="body2">{t("include_time")}</Typography>} />
            <FormControlLabel control={<Checkbox disabled={isLoading} size="small" checked={rule.randDateUnique} onChange={e => handleRuleChange(idx, 'randDateUnique', e.target.checked)} />} label={<Typography variant="body2">{t("unique")}</Typography>} />
          </>
        )}

        {rule.ruleType === 'CHOICE' && (
          <TextField {...feedback('choiceValues')} disabled={isLoading} label={t("choice_values_comma_separated")} size="small" value={rule.choiceValues} onChange={e => handleRuleChange(idx, 'choiceValues', e.target.value)} sx={{ flexGrow: 1 }} />
        )}

        {rule.ruleType === 'FIXED' && (
          <TextField {...feedback('fixedValue')} disabled={isLoading} label={t("fixed")} size="small" value={rule.fixedValue} onChange={e => handleRuleChange(idx, 'fixedValue', e.target.value)} sx={{ flexGrow: 1 }} />
        )}

        {isDisabled && (
          <Typography variant="body2" color="text.secondary">{t("this_column_type_is_not_supported_for_auto_generation")}</Typography>
        )}
      </Box>

      <Box sx={{ width: 120, flexShrink: 0, ml: 1 }}>
        <TextField {...feedback('nullRatio')}
          label={t("null_ratio")}
          type="number"
          size="small"
          disabled={isLoading || isNotNull || rule.ruleType === 'UNSPECIFIED' || isDisabled}
          value={rule.nullRatio}
          onChange={e => handleRuleChange(idx, 'nullRatio', Number(e.target.value))}
          inputProps={{ min: 0, max: 100 }}
          fullWidth
        />
      </Box>
    </Box>
  );
});

export default function DataGeneratorTab({
  isActive, isAiEnabled = false, onOpenAiSidebar
}: Props) {
  const { t } = useTranslation();
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  
  const {
    isLoading,
    schemas,
    selectedSchema,
    setSelectedSchema,
    selectedTable,
    setSelectedTable,
    columnRules,
    generateCount,
    setGenerateCount,
    handleRuleChange,
    handleExportSettings,
    handleExportForAI,
    handleImportSettings,
    handleGenerate, handlePreview, previewOpen, setPreviewOpen, previewRows, previewColumns, issues, progress, result, handleStop
  } = useDataGenerator(isActive, isAiEnabled, onOpenAiSidebar);

  if (!isActive) return null;

  return (
    <Box data-testid="data-generator" component="fieldset" disabled={isLoading && !progress.running} aria-busy={isLoading} sx={{ position: 'relative', border: 0, m: 0, minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column', p: 2, height: '100%', overflow: 'hidden', bgcolor: 'background.default' }}>
      {isLoading && !progress.running && <WindowLoadingIndicator />}
      <Paper sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, bgcolor: 'background.paper' }}>
        <FormControl disabled={isLoading} size="small" sx={{ minWidth: 200 }}>
          <Select displayEmpty value={selectedSchema} onChange={(e) => setSelectedSchema(e.target.value)}>
            <MenuItem value="" disabled>{t("select_schema")}</MenuItem>
            {schemas.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </Select>
        </FormControl>
        <Tooltip title={selectedTable || t('select_table')}>
          <span><Button variant="outlined" startIcon={<TableChartIcon />} disabled={isLoading || !selectedSchema}
            aria-label={t('select_table')} onClick={() => setTablePickerOpen(true)} sx={{ textTransform: 'none' }}>
            {selectedTable || t('select_table')}
          </Button></span>
        </Tooltip>
        
        <Tooltip title={t("load_settings_from_file")}>
          <span>
            <IconButton color="primary" onClick={handleImportSettings} disabled={isLoading || !selectedTable}>
              <FileUploadIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("save_current_settings_to_file")}>
          <span>
            <IconButton color="primary" onClick={handleExportSettings} disabled={isLoading || !selectedTable}>
              <FileDownloadIcon />
            </IconButton>
          </span>
        </Tooltip>
        
        <Tooltip title={isAiEnabled
          ? t("ask_ai_to_create_data_generation_rules")
          : t("export_an_ai_request_prompt_to_a_file")}>
          <span>
            <AiRequestButton onClick={handleExportForAI} disabled={isLoading || !selectedTable} />
          </span>
        </Tooltip>

        <Box sx={{ flexGrow: 1 }} />
        
        <TextField 
          disabled={isLoading}
          error={!!issues.countError} helperText={issues.countError}
          label={t("generation_count")}
          type="number" 
          size="small" 
          value={generateCount} 
          onChange={(e) => setGenerateCount(e.target.value)}
          sx={{ width: 150 }}
        />
        <Button onClick={handlePreview} disabled={isLoading || !selectedTable || !columnRules.length || issues.invalid}>{t('generation_preview')}</Button>
        <Tooltip title={t('generator_execute_help')}><span>
        <Button 
          variant="contained" 
          color="success" 
          startIcon={<PlayArrowIcon />} 
          onClick={handleGenerate}
          disabled={isLoading || !selectedTable || columnRules.length === 0 || issues.invalid}
        >
          {t("execute")}
        </Button>
        </span></Tooltip>
      </Paper>

      <GenerationStatus progress={progress} result={result} onStop={handleStop} />
      <GenerationPreviewDialog open={previewOpen} rows={previewRows} columns={previewColumns}
        disabled={isLoading || issues.invalid} onClose={() => setPreviewOpen(false)} onRefresh={handlePreview} onExecute={handleGenerate} />
      <Paper sx={{ flexGrow: 1, overflowY: 'auto', p: 2, bgcolor: 'background.paper' }}>
        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>{t("column_data_gen_rules")}</Typography>
        
        {columnRules.length === 0 && (
          <Typography variant="body2" color="text.secondary">{t("select_a_table_to_view_column_settings")}</Typography>
        )}

        {columnRules.map((rule, idx) => (
          <ColumnRuleRow
            key={rule.COLUMN_NAME}
            rule={rule}
            errors={issues.columns[rule.COLUMN_NAME]}
            idx={idx}
            isLoading={isLoading}
            handleRuleChange={handleRuleChange}
          />
        ))}
      </Paper>
      <ObjectPickerDialog open={tablePickerOpen} dbType="oracle" fixedSchema={selectedSchema}
        categories={GENERATOR_OBJECT_CATEGORIES} initialCategory="TABLE" multiple={false} title={t('select_table')} disabled={isLoading}
        onConfirm={objects => {
          if (objects.length !== 1 || objects[0].dbType !== 'oracle' || objects[0].category !== 'TABLE' || objects[0].schema !== selectedSchema) {
            throw new Error(t('generator_select_one_table'));
          }
          setSelectedTable(objects[0].name);
        }} onClose={() => setTablePickerOpen(false)} />
    </Box>
  );
}
