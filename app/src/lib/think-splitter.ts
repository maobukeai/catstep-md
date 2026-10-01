/**
 * think-splitter.ts — streaming <think>…</think> splitter for agent replies.
 *
 * Reasoning models emit their thinking inside <think> tags, and the tags
 * arrive FRAGMENTED across stream chunks ('</thi' + 'nk>' can straddle a
 * TCP boundary). This state machine consumes chunks and reports what
 * belongs to the message's `thought` field vs its visible `content`,
 * holding back only a trailing partial tag so nothing flickers into the
 * wrong field.
 *
 * Extracted verbatim from AgentPanel.vue's processChunkForThinking (which
 * had grown to 130 lines of inline state) so the edge cases are unit
 * tested: split tags, tag-in-one-chunk, open+close in one chunk, and the
 * final flush.
 */

export interface ThinkFeedResult {
  /** Text to append to the message's `thought` field ('' when none). */
  thoughtDelta: string;
  /** Text to append to the message's `content` field ('' when none).
   *  Post-think content is trimStart()ed, mirroring the original logic. */
  contentDelta: string;
  /** Set when the think section closed during this feed: elapsed ms since
   *  the first fed chunk (the panel stores it as thoughtDurationMs). */
  closedDurationMs?: number;
}

const CLOSE_PARTIALS = ['</think', '</thin', '</thi', '</th', '</t', '</', '<'];
const START_PARTIALS = ['<think', '<thin', '<thi', '<th', '<t', '<'];

export class ThinkTagSplitter {
  private inside = false;
  private startedAt: number | null = null;
  private buffer = '';

  get isInside(): boolean {
    return this.inside;
  }

  get startedAtMs(): number | null {
    return this.startedAt;
  }

  reset(): void {
    this.inside = false;
    this.startedAt = null;
    this.buffer = '';
  }

  /**
   * Final flush when the stream ends: no partial-tag holdback — everything
   * still buffered goes to whichever field the state says.
   */
  flush(): { thoughtDelta: string; contentDelta: string } {
    const out = {
      thoughtDelta: this.inside ? this.buffer : '',
      contentDelta: this.inside ? '' : this.buffer,
    };
    this.buffer = '';
    return out;
  }

  /** Feed one streamed chunk. `now` is injectable for tests. */
  feed(chunk: string, now: number = Date.now()): ThinkFeedResult {
    if (this.startedAt === null) {
      this.startedAt = now;
    }
    const result: ThinkFeedResult = { thoughtDelta: '', contentDelta: '' };
    const text = this.buffer + chunk;
    this.buffer = '';

    // Already inside the think section.
    if (this.inside) {
      if (text.includes('</think>')) {
        const parts = text.split('</think>');
        result.thoughtDelta = parts[0];
        const restContent = parts.slice(1).join('</think>');
        this.inside = false;
        if (this.startedAt !== null) {
          result.closedDurationMs = now - this.startedAt;
        }
        if (restContent) {
          result.contentDelta = restContent.trimStart();
        }
      } else {
        const matchedPartial = CLOSE_PARTIALS.find((p) => text.endsWith(p)) ?? '';
        if (matchedPartial) {
          result.thoughtDelta = text.slice(0, -matchedPartial.length);
          this.buffer = matchedPartial;
        } else {
          result.thoughtDelta = text;
        }
      }
      return result;
    }

    // An opening <think> somewhere in this chunk (possibly several full
    // open/close pairs if the model crams them in).
    if (text.includes('<think>')) {
      const parts = text.split('<think>');
      const preContent = parts[0];
      const rest = parts.slice(1).join('<think>');
      // Both halves append to the message's content field — one delta.
      let contentOut = '';
      if (preContent) {
        contentOut += preContent;
      }
      this.inside = true;

      if (rest.includes('</think>')) {
        const subParts = rest.split('</think>');
        result.thoughtDelta = subParts[0];
        const restContent = subParts.slice(1).join('</think>');
        this.inside = false;
        if (this.startedAt !== null) {
          result.closedDurationMs = now - this.startedAt;
        }
        if (restContent) {
          contentOut += restContent.trimStart();
        }
      } else {
        const matchedPartial = CLOSE_PARTIALS.find((p) => rest.endsWith(p)) ?? '';
        if (matchedPartial) {
          result.thoughtDelta = rest.slice(0, -matchedPartial.length);
          this.buffer = matchedPartial;
        } else {
          result.thoughtDelta = rest;
        }
      }
      result.contentDelta = contentOut;
      return result;
    }

    // Plain content — but hold back a trailing partial opening tag.
    const matchedStart = START_PARTIALS.find((p) => text.endsWith(p)) ?? '';
    if (matchedStart) {
      result.contentDelta = text.slice(0, -matchedStart.length);
      this.buffer = matchedStart;
    } else {
      result.contentDelta = text;
    }
    return result;
  }
}
