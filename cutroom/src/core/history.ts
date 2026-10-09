export interface VersionMeta {
  id: string;
  parentId: string | null;
  /** 1-based number shown to the user ("Version 3"). */
  n: number;
  label: string;
  author: 'ai' | 'user' | 'system';
  createdAt: string;
  summary?: string;
  ops?: unknown[];
}

export interface History {
  versions: VersionMeta[];
  head: string | null;
  /** parent id → child we came from with Undo (so Redo returns to the same branch). */
  redo: Record<string, string>;
}

export const emptyHistory = (): History => ({ versions: [], head: null, redo: {} });

export function commit(h: History, meta: Omit<VersionMeta, 'parentId' | 'n' | 'createdAt'> & { createdAt?: string }): History {
  const v: VersionMeta = { ...meta, parentId: h.head, n: h.versions.length + 1, createdAt: meta.createdAt ?? new Date().toISOString() };
  const redo = { ...h.redo };
  if (h.head) delete redo[h.head];
  return { versions: [...h.versions, v], head: v.id, redo };
}

export const getVersion = (h: History, id: string | null) => h.versions.find((v) => v.id === id) ?? null;

export function canUndo(h: History) {
  return !!getVersion(h, h.head)?.parentId;
}

export function undo(h: History): History {
  const cur = getVersion(h, h.head);
  if (!cur?.parentId) return h;
  return { ...h, head: cur.parentId, redo: { ...h.redo, [cur.parentId]: cur.id } };
}

function redoTarget(h: History): string | null {
  if (!h.head) return null;
  const remembered = h.redo[h.head];
  if (remembered && getVersion(h, remembered)) return remembered;
  const kids = h.versions.filter((v) => v.parentId === h.head);
  return kids.length ? kids[kids.length - 1].id : null;
}

export const canRedo = (h: History) => !!redoTarget(h);

export function redo(h: History): History {
  const id = redoTarget(h);
  if (!id) return h;
  const r = { ...h.redo };
  delete r[h.head!];
  return { ...h, head: id, redo: r };
}

export function checkout(h: History, id: string): History {
  if (!getVersion(h, id)) throw new Error(`Version ${id} not found`);
  return { ...h, head: id };
}
