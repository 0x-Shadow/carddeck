/**
 * Outline model + pure reducers.
 *
 * The outline is the editable skeleton the AI produces in stage 1 and the user
 * refines before stage 2 generates full card content. These reducers are pure:
 * each returns a new array and never mutates the input.
 */
export interface OutlineCard {
  id: string;
  title: string;
  intent: string;
}

/** Move the card at index `from` to index `to`. */
export function moveOutlineCard(cards: OutlineCard[], from: number, to: number): OutlineCard[] {
  const next = cards.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Insert `card` at index `afterIndex`, shifting the existing card at that
 * index (and everything after) to the right. `afterIndex === cards.length`
 * appends at the end.
 */
export function addOutlineCard(cards: OutlineCard[], afterIndex: number, card: OutlineCard): OutlineCard[] {
  const next = cards.slice();
  next.splice(afterIndex, 0, card);
  return next;
}

/** Remove the card with the given id. */
export function removeOutlineCard(cards: OutlineCard[], id: string): OutlineCard[] {
  return cards.filter((c) => c.id !== id);
}

/** Rename the card with the given id. */
export function renameOutlineCard(cards: OutlineCard[], id: string, title: string): OutlineCard[] {
  return cards.map((c) => (c.id === id ? { ...c, title } : c));
}
