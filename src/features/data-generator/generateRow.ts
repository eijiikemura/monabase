// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { TFunction } from 'i18next';
import RandExp from 'randexp';
import type { ColumnRule } from './generatorTypes';
import { sequenceValue, randomDecimalValue } from '@/features/data-generator/generatorValidation';
import { randomInt, randomString } from '@/features/data-generator/randomValues';
import { formatDateString } from '@/shared/utils/dateFormatter';
import { generatedTimeValue } from '@/features/data-generator/generatorSql';

export function createGeneratorRow(inputDateFormat: string, t: TFunction, fullWidthBytes = 3) {
  const getActualFormat = (includeTime: boolean) => {
    let fmt = inputDateFormat;
    if (includeTime && !fmt.match(/H|h|m|s/i)) {
      fmt += ' HH:mm:ss';
    } else if (!includeTime && fmt.match(/H|h|m|s/i)) {
      fmt = fmt.split(' ')[0];
    }
    return fmt;
  };

  const generateDataRow = (rules: ColumnRule[], rowIndex: number, uniqueSets: Record<string, Set<string | number | null>>) => {
    const rowValues: Record<string, string | number | null> = Object.create(null);
    for (const rule of rules) {
      if (rule.ruleType === 'DISABLED' || rule.ruleType === 'UNSPECIFIED') {
        continue;
      }

      if (rule.NULLABLE !== 'N' && rule.nullRatio > 0) {
        if (Math.random() * 100 < rule.nullRatio) {
          rowValues[rule.COLUMN_NAME] = null;
          continue;
        }
      }

      let val: string | number | null = null;

      if (rule.ruleType === 'SEQ_NUM') {
        val = sequenceValue(rule.seqStart, rule.seqStep, rowIndex);
        if (rule.seqPadZero && rule.DATA_LENGTH) {
          val = String(val).padStart(rule.DATA_LENGTH, '0');
        }
        if (rule.seqPrefix) val = rule.seqPrefix + val;
      }
      else if (rule.ruleType === 'SEQ_DATE') {
        const d = new Date(rule.seqStartDate);
        d.setDate(d.getDate() + rowIndex);
        const targetFormat = getActualFormat(false);
        val = formatDateString(d, targetFormat);
      }
      else if (rule.ruleType === 'RANDOM_NUM') {
        const generateNumVal = () => randomDecimalValue(rule.randNumMin, rule.randNumMax, rule.randNumRound, Math.random());
        val = generateNumVal();

        if (rule.randNumUnique && uniqueSets[rule.COLUMN_NAME]) {
           let attempts = 0;
           while (uniqueSets[rule.COLUMN_NAME].has(val)) {
              val = generateNumVal();
              attempts++;
              if (attempts > 1000) {
                throw new Error(t("column_3") + rule.COLUMN_NAME + t("data_generation_unique_numbers_exhausted"));
              }
           }
           uniqueSets[rule.COLUMN_NAME].add(val);
        }
      }
      else if (rule.ruleType === 'RANDOM_CHAR') {
        let maxChars = rule.DATA_LENGTH;
        if (rule.randCharType === 'ZENKAKU') {
          maxChars = Math.floor(rule.DATA_LENGTH / fullWidthBytes);
          if (maxChars < 1) maxChars = 1;
        }

        const len = rule.randCharFill ? Math.min(maxChars, 4000) : randomInt(1, Math.min(maxChars, 50));

        const generateRawCharVal = () => {
          if (rule.randCharType === 'REGEX' && rule.randCharRegex) {
            try {
              return new RandExp(rule.randCharRegex).gen();
            } catch {
              console.warn("Failed to parse the regular expression:", rule.randCharRegex);
              return randomString(len, 'ALPHA');
            }
          } else if (rule.randCharType !== 'REGEX') {
            return randomString(len, rule.randCharType);
          }
          return randomString(len, 'ALPHA');
        };

        // Validate the final value before adding it to the uniqueness set.
        const generateCharVal = () => {
          const candidate = generateRawCharVal();
          if (rule.randCharType === 'REGEX' && candidate.length > maxChars) {
            throw new Error(t('data_generation_regex_value_too_long', {
              column: rule.COLUMN_NAME, length: candidate.length, max: maxChars
            }));
          }
          return candidate.substring(0, maxChars);
        };

        val = generateCharVal();

        if (rule.randCharUnique && uniqueSets[rule.COLUMN_NAME]) {
           let attempts = 0;
           while (uniqueSets[rule.COLUMN_NAME].has(val)) {
              val = generateCharVal();
              attempts++;
              if (attempts > 1000) {
                throw new Error(t("column_3") + rule.COLUMN_NAME + t("data_generation_unique_strings_exhausted"));
              }
           }
           uniqueSets[rule.COLUMN_NAME].add(val);
        }

      }
      else if (rule.ruleType === 'RANDOM_DATE' && /^TIME(?:\(|$)/i.test(rule.DATA_TYPE)) {
        const sample = () => generatedTimeValue(rule, Math.random());
        val = sample();
        if (rule.randDateUnique && uniqueSets[rule.COLUMN_NAME]) {
          let attempts = 0;
          while (uniqueSets[rule.COLUMN_NAME].has(val)) { if (++attempts > 1000) throw new Error(t('generation_rule_invalid', { column: rule.COLUMN_NAME })); val = sample(); }
          uniqueSets[rule.COLUMN_NAME].add(val);
        }
      }
      else if (rule.ruleType === 'RANDOM_DATE') {
        const generateDateVal = () => {
          const minTime = new Date(rule.randDateMin).getTime();
          const maxTime = new Date(rule.randDateMax).getTime();
          const randTime = minTime + Math.random() * (maxTime - minTime);
          const d = new Date(randTime);

          if (!rule.randDateIncludeTime) {
            d.setHours(0, 0, 0, 0);
          }
          const targetFormat = getActualFormat(rule.randDateIncludeTime);
          return formatDateString(d, targetFormat);
        };

        val = generateDateVal();

        if (rule.randDateUnique && uniqueSets[rule.COLUMN_NAME]) {
           let attempts = 0;
           while (uniqueSets[rule.COLUMN_NAME].has(val)) {
              val = generateDateVal();
              attempts++;
              if (attempts > 1000) {
                throw new Error(t("column_3") + rule.COLUMN_NAME + t("data_generation_unique_dates_exhausted"));
              }
           }
           uniqueSets[rule.COLUMN_NAME].add(val);
        }
      }
      else if (rule.ruleType === 'CHOICE') {
        const choices = rule.choiceValues.split(',').map(s => s.trim()).filter(s => s);
        if (choices.length > 0) {
          val = choices[Math.floor(Math.random() * choices.length)];
        }
      }
      else if (rule.ruleType === 'FIXED') {
        val = rule.fixedValue;
      }

      rowValues[rule.COLUMN_NAME] = val;
    }
    return rowValues;
  };

  return generateDataRow;
}
