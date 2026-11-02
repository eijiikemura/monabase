// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { TraceStep, BreakpointCondition, TraceSimulator } from '@/shared/types/traceTypes';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const getLoopDepth = (path: string) => path ? path.split(' > ').length : 0;

export function useTraceSimulator(): TraceSimulator {
  const { t } = useTranslation();

  const [executionSteps, setExecutionSteps] = useState<TraceStep[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [currentVariables, setCurrentVariables] = useState<Record<string, string>>({});
  
  const [breakpoints, setBreakpoints] = useState<number[]>([]);
  const [breakpointConditions, setBreakpointConditions] = useState<{ [lineNum: number]: BreakpointCondition }>({});

  const hitCountsRef = useRef<Record<number, number>>({});

  const executionStepsRef = useRef<TraceStep[]>([]);
  useEffect(() => {
    executionStepsRef.current = executionSteps;
  }, [executionSteps]);

  const clearSimulation = useCallback(() => {
    setExecutionSteps([]);
    setIsSimulating(false);
    setCurrentStepIndex(-1);
    setActiveLine(null);
    setCurrentVariables({});
    hitCountsRef.current = {}; 
  }, []);

  const loadSimulation = useCallback((steps: TraceStep[]) => {
    setExecutionSteps(steps);
    setIsSimulating(false);
    setCurrentStepIndex(-1);
    setActiveLine(null);
    hitCountsRef.current = {}; 
    if (steps.length > 0) {
      setCurrentVariables(steps[steps.length - 1].variables || {});
    } else {
      setCurrentVariables({});
    }
  }, []);

  const evaluateBreakpoint = useCallback((step: TraceStep): boolean => {
    const lineNum = step.lineNum;
    if (!breakpoints.includes(lineNum)) return false;

    const condition = breakpointConditions[lineNum];
    if (!condition) return true; 

    if (condition.type === 'hit_count') {
      const currentHit = (hitCountsRef.current[lineNum] || 0) + 1;
      hitCountsRef.current[lineNum] = currentHit;
      return currentHit >= (condition.count || 1);
    } 
    
    if (condition.type === 'variable' && condition.varName && condition.expectedValue) {
      const targetVarName = condition.varName.toUpperCase().trim();
      const actualVal = step.variables[targetVarName];
      const expectedVal = condition.expectedValue.trim();
      const operator = condition.operator || '==';

      if (actualVal === undefined) return false;

      const numActual = Number(actualVal);
      const numExpected = Number(expectedVal);
      const isNum = !isNaN(numActual) && !isNaN(numExpected);

      switch (operator) {
        case '==': return isNum ? numActual === numExpected : String(actualVal) === expectedVal;
        case '!=': return isNum ? numActual !== numExpected : String(actualVal) !== expectedVal;
        case '>':  return isNum ? numActual > numExpected : String(actualVal) > expectedVal;
        case '<':  return isNum ? numActual < numExpected : String(actualVal) < expectedVal;
        case '>=': return isNum ? numActual >= numExpected : String(actualVal) >= expectedVal;
        case '<=': return isNum ? numActual <= numExpected : String(actualVal) <= expectedVal;
        default:   return String(actualVal) === expectedVal;
      }
    }

    return true; 
  }, [breakpoints, breakpointConditions]);

  const handleSimulateStep = useCallback((action: 'start' | 'auto_start' | 'resume' | 'step_over' | 'step_into' | 'step_out' | 'stop') => {
    const steps = executionStepsRef.current;
    if (steps.length === 0) return;

    if (action === 'stop') {
      setIsSimulating(false);
      setCurrentStepIndex(-1);
      setActiveLine(null);
      setCurrentVariables(steps[steps.length - 1].variables); 
      hitCountsRef.current = {}; 
      return;
    }

    if (action === 'start' || action === 'auto_start') {
      if (action === 'start' && breakpoints.length === 0) {
        alert(t("no_breakpoints_set_set_at_least_one_breakpoint"));
        return;
      }

      hitCountsRef.current = {}; 
      setIsSimulating(true);

      let startIndex = 0;
      
      const simulateLoop = () => {
        if (startIndex >= steps.length) {
          setIsSimulating(false);
          setActiveLine(null);
          setCurrentStepIndex(-1);
          setCurrentVariables(steps[steps.length - 1].variables);
          return;
        }

        const currentStep = steps[startIndex];
        
        if (evaluateBreakpoint(currentStep)) {
          setCurrentStepIndex(startIndex);
          setActiveLine(currentStep.lineNum);
          setCurrentVariables(currentStep.variables);
          return;
        }

        startIndex++;
        
        if (startIndex % 50 === 0) {
           setTimeout(simulateLoop, 0);
        } else {
           simulateLoop();
        }
      };
      
      simulateLoop();
      return;
    }

    let nextIndex = currentStepIndex + 1;

    if (action === 'step_into') {
      if (nextIndex >= steps.length) {
        setIsSimulating(false);
        setActiveLine(null);
        alert(t("debug_execution_completed_to_the_end"));
        return;
      }
      setCurrentStepIndex(nextIndex);
      setActiveLine(steps[nextIndex].lineNum);
      setCurrentVariables(steps[nextIndex].variables);
      return;
    }

    if (action === 'step_over') {
      const currentDepth = getLoopDepth(steps[currentStepIndex]?.loopPath || '');
      const nextDepth = getLoopDepth(steps[nextIndex]?.loopPath || '');

      if (nextDepth > currentDepth) {
        while (nextIndex < steps.length) {
          const checkDepth = getLoopDepth(steps[nextIndex].loopPath || '');
          if (checkDepth <= currentDepth) break; 
          if (evaluateBreakpoint(steps[nextIndex])) break; 
          nextIndex++;
        }
      }

      if (nextIndex >= steps.length) {
        setIsSimulating(false);
        setActiveLine(null);
        alert(t("debug_execution_completed_to_the_end"));
        return;
      }

      setCurrentStepIndex(nextIndex);
      setActiveLine(steps[nextIndex].lineNum);
      setCurrentVariables(steps[nextIndex].variables);
      return;
    }

    if (action === 'step_out') {
      const currentDepth = getLoopDepth(steps[currentStepIndex]?.loopPath || '');
      
      if (currentDepth === 0) {
        handleSimulateStep('resume');
        return;
      }

      while (nextIndex < steps.length) {
        const checkDepth = getLoopDepth(steps[nextIndex].loopPath || '');
        if (checkDepth < currentDepth) break; 
        if (evaluateBreakpoint(steps[nextIndex])) break; 
        nextIndex++;
      }

      if (nextIndex >= steps.length) {
        setIsSimulating(false);
        setActiveLine(null);
        alert(t("debug_execution_completed_to_the_end"));
        return;
      }

      setCurrentStepIndex(nextIndex);
      setActiveLine(steps[nextIndex].lineNum);
      setCurrentVariables(steps[nextIndex].variables);
      return;
    }

    if (action === 'resume') {
      const simulateLoop = () => {
        if (nextIndex >= steps.length) {
          setIsSimulating(false);
          setActiveLine(null);
          alert(t("debug_execution_completed_to_the_end"));
          return;
        }

        const currentStep = steps[nextIndex];
        
        if (evaluateBreakpoint(currentStep)) {
          setCurrentStepIndex(nextIndex);
          setActiveLine(currentStep.lineNum);
          setCurrentVariables(currentStep.variables);
          return;
        }

        nextIndex++;
        
        if (nextIndex % 50 === 0) {
           setTimeout(simulateLoop, 0);
        } else {
           simulateLoop();
        }
      };
      
      simulateLoop();
      return;
    }

  }, [currentStepIndex, evaluateBreakpoint, t, breakpoints]);

  const toggleBreakpoint = useCallback((lineNum: number) => {
    setBreakpoints(prev => {
      if (prev.includes(lineNum)) {
        const next = prev.filter(num => num !== lineNum);
        setBreakpointConditions(conds => {
          const newConds = { ...conds };
          delete newConds[lineNum];
          return newConds;
        });
        return next;
      }
      return [...prev, lineNum];
    });
  }, []);

  const setBreakpointCondition = useCallback((lineNum: number, condition: BreakpointCondition | null) => {
    if (!breakpoints.includes(lineNum)) {
       setBreakpoints(prev => [...prev, lineNum]);
    }
    
    setBreakpointConditions(prev => {
      const next = { ...prev };
      if (condition === null) {
        delete next[lineNum];
      } else {
        next[lineNum] = condition;
      }
      return next;
    });
  }, [breakpoints]);

  const parseTraceLogs = useCallback((traceLogs: string[], autoStart: boolean = false) => {
    const steps: TraceStep[] = [];
    const tempVars: Record<string, string> = {};
    const currentLoopStack: string[] = [];
    const loopIterationCounts: Record<string, number> = {};

    traceLogs.forEach(line => {
      if (!line) return;

      const loopStartMatch = line.match(/^\[TRACE LOOP_START\]\s+(.*)/);
      if (loopStartMatch) {
        const loopId = loopStartMatch[1];
        if (!loopIterationCounts[loopId]) loopIterationCounts[loopId] = 0;
        loopIterationCounts[loopId]++;
        currentLoopStack.push(`${loopId}_iter${loopIterationCounts[loopId]}`);
        return;
      }

      if (line.match(/^\[TRACE LOOP_END\]/)) {
        currentLoopStack.pop();
        return;
      }

      const lineMatch = line.match(/^\[TRACE LINE\]\s+(\d+)/);
      if (lineMatch) {
        steps.push({
          lineNum: parseInt(lineMatch[1], 10),
          variables: { ...tempVars },
          loopPath: currentLoopStack.join(' > '),
          logText: line
        });
      }

      const varMatch = line.match(/^\[TRACE VAR\]\s+([^=]+?)\s*=\s*(.*)/);
      if (varMatch) {
         let keyName = varMatch[1].trim();
         keyName = keyName.replace(/\[([^\]]+)\]/g, '($1)');
         const val = varMatch[2].trim();

         // Split both arrays {...} and records (...) into elements for tree expansion.
         if (!keyName.includes('(') && !keyName.includes('.') && ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('(') && val.endsWith(')')))) {
             Object.keys(tempVars).forEach(k => {
                 if (k.startsWith(`${keyName}(`) || k.startsWith(`${keyName}.`)) delete tempVars[k];
             });

             const content = val.slice(1, -1).trim();
             if (!content) {
                 tempVars[`${keyName}(EMPTY)`] = '';
             } else {
                 const items = [];
                 let current = '';
                 let inQuote = false;
                 let inParen = 0;
                 for(let i=0; i<content.length; i++) {
                     const char = content[i];
                     if (char === '"' && (i === 0 || content[i-1] !== '\\')) {
                         inQuote = !inQuote;
                     } else if ((char === '(' || char === '{' || char === '[') && !inQuote) {
                         inParen++;
                         current += char;
                     } else if ((char === ')' || char === '}' || char === ']') && !inQuote) {
                         inParen--;
                         current += char;
                     } else if (char === ',' && !inQuote && inParen === 0) {
                         items.push(current);
                         current = '';
                     } else {
                         current += char;
                     }
                 }
                 items.push(current);

                 items.forEach((item, i) => {
                     let cleanItem = item.trim();
                     if (cleanItem.startsWith('"') && cleanItem.endsWith('"')) {
                         cleanItem = cleanItem.slice(1, -1).replace(/\\"/g, '"');
                     }
                     tempVars[`${keyName}(${i+1})`] = cleanItem;
                 });
             }
         } else {
             tempVars[keyName] = val;
         }
      }
    });

    setExecutionSteps(steps);
    executionStepsRef.current = steps;

    setIsSimulating(false);
    setCurrentStepIndex(-1);
    setActiveLine(null);
    hitCountsRef.current = {};

    if (steps.length > 0) {
      setCurrentVariables(steps[steps.length - 1].variables || {});
    }

    if (autoStart && steps.length > 0) {
       setTimeout(() => {
         handleSimulateStep('auto_start');
       }, 100);
    }
  }, [handleSimulateStep]);

  return useMemo(() => ({
    executionSteps,
    isSimulating,
    currentStepIndex,
    activeLine,
    currentVariables,
    breakpoints,
    breakpointConditions,
    parseTraceLogs,
    clearSimulation,
    loadSimulation,
    handleSimulateStep,
    toggleBreakpoint,
    setBreakpointCondition
  }), [
    executionSteps, isSimulating, currentStepIndex, activeLine,
    currentVariables, breakpoints, breakpointConditions,
    parseTraceLogs, clearSimulation, loadSimulation,
    handleSimulateStep, toggleBreakpoint, setBreakpointCondition
  ]);
}
