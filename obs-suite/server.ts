#!/usr/bin/env node
/**
 * Custom Next.js Server with WebSocket Support
 *
 * This server integrates:
 * - Next.js request handling (for pages, API routes, static files)
 * - WebSocket server (for real-time communication between controller and displays)
 *
 * Usage:
 *   pnpm dev              # Development mode (default port 3000)
 *   pnpm start            # Production mode (default port 3000)
 *   PORT=8080 pnpm dev    # Custom port
 *
 * Environment Variables:
 *   PORT      Server port (default: 3000)
 *   HOSTNAME  Server hostname (default: localhost)
 */

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  WebSocketMessage,
  ClientType,
  ConnectMessage,
  CommandMessage,
  StateUpdate,
  PingMessage,
  PongMessage,
} from './lib/websocket/types';
import {
  parseMessage,
  serializeMessage,
  isConnectMessage,
  isStateUpdate,
  isPongMessage,
  generateClientId,
} from './lib/websocket/types';

// ============================================================================
// Configuration
// ============================================================================

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3006', 10);

// ============================================================================
// Next.js Setup
// ============================================================================

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// ============================================================================
// WebSocket Client Tracking
// ============================================================================

interface ClientInfo {
  ws: WebSocket;
  type: ClientType;
  id: string;
  lastPong: number;  // Timestamp of last pong response
}

const clients = new Map<string, ClientInfo>();

// ============================================================================
// WebSocket Message Handlers
// ============================================================================

/**
 * Handle incoming WebSocket message
 */
function handleMessage(clientId: string, data: WebSocket.Data): void {
  // Parse message
  const rawData = data.toString();
  const message = parseMessage(rawData);

  if (!message) {
    console.error(`[WS] Invalid message from ${clientId}:`, rawData);
    sendError(clientId, 'Invalid message format');
    return;
  }

  const client = clients.get(clientId);
  if (!client) {
    console.error(`[WS] Unknown client ${clientId}`);
    return;
  }

  // Route message based on type
  if (isConnectMessage(message)) {
    handleConnect(clientId, message);
  } else if (isPongMessage(message)) {
    handlePong(clientId);
  } else if (isStateUpdate(message)) {
    handleStateUpdate(clientId, message);
  } else {
    // Assume it's a command message - broadcast to all displays
    handleCommand(clientId, message as CommandMessage);
  }
}

/**
 * Handle client connection
 */
function handleConnect(clientId: string, message: ConnectMessage): void {
  const client = clients.get(clientId);
  if (!client) return;

  client.type = message.clientType;
  client.id = message.clientId || clientId;

  console.log(`[WS] Client connected: ${message.clientType} (${client.id})`);
}

/**
 * Handle pong response (heartbeat)
 */
function handlePong(clientId: string): void {
  const client = clients.get(clientId);
  if (!client) return;

  client.lastPong = Date.now();
}

/**
 * Handle state update from display
 */
function handleStateUpdate(clientId: string, message: StateUpdate): void {
  // Broadcast state update to all controllers
  broadcastToType('controller', message, clientId);
}

/**
 * Handle command from controller
 */
function handleCommand(clientId: string, message: CommandMessage): void {
  console.log(`[WS] Command from ${clientId}:`, message.type);

  // Broadcast command to all displays
  broadcastToType('display', message, clientId);
}

// ============================================================================
// WebSocket Broadcasting
// ============================================================================

/**
 * Broadcast message to all clients of a specific type
 */
function broadcastToType(
  type: ClientType,
  message: WebSocketMessage,
  excludeClientId?: string
): void {
  const serialized = serializeMessage(message);

  for (const [id, client] of clients.entries()) {
    const shouldSend =
      client.type === type &&
      id !== excludeClientId &&
      client.ws.readyState === WebSocket.OPEN;

    if (shouldSend) {
      client.ws.send(serialized);
    }
  }
}

/**
 * Send message to specific client
 */
function sendToClient(clientId: string, message: WebSocketMessage): void {
  const client = clients.get(clientId);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(serializeMessage(message));
  }
}

/**
 * Send error message to client
 */
function sendError(clientId: string, errorMsg: string): void {
  const errorMessage = {
    type: 'error',
    timestamp: Date.now(),
    error: errorMsg,
  };
  sendToClient(clientId, errorMessage as WebSocketMessage);
}

// ============================================================================
// Heartbeat (Keep-Alive)
// ============================================================================

const HEARTBEAT_INTERVAL = 30000;  // 30 seconds
const HEARTBEAT_TIMEOUT = 60000;   // 60 seconds

/**
 * Send ping to all clients
 */
function sendHeartbeat(): void {
  const now = Date.now();
  const pingMessage: PingMessage = {
    type: 'ping',
    timestamp: now,
  };

  for (const [id, client] of clients.entries()) {
    // Check if client is still alive (responded to last ping)
    if (now - client.lastPong > HEARTBEAT_TIMEOUT) {
      console.log(`[WS] Client timeout: ${id}`);
      client.ws.terminate();
      clients.delete(id);
      continue;
    }

    // Send ping
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(serializeMessage(pingMessage));
    }
  }
}

// ============================================================================
// WebSocket Server Setup
// ============================================================================

/**
 * Initialize WebSocket server
 */
function setupWebSocketServer(server: ReturnType<typeof createServer>): void {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
  });

  wss.on('connection', (ws: WebSocket) => {
    // Generate temporary client ID
    const clientId = generateClientId();

    // Register client
    clients.set(clientId, {
      ws,
      type: 'controller',  // Default, will be updated on connect message
      id: clientId,
      lastPong: Date.now(),
    });

    console.log(`[WS] New connection: ${clientId} (${clients.size} total)`);

    // Handle messages
    ws.on('message', (data) => {
      handleMessage(clientId, data);
    });

    // Handle close
    ws.on('close', () => {
      console.log(`[WS] Client disconnected: ${clientId}`);
      clients.delete(clientId);
    });

    // Handle error
    ws.on('error', (err) => {
      console.error(`[WS] Error from ${clientId}:`, err);
      clients.delete(clientId);
    });
  });

  // Start heartbeat interval
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

  console.log(`[WS] WebSocket server ready on ws://${hostname}:${port}/ws`);
}

// ============================================================================
// HTTP Server Setup
// ============================================================================

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      // Parse URL
      const parsedUrl = parse(req.url!, true);

      // Let Next.js handle the request
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error handling request:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  // Setup WebSocket server on same port
  setupWebSocketServer(server);

  // Start listening
  server.listen(port, () => {
    const httpUrl = `http://${hostname}:${port}`;
    const wsUrl = `ws://${hostname}:${port}/ws`;
    const envLabel = dev ? 'development' : 'production';

    console.log(`
  Server ready on ${httpUrl}
  WebSocket ready on ${wsUrl}
  Environment: ${envLabel}
    `);
  });
});
