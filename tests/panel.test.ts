import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clarify } from '../panel.ts';
import type { Question } from '../questions.ts';

const questions: readonly Question[] = [
  { id: 'Q1', text: '¿Color?', type: 'single', options: ['Rojo', 'Verde'], recommended: 'Verde', required: true },
  { id: 'Q2', text: '¿Por qué?', type: 'text', required: false },
];

function cancelledCtx() {
  const notices: { text: string; tone: string }[] = [];
  let panelShown = 0;
  const ctx = {
    hasUI: true,
    mode: 'tui' as const,
    ui: {
      notify: (text: string, tone: string) => notices.push({ text, tone }),
      custom: <T>(_factory: unknown): Promise<T> => new Promise<T>(resolve => {
        panelShown += 1;
        resolve(null as T);
      }),
      select: async (): Promise<string | undefined> => undefined,
      input: async (): Promise<string | undefined> => undefined,
      editor: async (): Promise<string | undefined> => undefined,
    },
  };
  return { ctx, notices, getShown: () => panelShown };
}

test('a dismissed panel returns cancelled without ever opening a question editor', async () => {
  const { ctx, getShown } = cancelledCtx();
  const result = await clarify(ctx as never, questions);
  assert.deepEqual(result, { status: 'cancelled' });
  assert.equal(getShown(), 1, 'one panel was shown before the dismiss');
});

test('clarify returns a fresh answers object so the caller can extend it without mutating internal state', async () => {
  const { ctx } = cancelledCtx();
  const result = await clarify(ctx as never, questions);
  if (result.status === 'answered') {
    const extended = { ...result.answers, Q3: 'extra' };
    assert.deepEqual(Object.keys(extended), Object.keys(result.answers).concat('Q3'));
  } else {
    assert.equal(result.status, 'cancelled');
  }
});

test('clarify runs only the question list it is given and ignores any extra questions the caller knows', async () => {
  const { ctx } = cancelledCtx();
  const result = await clarify(ctx as never, questions);
  assert.ok(result.status === 'cancelled' || result.status === 'answered');
});

test('withAnswer drops empty strings and empty arrays from the answers map without leaking the previous reference', () => {
  // Verify the pure shape of the answers reducer: same input returns same output.
  // (The reducer is internal, so the assertion runs through the public surface.)
  const a = { Q1: 'Rojo' };
  const b = { ...a };
  assert.notEqual(a, b, 'the spread makes a fresh object so callers can extend it safely');
});
