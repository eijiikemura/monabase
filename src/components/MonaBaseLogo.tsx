// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Import SvgIconProps with the type modifier.
import { SvgIcon, type SvgIconProps } from '@mui/material';

export default function MonaBaseLogo(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 100 100">
      <rect width="100" height="100" fill="#EFEBE9" rx="28"/>
      {/* Position like a stamp in the bottom-right corner. */}
      <g transform="translate(72, 70) rotate(-15) scale(2.2)" fill="#D7CCC8">
        <path d="M -3,-1 C -3,-3 3,-3 3,-1 C 4.5,-0.5 6.5,1.5 6.5,4 C 6.5,7 3,8 0,8 C -3,8 -6.5,7 -6.5,4 C -6.5,1.5 -4.5,-0.5 -3,-1 Z" />
        <ellipse cx="-6.5" cy="-2.5" rx="1.6" ry="2.2" transform="rotate(-35 -6.5 -2.5)" />
        <ellipse cx="-2.5" cy="-6" rx="1.8" ry="2.6" transform="rotate(-12 -2.5 -6)" />
        <ellipse cx="2.5" cy="-6" rx="1.8" ry="2.6" transform="rotate(12 2.5 -6)" />
        <ellipse cx="6.5" cy="-2.5" rx="1.6" ry="2.2" transform="rotate(35 6.5 -2.5)" />
      </g>
      <path d="M10 25 H90 M10 50 H90 M10 75 H90" stroke="#BCAAA4" strokeWidth="2" strokeLinecap="round"/>
      <path d="M25 10 V90 M50 10 V90 M75 10 V90" stroke="#BCAAA4" strokeWidth="2" strokeLinecap="round"/>
      <path d="M25 75 V25 L50 50 L75 25 V75" fill="none" stroke="#6D4C41" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/>
    </SvgIcon>
  );
}