/**
 * Session Lifecycle Events
 *
 * Pub/sub system for session state changes.
 * Subscribe to receive notifications when sessions are created, destroyed,
 * or have significant state transitions.
 */

export type SessionLifecycleEvent = {
  sessionKey: string;
  reason: string;
  parentSessionKey?: string;
  label?: string;
  displayName?: string;
  timestamp: number;
};

type SessionLifecycleListener = (event: SessionLifecycleEvent) => void;

const SESSION_LIFECYCLE_LISTENERS = new Set<SessionLifecycleListener>();

/**
 * Subscribe to session lifecycle events.
 * Returns an unsubscribe function.
 */
export function onSessionLifecycleEvent(listener: SessionLifecycleListener): () => void {
  SESSION_LIFECYCLE_LISTENERS.add(listener);
  return () => {
    SESSION_LIFECYCLE_LISTENERS.delete(listener);
  };
}

/**
 * Emit a session lifecycle event to all subscribers.
 * Best-effort delivery — errors in one listener don't affect others.
 */
export function emitSessionLifecycleEvent(event: SessionLifecycleEvent): void {
  for (const listener of SESSION_LIFECYCLE_LISTENERS) {
    try {
      listener(event);
    } catch {
      // Best-effort, do not propagate listener errors.
    }
  }
}

/**
 * Emit a session-created event.
 */
export function emitSessionCreated(params: {
  sessionKey: string;
  parentSessionKey?: string;
  label?: string;
  displayName?: string;
}): void {
  emitSessionLifecycleEvent({
    sessionKey: params.sessionKey,
    reason: 'created',
    parentSessionKey: params.parentSessionKey,
    label: params.label,
    displayName: params.displayName,
    timestamp: Date.now(),
  });
}

/**
 * Emit a session-destroyed event.
 */
export function emitSessionDestroyed(params: {
  sessionKey: string;
  reason?: string;
}): void {
  emitSessionLifecycleEvent({
    sessionKey: params.sessionKey,
    reason: params.reason ?? 'destroyed',
    timestamp: Date.now(),
  });
}

/**
 * Emit a session-paused/resumed event.
 */
export function emitSessionStateChange(params: {
  sessionKey: string;
  state: 'paused' | 'resumed' | 'backgrounded' | 'foregrounded';
  label?: string;
}): void {
  emitSessionLifecycleEvent({
    sessionKey: params.sessionKey,
    reason: params.state,
    label: params.label,
    timestamp: Date.now(),
  });
}
