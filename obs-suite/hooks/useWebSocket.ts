'use client';

/**
 * useWebSocket Hook
 *
 * Provides WebSocket connection management for both controller and display clients
 *
 * Features:
 * - Auto-connect on mount
 * - Auto-reconnect with exponential backoff
 * - Type-safe message sending and receiving
 * - Connection status tracking
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  WebSocketMessage,
  ClientType,
  ConnectMessage,
  CommandMessage,
  StateUpdate,
  PongMessage,
} from '../lib/websocket/types';
import {
  generateClientId,
  parseMessage,
  serializeMessage,
  isPingMessage,
} from '../lib/websocket/types';

// ============================================================================
// Types
// ============================================================================

export interface UseWebSocketOptions {
  clientType: ClientType;
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  autoReconnect?: boolean;
}

export interface UseWebSocketReturn {
  connected: boolean;
  send: (message: Omit<WebSocketMessage, 'timestamp'>) => void;
  disconnect: () => void;
  reconnect: () => void;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Build WebSocket URL from current window location
 * - Uses same hostname and port as the page
 * - Switches protocol: http -> ws, https -> wss
 */
function getWebSocketUrl(): string {
  if (typeof window === 'undefined') {
    // SSR fallback - use NEXT_PUBLIC_PORT or default to 3000
    const port = process.env.NEXT_PUBLIC_PORT || '3000';
    const hostname = process.env.NEXT_PUBLIC_HOSTNAME || 'localhost';
    return `ws://${hostname}:${port}/ws`;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const hostname = window.location.hostname;
  const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');

  return `${protocol}//${hostname}:${port}/ws`;
}

const WS_URL = getWebSocketUrl();

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]; // Max 30 seconds
const MAX_RECONNECT_ATTEMPTS = -1; // Infinite retries

// ============================================================================
// Hook Implementation
// ============================================================================

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const { clientType, onMessage, onConnect, onDisconnect, autoReconnect = true } = options;

  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(generateClientId());
  const reconnectAttemptRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intentionalDisconnectRef = useRef(false);
  const mountedRef = useRef(true);

  /**
   * Send a message through WebSocket
   */
  const send = useCallback((message: Omit<WebSocketMessage, 'timestamp'>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const fullMessage: WebSocketMessage = {
        ...message,
        timestamp: Date.now(),
      } as WebSocketMessage;

      wsRef.current.send(serializeMessage(fullMessage));
    } else {
      console.warn('[WS] Cannot send message: WebSocket not connected');
    }
  }, []);

  /**
   * Handle incoming WebSocket message
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    const message = parseMessage(event.data);

    if (!message) {
      console.error('[WS] Failed to parse message:', event.data);
      return;
    }

    // Auto-respond to ping messages
    if (isPingMessage(message)) {
      const pong: PongMessage = {
        type: 'pong',
        timestamp: Date.now(),
      };
      send(pong);
      return;
    }

    // Pass message to callback
    if (onMessage) {
      onMessage(message);
    }
  }, [onMessage, send]);

  /**
   * Connect to WebSocket server
   */
  const connect = useCallback(() => {
    // Don't connect if component unmounted
    if (!mountedRef.current) return;

    // Prevent multiple connection attempts
    if (wsRef.current?.readyState === WebSocket.CONNECTING ||
        wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    console.log(`[WS] Connecting as ${clientType}...`);

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close();
          return;
        }

        console.log(`[WS] Connected as ${clientType}`);
        setConnected(true);
        reconnectAttemptRef.current = 0;

        // Send connect message
        const connectMsg: ConnectMessage = {
          type: 'connect',
          clientType,
          clientId: clientIdRef.current,
          timestamp: Date.now(),
        };
        ws.send(serializeMessage(connectMsg));

        if (onConnect) {
          onConnect();
        }
      };

      ws.onmessage = handleMessage;

      ws.onclose = () => {
        if (!mountedRef.current) return;

        console.log('[WS] Disconnected');
        setConnected(false);
        wsRef.current = null;

        if (onDisconnect) {
          onDisconnect();
        }

        // Auto-reconnect if enabled and not intentionally disconnected
        if (autoReconnect && !intentionalDisconnectRef.current) {
          scheduleReconnect();
        }
      };

      ws.onerror = (error) => {
        console.error('[WS] Error:', error);
      };
    } catch (error) {
      console.error('[WS] Connection failed:', error);
      if (autoReconnect && !intentionalDisconnectRef.current && mountedRef.current) {
        scheduleReconnect();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientType]); // Only depend on clientType

  /**
   * Schedule reconnection with exponential backoff
   */
  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;

    // Clear any existing timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    // Check if we should retry
    if (MAX_RECONNECT_ATTEMPTS >= 0 && reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[WS] Max reconnect attempts reached');
      return;
    }

    // Calculate delay with exponential backoff
    const delayIndex = Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS.length - 1);
    const delay = RECONNECT_DELAYS[delayIndex];

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current + 1})`);

    reconnectTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      reconnectAttemptRef.current++;
      connect();
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // No dependencies - uses refs

  /**
   * Disconnect from WebSocket server
   */
  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnected(false);
  }, []);

  /**
   * Manually trigger reconnection
   */
  const reconnect = useCallback(() => {
    intentionalDisconnectRef.current = false;
    reconnectAttemptRef.current = 0;
    disconnect();
    setTimeout(() => connect(), 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // No dependencies - uses refs

  // Auto-connect on mount
  useEffect(() => {
    mountedRef.current = true;
    intentionalDisconnectRef.current = false;
    connect();

    // Cleanup on unmount
    return () => {
      mountedRef.current = false;
      intentionalDisconnectRef.current = true;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run once on mount

  return {
    connected,
    send,
    disconnect,
    reconnect,
  };
}
