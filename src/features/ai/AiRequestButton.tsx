// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { forwardRef, memo } from 'react';
import { IconButton, type IconButtonProps } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTranslation } from 'react-i18next';

type Props = Omit<IconButtonProps, 'children' | 'color' | 'size' | 'disableRipple'>;

// Share the SQL generation button's border, radius, colors, and size across AI actions.
const AiRequestButton = forwardRef<HTMLButtonElement, Props>(function AiRequestButton(
  { sx = [], ...props }, ref
) {
  const { t } = useTranslation();
  return (
    <IconButton {...props} ref={ref} color="primary" size="small" disableRipple
      aria-label={props['aria-label'] || props.title || t("ask_ai")}
      sx={[
        { border: '1px solid', borderColor: 'divider', borderRadius: 1 },
        ...(Array.isArray(sx) ? sx : [sx])
      ]}>
      <AutoAwesomeIcon />
    </IconButton>
  );
});

export default memo(AiRequestButton);
