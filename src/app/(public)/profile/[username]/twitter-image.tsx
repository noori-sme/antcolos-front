/**
 * X / Twitter uses the same card as Open Graph.
 *
 * Re-exported rather than duplicated: two files that drew the same card would
 * eventually stop drawing the same card.
 */
export { default, alt, size, contentType } from "./opengraph-image";
