// Shared album types. All geometry is in millimetres.

export interface Rect { x: number; y: number; w: number; h: number }

export type LayoutNode =
  | { kind: 'cell' }
  | { kind: 'cols' | 'rows'; sizes: number[]; children: LayoutNode[] };

export type SpreadLayout =
  | { mode: 'spread'; root: LayoutNode; padMm?: number }
  | { mode: 'pages'; left: LayoutNode | null; right: LayoutNode | null; padMm?: number };

/** Centre of the visible area as a fraction of the photo (0..1), and zoom (1..8). */
export interface Crop { cx: number; cy: number; zoom: number }

export interface Cell { photoId: string | null; crop: Crop }

export type TemplateId =
  | 'full' | 'two' | 'ex2' | 'ex1' | 'pano' | 'p12' | 'p14' | 'row3' | 'row4' | 'g8' | 'mat' | 'solo';

export interface Spread { id: string; templateId: TemplateId; layout: SpreadLayout; cells: Cell[]; isCover: boolean }

export type BookStart = 'full-spread' | 'single-right';
export type PageExport = 'bleed' | 'trim';

export interface AlbumSettings {
  gapMm: number;
  marginMm: number;
  background: string;
  bleedMm: number;
  safeMm: number;
  showGuides: boolean;
  bookStart: BookStart;
  pageExport: PageExport;
}

export interface PhotoMeta {
  id: string;
  name: string;
  size: number;
  width: number;
  height: number;
  takenAt: string | null;
  lastModified: number;
}

export interface Album {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastFileSaveAt: number | null;
  settings: AlbumSettings;
  photos: PhotoMeta[];
  spreads: Spread[];
}

export interface CellRef { spreadId: string; cellIndex: number }

/** A border between children `index` and `index + 1` of the node at `path` on one side. */
export interface GutterRef { side: 'spread' | 'left' | 'right'; path: number[]; index: number }

export const DEFAULT_SETTINGS: AlbumSettings = {
  gapMm: 6,
  marginMm: 0,
  background: '#f4efe6',
  bleedMm: 3,
  safeMm: 10,
  showGuides: true,
  bookStart: 'full-spread',
  pageExport: 'bleed',
};

export const EMPTY_CROP: Crop = { cx: 0.5, cy: 0.5, zoom: 1 };
