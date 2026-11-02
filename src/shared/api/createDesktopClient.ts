// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { Invoke, DesktopEvents, EventListener } from './desktopContract';

export interface DesktopTransport {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (...args: unknown[]) => void): () => void;
}

const LOADING_CHANNELS = new Set([
  'execute-sql', 'execute-ddl-batch', 'save-postgres-trigger', 'save-oracle-trigger', 'save-oracle-dblink', 'execute-stored', 'execute-trace', 'commit-db',
  'rollback-db', 'get-objects', 'get-columns', 'explain-sql', 'mutate-oracle-directory', 'mutate-oracle-object-privileges'
]);

export function createDesktopClient(transport: DesktopTransport, onLoading: (loading: boolean) => void) {
  const filePermissions = new Map<string, string>();
  let loadingCount = 0;
  let generation = 0;
  const subscribers = new Set<(pending: boolean) => void>();
  const eventSubscriptions = new Map<string, Map<unknown, () => void>>();

  const beginGlobalLoading = () => {
    const loadingGeneration = generation;
    let finished = false;
    if (++loadingCount === 1) onLoading(true);
    return () => {
      if (finished) return;
      finished = true;
      if (loadingGeneration === generation && --loadingCount === 0) onLoading(false);
    };
  };

  const invokeRequest: DesktopTransport['invoke'] = async (channel, ...args) => {
    const requestGeneration = generation;
    const skipLoading = args.some(arg => arg && typeof arg === 'object' &&
      'skipGlobalLoader' in arg && arg.skipGlobalLoader === true);
    const showLoading = LOADING_CHANNELS.has(channel) && !skipLoading;
    const cleanArgs = args.map(arg => {
      if (arg && typeof arg === 'object' && 'skipGlobalLoader' in arg) {
        const copy = { ...arg };
        delete copy.skipGlobalLoader;
        return copy;
      }
      return arg;
    });
    const finishLoading = showLoading ? beginGlobalLoading() : undefined;
    try {
      if (channel === 'save-file') cleanArgs[3] = filePermissions.get(String(cleanArgs[0]));
      const response = await transport.invoke(channel, ...cleanArgs);
      if (channel === 'show-save-dialog' && response && typeof response === 'object' &&
          'filePath' in response && typeof response.filePath === 'string' && 'writeToken' in response && typeof response.writeToken === 'string') {
        if (filePermissions.size >= 128) filePermissions.delete(filePermissions.keys().next().value!);
        filePermissions.set(response.filePath, response.writeToken);
      }
      if (requestGeneration === generation && channel !== 'execute-sql-bg' && response &&
        typeof response === 'object' && 'hasUncommittedTx' in response && typeof response.hasUncommittedTx === 'boolean') {
        for (const subscriber of subscribers) subscriber(response.hasUncommittedTx);
      }
      return response;
    } finally {
      finishLoading?.();
    }
  };

  const resetGlobalLoading = () => {
    generation += 1;
    loadingCount = 0;
    onLoading(false);
  };

  return {
    // The bridge is the serialization boundary; callers use the channel contract.
    invoke: invokeRequest as Invoke,
    on<C extends keyof DesktopEvents>(channel: C, listener: EventListener<C>) {
      let callbacks = eventSubscriptions.get(channel);
      if (!callbacks) { callbacks = new Map(); eventSubscriptions.set(channel, callbacks); }
      if (callbacks.has(listener)) return;
      const forward = (_event: unknown, ...args: unknown[]) => listener(undefined, ...args as DesktopEvents[C]);
      callbacks.set(listener, transport.on(channel, forward));
    },
    removeListener<C extends keyof DesktopEvents>(channel: C, listener: EventListener<C>) {
      const callbacks = eventSubscriptions.get(channel);
      callbacks?.get(listener)?.();
      callbacks?.delete(listener);
      if (callbacks?.size === 0) eventSubscriptions.delete(channel);
    },
    subscribeTransactionState(listener: (pending: boolean) => void) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
        if (subscribers.size === 0) resetGlobalLoading();
      };
    },
    resetGlobalLoading,
    beginGlobalLoading
  };
}
