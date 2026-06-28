/**
 * Per-compaction archive derivation.
 *
 * Pi's SessionManager persists every entry to JSONL — including
 * `CompactionEntry` records that mark where the SDK summarised and
 * dropped older messages from the in-memory context. The chat UI
 * reads `session.messages` (the post-compaction view); without
 * something like this module the user's pre-compaction history
 * appears to vanish.
 *
 * This module reads the full entries array, walks each compaction,
 * and produces a `CompactionEvent[]` shape the client renders as
 * inline "Compacted N messages → Y tokens" cards with the archived
 * messages one click away.
 *
 * Shape contract:
 * - `id`            — the CompactionEntry's id (stable across reloads)
 * - `timestamp`     — when the compaction happened (ISO 8601)
 * - `summary`       — the SDK-generated prose summary
 * - `tokensBefore`  — context size at the moment of compaction
 * - `insertBeforeIndex` — index in the post-compaction `session.messages`
 *                          array where the card should render. The card
 *                          appears IMMEDIATELY ABOVE the message at
 *                          this index — i.e. between messages[i-1] and
 *                          messages[i]. When 0, the card renders at the
 *                          very top of the chat (the entire pre-
 *                          compaction history was archived).
 * - `archivedMessages` — the AgentMessage[] that the SDK removed from
 *                        the context. Rendered through the existing
 *                        Message component when the user expands the
 *                        card. Slice is from "the compaction immediately
 *                        before this one (or session start)" up to but
 *                        not including the new compaction.
 *
 * Ported from a reference compaction history module.
 */
import type { AgentSession, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface CompactionEvent {
  id: string;
  timestamp: string;
  summary: string;
  tokensBefore: number;
  /** Estimated token count of the kept context AFTER compaction (SDK 0.79.8+).
   *  Derived by walking kept message entries from firstKeptEntryId using a
   *  char/4 heuristic — same approach the SDK uses at compaction time. */
  estimatedTokensAfter?: number;
  insertBeforeIndex: number;
  archivedMessages: AgentMessage[];
}

interface CompactionEntryShape {
  type: "compaction";
  id: string;
  timestamp: string;
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
}

interface MessageEntryShape {
  type: "message";
  id: string;
  timestamp: string;
  message: AgentMessage;
}

function isCompactionEntry(e: SessionEntry): e is SessionEntry & CompactionEntryShape {
  return e.type === "compaction";
}

function isMessageEntry(e: SessionEntry): e is SessionEntry & MessageEntryShape {
  return e.type === "message";
}

/**
 * Walk `session.sessionManager.getEntries()` once and produce one
 * CompactionEvent per CompactionEntry. The mapping back to a position
 * in `session.messages` is the tricky part: the post-compaction
 * messages array is rebuilt from the entries that come AT or AFTER
 * the latest compaction's `firstKeptEntryId`, with the compaction
 * summary itself synthesised in. We compute `insertBeforeIndex` by
 * counting how many "kept" message entries appear in `messages`
 * before the position where this compaction's first-kept entry lands.
 */
export function buildCompactionHistory(session: AgentSession): CompactionEvent[] {
  const entries = session.sessionManager.getEntries();
  const compactions: (SessionEntry & CompactionEntryShape)[] = [];
  for (const e of entries) if (isCompactionEntry(e)) compactions.push(e);
  if (compactions.length === 0) return [];

  // Walk entries in order; for each compaction event, capture the
  // message entries between the previous compaction (or session start)
  // and this one. Those are the "archived" messages — the ones that
  // were summarised and dropped.
  const events: CompactionEvent[] = [];
  let archiveBuffer: AgentMessage[] = [];
  for (const entry of entries) {
    if (isMessageEntry(entry)) {
      archiveBuffer.push(entry.message);
      continue;
    }
    if (isCompactionEntry(entry)) {
      // Estimate what the kept context size was AFTER this compaction
      // by counting tokens for all message entries from firstKeptEntryId
      // to the end of the entries array.
      const estimatedTokensAfter = estimateKeptTokens(entries, entry.firstKeptEntryId);

      events.push({
        id: entry.id,
        timestamp: entry.timestamp,
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
        estimatedTokensAfter: estimatedTokensAfter > 0 ? estimatedTokensAfter : undefined,
        // Filled in below — depends on the index of `firstKeptEntryId`
        // within the *kept* portion of the messages stream.
        insertBeforeIndex: 0,
        archivedMessages: archiveBuffer,
      });
      // Reset for the next archive window. Anything between this
      // compaction and the next one (or end of session) belongs to
      // the next event's archive — but only if there IS a next
      // compaction. If not, those messages live in `session.messages`
      // and don't need archiving.
      archiveBuffer = [];
    }
  }

  // Compute insertBeforeIndex for each event. Given a compaction whose
  // firstKeptEntryId points at message-entry M, the number of message
  // entries BEFORE M (within the post-this-compaction kept portion of
  // the entries array) tells us where to splice the card.
  //
  // For the LAST compaction, the kept portion lines up with what
  // session.messages actually contains, so we can count message
  // entries from `firstKeptEntryId` forward up to the compaction's
  // own position. Earlier compactions' kept portions were re-archived
  // by later compactions — those events sit at the TOP of the
  // (current) display, so insertBeforeIndex = 0 for all but the last.
  // (Once a compaction's kept window has itself been archived, no
  // post-compaction message in `session.messages` corresponds to it,
  // so the only sensible position is "before everything else".)
  for (let i = 0; i < events.length - 1; i++) {
    const ev = events[i];
    if (ev !== undefined) ev.insertBeforeIndex = 0;
  }
  const last = events[events.length - 1];
  if (last !== undefined) {
    const lastCompaction = compactions[compactions.length - 1];
    if (lastCompaction !== undefined) {
      last.insertBeforeIndex = countMessagesBetween(
        entries,
        lastCompaction.firstKeptEntryId,
        lastCompaction.id,
      );
    }
  }

  return events;
}

/**
 * Estimate token count for a single message using char/4 heuristic.
 * Mirrors the SDK's `estimateTokens()` in `core/compaction/compaction.ts`.
 */
function estimateMessageTokens(msg: AgentMessage): number {
  const m = msg as unknown as Record<string, unknown>;
  let chars = 0;

  // Roles with a `content` field: user, assistant, toolResult, custom
  const content = m.content;
  if (typeof content === "string") {
    chars += content.length;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        chars += b.text.length;
      } else if (b.type === "thinking" && typeof b.thinking === "string") {
        chars += b.thinking.length;
      } else if (b.type === "toolCall") {
        chars += typeof b.name === "string" ? b.name.length : 0;
        try {
          chars += typeof b.arguments === "string"
            ? b.arguments.length
            : JSON.stringify(b.arguments).length;
        } catch { /* skip unstringifiable */ }
      } else if (b.type === "image") {
        chars += 4800; // ESTIMATED_IMAGE_CHARS — same value as the SDK
      }
    }
  }

  // compactionSummary / branchSummary roles: carry `summary` instead of `content`
  if (typeof m.summary === "string") {
    chars = m.summary.length;
  }
  // bashExecution: carries `command` + `output`
  if (typeof m.command === "string") {
    chars += m.command.length;
  }
  if (typeof m.output === "string") {
    chars += m.output.length;
  }

  return Math.ceil(chars / 4);
}

/**
 * Walk message entries from `firstKeptEntryId` to the end of the entries
 * array and estimate their total tokens. This gives us the
 * `estimatedTokensAfter` — the approximate size of the kept context
 * right after compaction.
 */
function estimateKeptTokens(entries: SessionEntry[], firstKeptEntryId: string): number {
  const startIdx = entries.findIndex((e) => e.id === firstKeptEntryId);
  if (startIdx === -1) return 0;
  let total = 0;
  for (let i = startIdx; i < entries.length; i++) {
    const e = entries[i];
    if (e === undefined) break;
    if (isMessageEntry(e)) {
      total += estimateMessageTokens(e.message);
    }
  }
  return total;
}

/**
 * Count message-typed entries between two entry ids (exclusive of the
 * end id). Returns the position where the compaction card should
 * splice into `session.messages`. When `firstKeptEntryId` doesn't
 * resolve (legacy session, manual JSONL edit), returns 0 — the card
 * lands at the top of the chat, which is the safe fallback.
 */
function countMessagesBetween(
  entries: SessionEntry[],
  firstKeptEntryId: string,
  endEntryId: string,
): number {
  const startIdx = entries.findIndex((e) => e.id === firstKeptEntryId);
  if (startIdx === -1) return 0;
  let count = 0;
  for (let i = startIdx; i < entries.length; i++) {
    const e = entries[i];
    if (e === undefined) break;
    if (e.id === endEntryId) break;
    if (isMessageEntry(e)) count++;
  }
  return count;
}
