import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createPanel, type PanelSpec } from '@prjct.app/pi-tui-kit';
import { displayOption, missingRequired, optionFromDisplay, responseText, type Answers, type Question } from './questions.ts';

type Intent = { readonly action: 'edit'; readonly id: string } | { readonly action: 'submit' } | { readonly action: 'cancel' };
export type ClarificationResult = { readonly status: 'answered'; readonly answers: Answers; readonly text: string } | { readonly status: 'cancelled' };

type UI = ExtensionContext['ui'];

/** Toggle `option` in `selected`, returning a new array; never mutates. */
const toggle = (selected: readonly string[], option: string): readonly string[] =>
  selected.includes(option) ? selected.filter(each => each !== option) : [...selected, option];

async function choose(question: Question, current: string | readonly string[] | undefined, ui: UI): Promise<string | readonly string[] | undefined> {
  if (question.type === 'text') return ui.editor(question.text, typeof current === 'string' ? current : '');
  const options = [...(question.options ?? [])];
  const displayedOptions = options.map(option => displayOption(question, option));
  if (question.type === 'single') {
    const selected = await ui.select(question.text, [...displayedOptions, 'Otro…']);
    if (selected === 'Otro…') return ui.input(question.text);
    if (selected === undefined) return undefined;
    return optionFromDisplay(question, selected);
  }
  let selected: readonly string[] = Array.isArray(current) ? [...current] : [];
  while (true) {
    const choices = options.map((option, index) => `${selected.includes(option) ? '[x]' : '[ ]'} ${displayedOptions[index]}`);
    const choice = await ui.select(question.text, [...choices, 'Otro…', 'Confirmar selección']);
    if (choice === undefined) return undefined;
    if (choice === 'Confirmar selección') return options.filter(option => selected.includes(option)).concat(selected.filter(option => !options.includes(option)));
    if (choice === 'Otro…') {
      const other = (await ui.input('Otra respuesta'))?.trim();
      if (other) selected = [...selected, other];
      continue;
    }
    const option = optionFromDisplay(question, choice.slice(4));
    selected = toggle(selected, option);
  }
}

/** Everything clarify knows, as one immutable value; every loop step replaces it. */
type SessionState = Readonly<{
  answers: Readonly<Record<string, string | readonly string[]>>;
  focus: string | undefined;
  intent: Intent | undefined;
}>;

const idle = (firstId: string | undefined): SessionState => ({
  answers: {},
  focus: firstId,
  intent: undefined,
});

/** The answer for `id` after `value`, or the answer removed when the value is empty. */
const withAnswer = (answers: Answers, id: string, value: string | readonly string[] | undefined): Answers => {
  if (value === undefined) return answers;
  if (Array.isArray(value) && !value.length) {
    if (!Object.hasOwn(answers, id)) return answers;
    const { [id]: _drop, ...rest } = answers;
    return rest;
  }
  if (typeof value === 'string' && !value.trim()) {
    if (!Object.hasOwn(answers, id)) return answers;
    const { [id]: _drop, ...rest } = answers;
    return rest;
  }
  return { ...answers, [id]: value };
};

/** A docked, keyboard-driven panel: inspect questions, answer them, then submit together. */
export async function clarify(ctx: ExtensionContext, questions: readonly Question[]): Promise<ClarificationResult> {
  if (!ctx.hasUI || ctx.mode !== 'tui') throw new Error('Clarification requires an interactive Pi terminal.');
  let state: SessionState = idle(questions[0]?.id);
  while (true) {
    state = { ...state, intent: undefined };
    const request = (intent: Intent, close: () => void): void => { state = { ...state, intent }; close(); };
    const spec: PanelSpec = {
      title: 'Clarificación',
      summary: () => `${Object.keys(state.answers).length}/${questions.length} respondidas`,
      items: () => questions.map((question, index) => ({
        id: question.id,
        label: `${index + 1}. ${question.text}`,
        symbol: Object.hasOwn(state.answers, question.id) ? '✓' : '○',
        meta: question.required ? 'obligatoria' : 'opcional',
      })),
      detail: item => {
        const question = questions.find(entry => entry.id === item.id)!;
        const answer = state.answers[item.id];
        return {
          title: question.text,
          subtitle: question.type === 'multiple' ? 'Selecciona varias opciones' : question.type === 'single' ? 'Elige una opción' : 'Escribe tu respuesta',
          fields: [{ label: 'Respuesta', value: answer === undefined ? 'Sin respuesta' : Array.isArray(answer) ? answer.join(', ') : String(answer) }],
          sections: question.options?.length ? [{ title: 'Opciones', lines: question.options.map(option => displayOption(question, option)) }] : [],
        };
      },
      initial: state.focus,
      actions: [
        { key: 'a', label: 'Responder', run: (item, panel) => { if (item) request({ action: 'edit', id: item.id }, panel.close); } },
        { key: 's', label: 'Enviar respuestas', run: (_item, panel) => {
          const missing = missingRequired(questions, state.answers);
          if (missing.length) panel.notice(`Faltan ${missing.length} respuestas obligatorias`, 'warning');
          else request({ action: 'submit' }, panel.close);
        } },
      ],
      activate: { label: 'Responder', run: (item, panel) => { if (item) request({ action: 'edit', id: item.id }, panel.close); } },
    };
    await ctx.ui.custom<null>((tui, theme, _keys, done) => createPanel(spec, tui, theme, () => done(null)));
    const intent = state.intent;
    if (!intent || intent.action === 'cancel') return { status: 'cancelled' };
    if (intent.action === 'submit') return { status: 'answered', answers: { ...state.answers }, text: responseText(questions, state.answers) };
    state = { ...state, focus: intent.id };
    const question = questions.find(entry => entry.id === intent.id)!;
    const answer = await choose(question, state.answers[question.id], ctx.ui);
    state = { ...state, answers: withAnswer(state.answers, question.id, answer) };
  }
}
