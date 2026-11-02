// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useId, type MouseEvent } from 'react';
import { Button, Menu, MenuItem } from '@mui/material';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';

interface HelpMenuProps {
  anchorEl: HTMLElement | null;
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
  onClose: () => void;
  onAbout: () => void;
}

export default function HelpMenu({ anchorEl, onOpen, onClose, onAbout }: HelpMenuProps) {
  const { t, i18n } = useTranslation();
  const menuId = useId();
  const open = Boolean(anchorEl);
  const manualUrl = `https://eijiikemura.github.io/monabase/${i18n.language === 'ja' ? 'ja/' : ''}guides/getting-started/`;

  const openManual = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onClose();
    try {
      await ipcRenderer.invoke('open-external', manualUrl);
    } catch {
      window.alert(t('failed_to_open_external_link'));
    }
  };

  return (
    <>
      <Button color="inherit" onClick={onOpen} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} sx={{ textTransform: 'none' }}>
        {t('help')}
      </Button>
      <Menu id={menuId} anchorEl={anchorEl} open={open} onClose={onClose}>
        <MenuItem component="a" href={manualUrl} onClick={openManual}>
          <MenuBookOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'action.active' }} />
          {t('online_manual')}
        </MenuItem>
        <MenuItem onClick={() => { onClose(); onAbout(); }}>
          <InfoOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'action.active' }} />
          {t('about')}
        </MenuItem>
      </Menu>
    </>
  );
}
