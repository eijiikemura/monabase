// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Divider, Link, IconButton, Tooltip,
  Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import GitHubIcon from '@mui/icons-material/GitHub';
import XIcon from '@mui/icons-material/X';
import { useTranslation } from 'react-i18next';
import MonaBaseLogo from './MonaBaseLogo';
import licenseText from "../../LICENSE?raw";
import { ipcRenderer } from "../shared/api/desktop";

// Read the notice from the bundled license instead of inventing a copyright year.
const copyrightNotice = licenseText.match(/^\s*Copyright[^\r\n]+/m)?.[0].trim();

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function AboutDialog({ open, onClose }: AboutDialogProps) {
  const { t, i18n } = useTranslation();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const websiteUrl = `https://eijiikemura.github.io/monabase/${i18n.language === 'ja' ? 'ja/' : ''}`;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setAppVersion(null);
    const fetchVersion = async () => {
      try {
        const ver = await ipcRenderer.invoke('get-app-version');
        if (active && typeof ver === 'string' && ver.trim()) {
          setAppVersion(ver);
        }
      } catch {
        if (active) setAppVersion(null);
      }
    };
    void fetchVersion();
    return () => { active = false; };
  }, [open]);

  const handleOpenUrl = useCallback(async (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    try {
      await ipcRenderer.invoke('open-external', url);
    } catch {
      window.alert(t('failed_to_open_external_link'));
    }
  }, [t]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ textAlign: 'center', pt: 3, pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
          <MonaBaseLogo sx={{ fontSize: 56 }} />
        </Box>
        <Typography variant="h5" fontWeight="bold">
          MonaBase
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('database_management_tool')}
        </Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ py: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">{t("version")}</Typography>
            <Typography variant="body2" fontWeight="bold">{appVersion ? `v${appVersion}` : t('unknown')}</Typography>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">{t('supported_databases')}</Typography>
            <Typography variant="body2" align="right">Oracle Database 12+ / PostgreSQL</Typography>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">{t("website")}</Typography>
            <Link
              href={websiteUrl}
              onClick={(e) => handleOpenUrl(e, websiteUrl)}
              variant="body2"
              sx={{ cursor: 'pointer', textDecoration: 'none', overflowWrap: 'anywhere', textAlign: 'right' }}
            >
              {websiteUrl.replace('https://', '')}
            </Link>
          </Box>

          <Divider sx={{ my: 0.5 }} />

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">{t("license")}</Typography>
            <Typography variant="body2" color="success.main" fontWeight="bold">
              Apache License 2.0
            </Typography>
          </Box>
          
          {/* Keep the original license available offline in packaged builds. */}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, lineHeight: 1.5, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
            {t('provided_as_is_under_license')}
            <br />
            {t('see_full_license_for_terms')}
          </Typography>

          <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="about-license-content" id="about-license-heading">
              <Typography variant="body2">{t('full_license_text')}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Box
                component="pre"
                tabIndex={0}
                sx={{ m: 0, maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.75rem', lineHeight: 1.6 }}
              >
                {licenseText}
              </Box>
            </AccordionDetails>
          </Accordion>

          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
            {t('third_party_components_license_notice')}
          </Typography>

          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5 }}>
            {[
              { name: 'GitHub', url: 'https://github.com/eijiikemura/monabase', icon: <GitHubIcon fontSize="small" /> },
              { name: 'X', url: 'https://x.com/eijiikemura', icon: <XIcon fontSize="small" /> },
            ].map(({ name, url, icon }) => (
              <Tooltip key={name} title={name}>
                <IconButton
                  component="a"
                  href={url}
                  aria-label={name}
                  size="small"
                  onClick={(e) => handleOpenUrl(e, url)}
                  sx={{ color: 'text.secondary', opacity: 0.75, '&:hover': { color: 'text.primary', opacity: 1 } }}
                >
                  {icon}
                </IconButton>
              </Tooltip>
            ))}
          </Box>

          {copyrightNotice && (
            <Typography variant="caption" color="text.secondary" align="center" sx={{ mt: 1 }}>
              {copyrightNotice}
            </Typography>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} variant="contained" fullWidth disableElevation>
          {t("close")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
