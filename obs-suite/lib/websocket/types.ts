/**
 * WebSocket Message Type Definitions
 *
 * Defines all message types for communication between:
 * - Controller (sends commands)
 * - Display (executes commands, sends state updates)
 * - Server (broadcasts messages)
 */

// ============================================================================
// Base Types
// ============================================================================

/**
 * Base message structure for all WebSocket messages
 */
export interface WebSocketMessage {
  type: string;
  timestamp: number;  // Unix timestamp in milliseconds
}

/**
 * Client types for connection identification
 */
export type ClientType = 'controller' | 'display';

// ============================================================================
// Command Messages (Controller → Server → Display)
// ============================================================================

/**
 * Load a video on display clients
 */
export interface LoadVideoCommand extends WebSocketMessage {
  type: 'load_video';
  videoPath: string;    // e.g., "/api/out/final-vids/prada.mp4"
  tracksPath: string;   // e.g., "/api/out/final-json/prada.json"
  autoplay?: boolean;   // Default: false
}

/**
 * Play the current video
 */
export interface PlayCommand extends WebSocketMessage {
  type: 'play';
}

/**
 * Pause the current video
 */
export interface PauseCommand extends WebSocketMessage {
  type: 'pause';
}

/**
 * Seek to a specific time in the video
 */
export interface SeekCommand extends WebSocketMessage {
  type: 'seek';
  time: number;  // seconds (float)
}

/**
 * Set playback rate (optional, for future use)
 */
export interface SetRateCommand extends WebSocketMessage {
  type: 'set_rate';
  rate: number;  // e.g., 0.5, 1.0, 1.5, 2.0
}

/**
 * Union type of all command messages
 */
export type CommandMessage =
  | LoadVideoCommand
  | PlayCommand
  | PauseCommand
  | SeekCommand
  | SetRateCommand;

// ============================================================================
// State Messages (Display → Server → Controller)
// ============================================================================

/**
 * Video player state
 */
export interface VideoState {
  playing: boolean;
  currentTime: number;  // seconds (float)
  duration: number;     // seconds (float)
  rate: number;         // playback rate
  videoPath?: string;   // current video path (if loaded)
}

/**
 * State update message from display to controller
 */
export interface StateUpdate extends WebSocketMessage {
  type: 'state_update';
  state: VideoState;
  clientId: string;  // ID of the display client sending the update
}

// ============================================================================
// Connection Lifecycle Messages
// ============================================================================

/**
 * Client connection message
 */
export interface ConnectMessage extends WebSocketMessage {
  type: 'connect';
  clientType: ClientType;
  clientId: string;  // Unique client identifier
}

/**
 * Client disconnection message
 */
export interface DisconnectMessage extends WebSocketMessage {
  type: 'disconnect';
  clientId: string;
}

// ============================================================================
// Heartbeat Messages (Keep-Alive)
// ============================================================================

/**
 * Ping message from server
 */
export interface PingMessage extends WebSocketMessage {
  type: 'ping';
}

/**
 * Pong response from client
 */
export interface PongMessage extends WebSocketMessage {
  type: 'pong';
}

// ============================================================================
// Server Broadcast Messages
// ============================================================================

/**
 * Broadcast wrapper for server messages
 */
export interface ServerBroadcast extends WebSocketMessage {
  type: 'broadcast';
  command: CommandMessage;
  sourceClientId?: string;  // ID of the client that sent the original command
}

// ============================================================================
// Error Messages
// ============================================================================

/**
 * Error message
 */
export interface ErrorMessage extends WebSocketMessage {
  type: 'error';
  error: string;
  details?: string;
}

// ============================================================================
// Message Union Types
// ============================================================================

/**
 * All possible message types
 */
export type AnyMessage =
  | CommandMessage
  | StateUpdate
  | ConnectMessage
  | DisconnectMessage
  | PingMessage
  | PongMessage
  | ServerBroadcast
  | ErrorMessage;

// ============================================================================
// Type Guards
// ============================================================================

export function isLoadVideoCommand(msg: WebSocketMessage): msg is LoadVideoCommand {
  return msg.type === 'load_video';
}

export function isPlayCommand(msg: WebSocketMessage): msg is PlayCommand {
  return msg.type === 'play';
}

export function isPauseCommand(msg: WebSocketMessage): msg is PauseCommand {
  return msg.type === 'pause';
}

export function isSeekCommand(msg: WebSocketMessage): msg is SeekCommand {
  return msg.type === 'seek';
}

export function isSetRateCommand(msg: WebSocketMessage): msg is SetRateCommand {
  return msg.type === 'set_rate';
}

export function isStateUpdate(msg: WebSocketMessage): msg is StateUpdate {
  return msg.type === 'state_update';
}

export function isConnectMessage(msg: WebSocketMessage): msg is ConnectMessage {
  return msg.type === 'connect';
}

export function isDisconnectMessage(msg: WebSocketMessage): msg is DisconnectMessage {
  return msg.type === 'disconnect';
}

export function isPingMessage(msg: WebSocketMessage): msg is PingMessage {
  return msg.type === 'ping';
}

export function isPongMessage(msg: WebSocketMessage): msg is PongMessage {
  return msg.type === 'pong';
}

export function isServerBroadcast(msg: WebSocketMessage): msg is ServerBroadcast {
  return msg.type === 'broadcast';
}

export function isErrorMessage(msg: WebSocketMessage): msg is ErrorMessage {
  return msg.type === 'error';
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a unique client ID
 */
export function generateClientId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse a WebSocket message from JSON string
 */
export function parseMessage(data: string): WebSocketMessage | null {
  try {
    const msg = JSON.parse(data);
    if (typeof msg === 'object' && msg !== null && 'type' in msg && 'timestamp' in msg) {
      return msg as WebSocketMessage;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Serialize a message to JSON string
 */
export function serializeMessage(msg: WebSocketMessage): string {
  return JSON.stringify(msg);
}
