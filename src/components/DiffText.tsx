import type { DiffPart } from '../lib/diff';

interface Props {
  parts: DiffPart[];
  /** `before` shows unchanged + deleted text, `after` shows unchanged + inserted text. */
  side: 'before' | 'after';
}

/** Renders one side of a word-level diff with the changed words highlighted. */
export function DiffText({ parts, side }: Props) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'same') return part.text;
        if (side === 'before' && part.type === 'del') {
          return (
            <del key={index} class="diff-del">
              {part.text}
            </del>
          );
        }
        if (side === 'after' && part.type === 'ins') {
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
