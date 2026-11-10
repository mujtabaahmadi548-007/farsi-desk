import type { DiffPart } from '../lib/diff';

interface Props {
  parts: DiffPart[];
  /**
   * `before` shows unchanged + deleted text, `after` shows unchanged + inserted text,
   * `both` shows everything inline (deleted words struck through, inserted words highlighted).
   */
  side: 'before' | 'after' | 'both';
}

/** Renders a word-level diff with the changed words highlighted. */
export function DiffText({ parts, side }: Props) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'same') return part.text;
        if (part.type === 'del' && side !== 'after') {
          return (
            <del key={index} class="diff-del">
              {part.text}
            </del>
          );
        }
        if (part.type === 'ins' && side !== 'before') {
          return (
            <ins key={index} class="diff-ins">
              {part.text}
            </ins>
          );
        }
        return null;
      })}
    </>
  );
}
