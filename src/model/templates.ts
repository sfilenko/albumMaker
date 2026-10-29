import type { LayoutNode, SpreadLayout, TemplateId } from './types';

// A column of the source array: `w` is the column size, `r` are its row sizes.
interface Col { w: number; r: number[] }
interface Source {
  id: TemplateId;
  name: string;
  note: string;
  mine?: boolean;
  pad?: number;
  spread?: Col[];
  L?: Col[];
  R?: Col[];
}

// Copied verbatim from the array `T` in .superpowers/brainstorm/1839-1793216938/content/templates-v2.html.
const T: Source[] = [
  { id:'full', name:'Одне фото на весь розворот', note:'Ваш основний варіант. Lay Flat не ховає центр.', mine:true, spread:[{w:1,r:[1]}] },
  { id:'two', name:'По фото на сторінку', note:'Ваш приклад 3: проміжок по згину.', mine:true, L:[{w:1,r:[1]}], R:[{w:1,r:[1]}] },
  { id:'ex2', name:'Велике + 2 / 2 + велике', note:'Ваш приклад 2: 6 фото, дзеркально.', mine:true, L:[{w:1,r:[1]},{w:1.05,r:[1.2,1]}], R:[{w:1.1,r:[0.8,1.2]},{w:1,r:[1]}] },
  { id:'ex1', name:'Мозаїка з 6 фото', note:'Ваш приклад 1: різні висоти рядів.', mine:true, L:[{w:1,r:[1.6,1]},{w:1,r:[1,1.6]}], R:[{w:1,r:[1,1.6]}] },
  { id:'pano', name:'Панорама + два', note:'Велике фото через згин, збоку два.', spread:[{w:2.2,r:[1]},{w:1,r:[1,1]}] },
  { id:'p12', name:'Фото + два', note:'Ліва сторінка ціла, права ділиться навпіл.', L:[{w:1,r:[1]}], R:[{w:1,r:[1,1]}] },
  { id:'p14', name:'Фото + сітка 4', note:'Герой ліворуч, деталі праворуч.', L:[{w:1,r:[1]}], R:[{w:1,r:[1,1]},{w:1,r:[1,1]}] },
  { id:'row3', name:'Три в ряд', note:'Послідовність: перший танець, торт.', spread:[{w:1,r:[1]},{w:1,r:[1]},{w:1,r:[1]}] },
  { id:'row4', name:'Чотири вертикальні', note:'По два вертикальні фото на сторінку.', L:[{w:1,r:[1]},{w:1,r:[1]}], R:[{w:1,r:[1]},{w:1,r:[1]}] },
  { id:'g8', name:'Сітка 2×2 на кожній сторінці', note:'8 фото: деталі, гості.', L:[{w:1,r:[1,1]},{w:1,r:[1,1]}], R:[{w:1,r:[1,1]},{w:1,r:[1,1]}] },
  { id:'mat', name:'Фото з широкими полями', note:'Одне фото на сторінку в рамці з тла.', pad:35, L:[{w:1,r:[1]}], R:[{w:1,r:[1]}] },
  { id:'solo', name:'Одне фото з полями + пуста сторінка', note:'Пауза в альбомі, акцент на одному кадрі.', pad:35, L:[{w:1,r:[1]}], R:[] },
];

export const TEMPLATES: { id: TemplateId; name: string; note: string; mine: boolean }[] = T.map((t) => ({
  id: t.id,
  name: t.name,
  note: t.note,
  mine: t.mine ?? false,
}));

// A column with one row is a cell; a page with one column is that column.
function column(c: Col): LayoutNode {
  if (c.r.length === 1) return { kind: 'cell' };
  return { kind: 'rows', sizes: [...c.r], children: c.r.map(() => ({ kind: 'cell' })) };
}

function columns(cs: Col[] | undefined): LayoutNode | null {
  if (!cs || cs.length === 0) return null;
  if (cs.length === 1) return column(cs[0]);
  return { kind: 'cols', sizes: cs.map((c) => c.w), children: cs.map(column) };
}

export function templateLayout(id: TemplateId): SpreadLayout {
  const t = T.find((x) => x.id === id);
  if (!t) throw new Error(`unknown template: ${id}`);
  const pad = t.pad === undefined ? {} : { padMm: t.pad };
  if (t.spread) return { mode: 'spread', root: columns(t.spread)!, ...pad };
  return { mode: 'pages', left: columns(t.L), right: columns(t.R), ...pad };
}

function nodeCells(n: LayoutNode | null): number {
  if (!n) return 0;
  if (n.kind === 'cell') return 1;
  return n.children.reduce((sum, c) => sum + nodeCells(c), 0);
}

export function cellCount(layout: SpreadLayout): number {
  return layout.mode === 'spread' ? nodeCells(layout.root) : nodeCells(layout.left) + nodeCells(layout.right);
}
