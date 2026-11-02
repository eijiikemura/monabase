// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export const environmentColors = { neutral: '#757575', blue: '#1976d2', green: '#2e7d32', orange: '#ed6c02', red: '#d32f2f', purple: '#7b1fa2' } as const;
export function environmentColor(value?: string) { return value && Object.hasOwn(environmentColors, value) ? environmentColors[value as keyof typeof environmentColors] : environmentColors.neutral; }
