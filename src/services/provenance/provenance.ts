/**
 * Input Provenance Service
 *
 * Tracks the origin of messages across orchestrations:
 * - external_user: direct user input
 * - inter_session: messages from other sessions (e.g., shared context, agent-to-agent)
 * - internal_system: system-generated messages (e.g., hooks, automated events)
 */

export const INPUT_PROVENANCE_KIND_VALUES = [
  'external_user',
  'inter_session',
  'internal_system',
] as const;

export type InputProvenanceKind = (typeof INPUT_PROVENANCE_KIND_VALUES)[number];

export type InputProvenance = {
  kind: InputProvenanceKind;
  originSessionId?: string;
  sourceSessionKey?: string;
  sourceChannel?: string;
  sourceTool?: string;
};

function isInputProvenanceKind(value: unknown): value is InputProvenanceKind {
  return (
    typeof value === 'string' &&
    (INPUT_PROVENANCE_KIND_VALUES as readonly string[]).includes(value)
  );
}

export function normalizeInputProvenance(value: unknown): InputProvenance | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!isInputProvenanceKind(record.kind)) {
    return undefined;
  }
  return {
    kind: record.kind,
    originSessionId:
      typeof record.originSessionId === 'string' ? record.originSessionId : undefined,
    sourceSessionKey:
      typeof record.sourceSessionKey === 'string' ? record.sourceSessionKey : undefined,
    sourceChannel:
      typeof record.sourceChannel === 'string' ? record.sourceChannel : undefined,
    sourceTool: typeof record.sourceTool === 'string' ? record.sourceTool : undefined,
  };
}

export function createInputProvenance(params: {
  kind: InputProvenanceKind;
  originSessionId?: string;
  sourceSessionKey?: string;
  sourceChannel?: string;
  sourceTool?: string;
}): InputProvenance {
  return {
    kind: params.kind,
    originSessionId: params.originSessionId,
    sourceSessionKey: params.sourceSessionKey,
    sourceChannel: params.sourceChannel,
    sourceTool: params.sourceTool,
  };
}

export function applyInputProvenanceToUserMessage<T extends { role?: unknown; provenance?: unknown }>(
  message: T,
  inputProvenance: InputProvenance | undefined,
): T {
  if (!inputProvenance) {
    return message;
  }
  if ((message as { role?: unknown }).role !== 'user') {
    return message;
  }
  const existing = normalizeInputProvenance((message as { provenance?: unknown }).provenance);
  if (existing) {
    return message;
  }
  return {
    ...message,
    provenance: inputProvenance,
  } as T;
}

export function isInterSessionInputProvenance(value: unknown): boolean {
  return normalizeInputProvenance(value)?.kind === 'inter_session';
}

export function isExternalUserProvenance(value: unknown): boolean {
  return normalizeInputProvenance(value)?.kind === 'external_user';
}

export function isInternalSystemProvenance(value: unknown): boolean {
  return normalizeInputProvenance(value)?.kind === 'internal_system';
}
