// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface Notice {
    id: number;
    message: string;
    createdAt: number;
    severity: 'success' | 'info' | 'warning' | 'error';
    actionLabel?: string;
    onAction?: () => void;
}
type Listener = (notice: Notice) => void;
const listeners = new Set<Listener>();
const historyListeners = new Set<() => void>();
export function subscribeNotificationHistory(listener: () => void) {
    historyListeners.add(listener);
    return () => { historyListeners.delete(listener); };
}
export function openNotificationHistory() { historyListeners.forEach(listener => listener()); }
let sequence = 0;
export function subscribeNotices(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function notify(message: string, options: Partial<Pick<Notice, 'severity' | 'actionLabel' | 'onAction'>> = {}) {
    const notice: Notice = { id: ++sequence, createdAt: Date.now(), message: String(message), severity: 'error', ...options };
    if (listeners.size) {
        for (const listener of listeners)
            listener(notice);
        // A feedback event supports embedded consumers without moving focus.
        if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined')
            window.dispatchEvent(new CustomEvent('monabase-notification', { detail: { message: notice.message, severity: notice.severity } }));
    }
    else if (typeof alert === 'function') {
        // Standalone consumers without the application host retain their existing feedback.
        alert(notice.message);
    }
}
