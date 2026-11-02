// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useLayoutEffect, useRef, useState } from 'react';
import type { AiChatMessage } from '@/shared/types/aiTypes';

// Follow new content only while the reader stays near the end of the conversation.
export function useChatScroll(messages: readonly AiChatMessage[], loading: boolean, contextId: string | undefined) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousContext = useRef(contextId);
  const [showLatest, setShowLatest] = useState(false);
  const scrollToLatest = () => {
    following.current = true;
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
    setShowLatest(false);
  };
  const onScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    following.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 48;
    setShowLatest(!following.current);
  };
  useLayoutEffect(() => {
    if (previousContext.current !== contextId) {
      previousContext.current = contextId;
      following.current = true;
    }
    if (following.current) {
      const container = scrollRef.current;
      if (container) container.scrollTop = container.scrollHeight;
      setShowLatest(false);
    }
  }, [messages, loading, contextId]);
  return { scrollRef, onScroll, scrollToLatest, showLatest };
}
