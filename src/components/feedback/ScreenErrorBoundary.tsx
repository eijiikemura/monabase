// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Component } from 'react';
import type { ReactNode } from 'react';

interface ScreenErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

export default class ScreenErrorBoundary extends Component<ScreenErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
