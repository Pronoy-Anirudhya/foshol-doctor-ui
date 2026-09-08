import type { CaseStatus } from '../../generated/models/case-status';

/**
 * The **wire** event names, as `docs/handover/frontend-demo-api.md` §10 defines them.
 *
 * The OpenAPI prose lists enum-style names (`CASE_STATUS_CHANGED`, …) that the server does not
 * actually put in the `event:` field. Binding to the prose would produce a client that reports
 * a healthy stream and silently ignores every frame on it, which is the worst possible failure
 * mode for a demo. Handover §10 is the authority here; §15 records the discrepancy.
 */
export const SSE_EVENT = {
  caseStatus: 'case-status',
  advisory: 'advisory',
  queue: 'queue',
  /**
   * The officer's resolution-KPI warning. Lowercase on the wire like every other name here —
   * the OpenAPI prose's `RESOLUTION_KPI_WARNING` is not what lands in the `event:` field.
   */
  kpi: 'kpi',
  resync: 'resync',
  reconnect: 'reconnect',
} as const;

export type SseEventName = (typeof SSE_EVENT)[keyof typeof SSE_EVENT];

/** The `type` discriminator carried INSIDE an `advisory` frame's data. */
export type AdvisoryEventType = 'ADVISORY_PUBLISHED' | 'ADVISORY_REVISED' | 'CASE_REJECTED';

export const ADVISORY_PUBLISHED: AdvisoryEventType = 'ADVISORY_PUBLISHED';
export const ADVISORY_REVISED: AdvisoryEventType = 'ADVISORY_REVISED';
export const CASE_REJECTED: AdvisoryEventType = 'CASE_REJECTED';

export interface CaseStatusEventData {
  readonly notificationId?: string;
  readonly caseId: string;
  readonly correlationId?: string;
  readonly fromStatus?: CaseStatus | null;
  readonly toStatus: CaseStatus;
}

export interface AdvisoryEventData {
  readonly notificationId?: string;
  readonly caseId: string;
  readonly correlationId?: string;
  readonly advisoryId?: string | null;
  readonly type: AdvisoryEventType;
  readonly titleBn?: string | null;
  readonly bodyBn?: string | null;
}

/** The `kind` discriminator carried INSIDE a `kpi` frame's data. */
export type KpiEventKind = 'RESOLUTION_WARN';

export const RESOLUTION_WARN: KpiEventKind = 'RESOLUTION_WARN';

export interface QueueEventData {
  readonly caseId: string;
  readonly toStatus: CaseStatus;
  readonly correlationId?: string;
}

/**
 * A resolution-KPI warning for a task this officer holds. It carries no prose at all — the
 * backend sends no Bangla for KPI — so every word the bell shows for one is chrome from this
 * application's own catalogue.
 *
 * `reviewTaskId` is the deep-link target: the console is addressed by task, not by case.
 */
export interface KpiEventData {
  readonly caseId: string;
  readonly reviewTaskId: string;
  readonly kind: KpiEventKind;
  readonly dueAt: string;
  readonly correlationId?: string;
}

const CASE_STATUSES: readonly string[] = [
  'SUBMITTED',
  'ANALYSING',
  'ANALYSED',
  'IN_REVIEW',
  'ADVISED',
  'REJECTED',
  'FAILED',
];

const ADVISORY_TYPES: readonly string[] = [ADVISORY_PUBLISHED, ADVISORY_REVISED, CASE_REJECTED];

const KPI_KINDS: readonly string[] = [RESOLUTION_WARN];

/**
 * A frame's `data` is attacker-adjacent input as far as this client is concerned: it is
 * parsed, validated and either understood or dropped. A malformed frame never throws out of
 * the read loop, because throwing there would tear down the connection (WEB-FR-352).
 */
export function parseJson(data: string): Record<string, unknown> | null {
  if (data.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const status = (v: unknown): CaseStatus | null =>
  typeof v === 'string' && CASE_STATUSES.includes(v) ? (v as CaseStatus) : null;

export function toCaseStatusEvent(data: string): CaseStatusEventData | null {
  const raw = parseJson(data);
  if (raw === null) return null;
  const caseId = str(raw['caseId']);
  const toStatus = status(raw['toStatus']);
  if (caseId === null || toStatus === null) return null;
  return {
    caseId,
    toStatus,
    fromStatus: status(raw['fromStatus']),
    // The server's id for this notification. Absent on older frames, so it stays optional; the
    // notification centre dedupes on it when it is there (WEB-FR-358 replays on resync).
    notificationId: str(raw['notificationId']) ?? undefined,
    correlationId: str(raw['correlationId']) ?? undefined,
  };
}

export function toAdvisoryEvent(data: string): AdvisoryEventData | null {
  const raw = parseJson(data);
  if (raw === null) return null;
  const caseId = str(raw['caseId']);
  const typeValue = raw['type'];
  if (caseId === null || typeof typeValue !== 'string' || !ADVISORY_TYPES.includes(typeValue)) return null;
  return {
    caseId,
    type: typeValue as AdvisoryEventType,
    advisoryId: str(raw['advisoryId']),
    titleBn: str(raw['titleBn']),
    bodyBn: str(raw['bodyBn']),
    /** See `toCaseStatusEvent` — the dedupe key for the notification centre. */
    notificationId: str(raw['notificationId']) ?? undefined,
    correlationId: str(raw['correlationId']) ?? undefined,
  };
}

export function toQueueEvent(data: string): QueueEventData | null {
  const raw = parseJson(data);
  if (raw === null) return null;
  const caseId = str(raw['caseId']);
  const toStatus = status(raw['toStatus']);
  if (caseId === null || toStatus === null) return null;
  return { caseId, toStatus, correlationId: str(raw['correlationId']) ?? undefined };
}

export function toKpiEvent(data: string): KpiEventData | null {
  const raw = parseJson(data);
  if (raw === null) return null;
  const caseId = str(raw['caseId']);
  const reviewTaskId = str(raw['reviewTaskId']);
  const dueAt = str(raw['dueAt']);
  const kindValue = raw['kind'];
  // Whitelisted like the advisory `type`: an unlisted kind is a frame this build does not
  // understand, and an understood-looking frame with a missing task id would produce a bell
  // row whose link resolves to nothing.
  if (caseId === null || reviewTaskId === null || dueAt === null) return null;
  if (typeof kindValue !== 'string' || !KPI_KINDS.includes(kindValue)) return null;
  return {
    caseId,
    reviewTaskId,
    dueAt,
    kind: kindValue as KpiEventKind,
    correlationId: str(raw['correlationId']) ?? undefined,
  };
}
