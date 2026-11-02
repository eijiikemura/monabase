// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Button, Menu, MenuItem } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import HistoryIcon from '@mui/icons-material/History';
import { useTranslation } from 'react-i18next';
import AiUsageHistoryDialog from './AiUsageHistoryDialog';

interface Props {
  onOpenSettings: () => void;
  outputDateFormat: string;
}

export default function AiMenu({ onOpenSettings, outputDateFormat }: Props) {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <>
      <Button
        color="inherit"
        onClick={event => setAnchorEl(event.currentTarget)}
        sx={{ textTransform: 'none' }}
      >AI</Button>
      <Menu
        anchorEl={anchorEl} open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        <MenuItem onClick={() => { setAnchorEl(null); onOpenSettings(); }}>
          <AutoAwesomeIcon
            fontSize="small" sx={{ mr: 1, color: 'action.active' }}
          />
          {t("ai_settings")}
        </MenuItem>
        <MenuItem onClick={() => {
          setAnchorEl(null);
          setHistoryOpen(true);
        }}>
          <HistoryIcon
            fontSize="small" sx={{ mr: 1, color: 'action.active' }}
          />
          {t("ai_usage_history")}
        </MenuItem>
      </Menu>
      <AiUsageHistoryDialog
        open={historyOpen} onClose={() => setHistoryOpen(false)}
        outputDateFormat={outputDateFormat}
      />
    </>
  );
}
