/** A spec §5.1 player for tests: applies `dom.*` patches to a real DOM and says
 *  what tree it ended up holding. Deliberately UNFORGIVING — every reference to
 *  an id it does not hold throws — because a tolerant test player turns a
 *  dangling reference into silent node loss. Needs the optional `happy-dom`
 *  peer dependency. */
export function createPlayer(keyframe: unknown): {
  root: unknown; node(id: number): unknown; apply(events: unknown[]): void; tree(): unknown;
};
export function readTree(node: unknown, idOf: Map<unknown, number>): unknown;
export function asPlayerTree(node: unknown): unknown;
