/**
 * One evening's tokens and where they went. Pure state, unit-tested.
 * The agent only pre-fills tokens (and suggests a bin); sorting is always an
 * explicit user action, by hand or by voice ("take-away test").
 */
import type { BinId } from './desk-layout.ts';

export type TokenSource = 'voice' | 'typed' | 'example' | 'carried';

export interface TokenState {
  id: string;
  text: string;
  detail: string;
  /** Agent suggestion, shown as a faint coloured rim. Never applied automatically. */
  suggestion: BinId | null;
  bin: BinId | null;
  released: boolean;
  source: TokenSource;
}

export interface SortSummary {
  tomorrow: string[];
  later: string[];
  letGo: string[];
  unsorted: string[];
}

interface UndoEntry {
  id: string;
  previous: BinId | null;
}

export const MAX_TOKENS = 8;

export class SortingSession {
  private readonly tokens = new Map<string, TokenState>();
  private readonly undoStack: UndoEntry[] = [];
  private nextId = 1;

  add(text: string, options: { detail?: string; suggestion?: BinId | null; source?: TokenSource } = {}): TokenState {
    const clean = text.replace(/\s+/gu, ' ').trim();
    if (clean.length === 0) {
      throw new Error('A worry token needs some text.');
    }
    if (this.active().length >= MAX_TOKENS) {
      throw new Error('The desk is full. Sort a few first.');
    }
    const token: TokenState = {
      id: `t${this.nextId++}`,
      text: clean,
      detail: options.detail ?? clean,
      suggestion: options.suggestion ?? null,
      bin: null,
      released: false,
      source: options.source ?? 'voice',
    };
    this.tokens.set(token.id, token);
    return token;
  }

  get(id: string): TokenState | undefined {
    return this.tokens.get(id);
  }

  all(): TokenState[] {
    return [...this.tokens.values()];
  }

  /**
   * Per-frame tallies without building arrays (23 Oct): sorted (in a bowl or let go), unsorted on the desk, and the
   * first unsorted token (the onboarding ghost hand demonstrates on it).
   */
  tally(out: { sorted: number; unsorted: number; first: TokenState | null }): typeof out {
    out.sorted = 0;
    out.unsorted = 0;
    out.first = null;
    for (const t of this.tokens.values()) {
      if (t.bin != null || t.released) out.sorted++;
      else {
        out.unsorted++;
        if (out.first == null) out.first = t;
      }
    }
    return out;
  }

  /** Tokens still physically on the desk (not released). */
  active(): TokenState[] {
    return this.all().filter((t) => !t.released);
  }

  unsorted(): TokenState[] {
    return this.all().filter((t) => t.bin == null && !t.released);
  }

  /** Assigns (or clears with null) a bin. Returns the slot index inside the bin, or -1. */
  assign(id: string, bin: BinId | null, recordUndo = true): number {
    const token = this.require(id);
    if (token.released) {
      throw new Error(`Token ${id} was already let go`);
    }
    if (recordUndo && token.bin !== bin) {
      this.undoStack.push({ id, previous: token.bin });
    }
    token.bin = bin;
    if (bin == null) {
      return -1;
    }
    return this.all().filter((t) => t.bin === bin && t.id !== id && !t.released).length;
  }

  release(id: string): void {
    const token = this.require(id);
    if (token.bin !== 'let-go') {
      throw new Error(`Only tokens in "let go" can be released (${id})`);
    }
    token.released = true;
    // A release is final: drop undo entries that would resurrect it.
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      if (this.undoStack[i].id === id) {
        this.undoStack.splice(i, 1);
      }
    }
  }

  /** Removes a token that was captured by mistake ("that's not a worry"). */
  discard(id: string): void {
    const token = this.require(id);
    if (token.released) {
      throw new Error(`Token ${id} was already let go`);
    }
    this.tokens.delete(id);
  }

  /** Reverts the last placement. Returns the affected token, or null. */
  undo(): { token: TokenState; from: BinId | null; to: BinId | null } | null {
    while (this.undoStack.length > 0) {
      const entry = this.undoStack.pop()!;
      const token = this.tokens.get(entry.id);
      if (token == null || token.released) {
        continue;
      }
      const from = token.bin;
      token.bin = entry.previous;
      return { token, from, to: entry.previous };
    }
    return null;
  }

  canUndo(): boolean {
    return this.undoStack.some((e) => {
      const t = this.tokens.get(e.id);
      return t != null && !t.released;
    });
  }

  unsortedIndex(id: string): number {
    return this.unsorted().findIndex((t) => t.id === id);
  }

  binCount(bin: BinId): number {
    return this.all().filter((t) => t.bin === bin).length;
  }

  summary(): SortSummary {
    const pick = (bin: BinId | null) => this.all().filter((t) => t.bin === bin).map((t) => t.text);
    return {
      tomorrow: pick('tomorrow'),
      later: pick('later'),
      letGo: pick('let-go'),
      unsorted: pick(null),
    };
  }

  isComplete(): boolean {
    return this.tokens.size > 0 && this.all().every((t) => t.bin != null);
  }

  private require(id: string): TokenState {
    const token = this.tokens.get(id);
    if (token == null) {
      throw new Error(`Unknown token ${id}`);
    }
    return token;
  }
}
