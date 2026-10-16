// Editor themes. Colors come from CSS variables (see styles.css) so chrome and editor stay in sync.
import * as CM from './vendor/codemirror.js';

const { view: V, language: L, tags: t } = CM;

const base = {
  '&': { color: 'var(--ed-fg)', backgroundColor: 'var(--ed-bg)', height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--ed-font)', fontSize: 'var(--ed-font-size)', lineHeight: 'var(--ed-line-height)' },
  '.cm-content': { caretColor: 'var(--ed-caret)', padding: '6px 0 40vh' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ed-caret)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--ed-selection) !important' },
  '.cm-activeLine': { backgroundColor: 'var(--ed-active-line)' },
  '.cm-gutters': { backgroundColor: 'var(--ed-bg)', color: 'var(--ed-gutter-fg)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 16px', minWidth: '32px' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--ed-active-line)', color: 'var(--ed-fg)' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', cursor: 'pointer', color: 'var(--ed-gutter-fg)' },
  '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--ed-fg)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--ed-fold-bg)', border: '1px solid var(--ed-fold-border)', color: 'var(--ed-fold-fg)',
    borderRadius: '4px', padding: '0 6px', margin: '0 4px',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--ed-match)', outline: '1px solid var(--ed-match-border)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'transparent', outline: '1px solid var(--ed-bracket)' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--ed-invalid-bg)' },
  '.cm-searchMatch': { backgroundColor: 'var(--ed-search)', outline: '1px solid var(--ed-search-border)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--ed-search-selected)' },
  '.cm-specialChar': { color: 'var(--ed-invalid-fg)' },
  '.cm-highlightSpace': { backgroundImage: 'radial-gradient(circle at 50% 55%, var(--ed-whitespace) 11%, transparent 5%)' },
  '.cm-highlightTab': { backgroundImage: 'none', position: 'relative' },
  '.cm-panels': { backgroundColor: 'var(--mcode-bg-secondary)', color: 'var(--mcode-text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--mcode-border)' },
  '.cm-panel.cm-search': { padding: '8px 12px', fontFamily: 'var(--ui-font)', fontSize: '12px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': { fontSize: '12px' },
  '.cm-textfield': {
    backgroundColor: 'var(--mcode-surface-muted)', color: 'var(--mcode-text)', border: '1px solid var(--mcode-border)',
    borderRadius: '6px', padding: '4px 8px',
  },
  '.cm-textfield:focus': { outline: '2px solid var(--mcode-accent)', outlineOffset: '-1px' },
  '.cm-button': {
    backgroundImage: 'none', backgroundColor: 'var(--mcode-surface-muted)', color: 'var(--mcode-text)',
    border: '1px solid var(--mcode-border)', borderRadius: '6px', padding: '4px 10px',
  },
  '.cm-button:hover': { backgroundColor: 'var(--mcode-hover)' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--mcode-text-muted)', fontSize: '16px', right: '8px' },
  '.cm-tooltip': {
    backgroundColor: 'var(--mcode-surface)', color: 'var(--mcode-text)', border: '1px solid var(--mcode-border)',
    borderRadius: '8px', boxShadow: '0 4px 20px rgb(0 0 0 / 18%)', overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--ed-font)', fontSize: '12px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--mcode-accent)', color: '#fff' },
  '.cm-minimap-gutter': { borderLeft: '1px solid var(--ed-minimap-border)' },
  '.cm-minimap-overlay': { backgroundColor: 'var(--ed-minimap-overlay)' },
};

export const darkTheme = V.EditorView.theme(base, { dark: true });
export const lightTheme = V.EditorView.theme(base, { dark: false });

export const highlight = L.HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--sx-comment)', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--sx-string)' },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.unit], color: 'var(--sx-number)' },
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier], color: 'var(--sx-keyword)' },
  { tag: [t.operator, t.compareOperator, t.logicOperator, t.arithmeticOperator, t.derefOperator], color: 'var(--sx-operator)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: 'var(--sx-function)' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: 'var(--sx-definition)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: 'var(--sx-type)', fontStyle: 'var(--sx-type-style)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--sx-property)' },
  { tag: [t.self, t.special(t.variableName), t.local(t.variableName)], color: 'var(--sx-special)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--sx-keyword)' },
  { tag: [t.labelName, t.macroName, t.constant(t.variableName)], color: 'var(--sx-number)' },
  { tag: [t.meta, t.processingInstruction, t.annotation], color: 'var(--sx-meta)' },
  { tag: [t.escape], color: 'var(--sx-number)' },
  { tag: t.heading, color: 'var(--sx-function)', fontWeight: '600' },
  { tag: [t.heading1, t.heading2], color: 'var(--sx-function)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--sx-type)', textDecoration: 'underline' },
  { tag: [t.quote, t.monospace], color: 'var(--sx-string)' },
  { tag: t.inserted, color: 'var(--sx-function)' },
  { tag: t.deleted, color: 'var(--sx-keyword)' },
  { tag: t.changed, color: 'var(--sx-string)' },
  { tag: t.invalid, color: 'var(--ed-invalid-fg)', backgroundColor: 'var(--ed-invalid-bg)' },
  { tag: [t.punctuation, t.separator, t.bracket], color: 'var(--sx-punctuation)' },
]);
