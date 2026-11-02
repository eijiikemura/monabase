// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import * as React from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Box } from '@mui/material';

interface GridViewportProps {
  active: boolean;
  children: ReactNode;
}

// Keep the measurement container mounted while hidden tabs defer their grid.
export function GridViewport({ active, children }: GridViewportProps) {
  const container = React.useRef<HTMLDivElement>(null);
  const [ready, setReady] = React.useState(false);

  React.useLayoutEffect(() => {
    const element = container.current;
    if (!active || !element) {
      setReady(false);
      return;
    }
    let observing = true;
    const hasSize = () => {
      const { width, height } = element.getBoundingClientRect();
      return width > 0 && height > 0;
    };
    // Initial sizing runs in a layout effect, where React already commits before paint.
    setReady(hasSize());
    const observer = new ResizeObserver(() => {
      if (!observing) return;
      const visible = hasSize();
      if (visible) setReady(true);
      // MUI defers resize measurements to animation frames. Unmount before a
      // previously queued frame can measure a container that just collapsed.
      else flushSync(() => setReady(false));
    });
    observer.observe(element);
    return () => {
      observing = false;
      observer.disconnect();
    };
  }, [active]);

  return (
    <Box ref={container} sx={{ flexGrow: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {active && ready ? children : null}
    </Box>
  );
}
