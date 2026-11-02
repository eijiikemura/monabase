// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { KeyboardEvent } from 'react';

export const sidebarObjectKey = (schema: string, type: string, name: string, signature = '', tableName = '') =>
  JSON.stringify([schema, type, name, signature, tableName]);

// Leave ordinary buttons and text fields to their native keyboard behavior.
export function navigateSidebar(event: KeyboardEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  if (target !== event.currentTarget) return;
  const row = event.currentTarget;
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    if (!row.hasAttribute('data-sidebar-object')) return;
    event.preventDefault();
    const box = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: box.left + 16, clientY: box.bottom }));
    return;
  }
  const rows = Array.from(row.closest('[data-sidebar-list]')?.querySelectorAll<HTMLElement>('[data-sidebar-row]') || [])
    .filter(item => item.getClientRects().length && !item.closest('[aria-hidden="true"]'));
  const index = rows.indexOf(row), level = Number(row.dataset.sidebarLevel);
  const expanded = row.getAttribute('aria-expanded');
  let next: HTMLElement | undefined;
  if (event.key === 'ArrowDown') next = rows[index + 1];
  else if (event.key === 'ArrowUp') next = rows[index - 1];
  else if (event.key === 'ArrowRight') {
    if (expanded === 'false') row.click();
    else if (Number(rows[index + 1]?.dataset.sidebarLevel) > level) next = rows[index + 1];
  } else if (event.key === 'ArrowLeft') {
    if (expanded === 'true') row.click();
    else next = rows.slice(0, index).reverse().find(item => Number(item.dataset.sidebarLevel) < level);
  } else if (event.key === 'Enter' && row.hasAttribute('data-sidebar-object')) {
    event.preventDefault(); row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return;
  } else return;
  event.preventDefault();
  next?.focus();
}
