/** @jsxImportSource preact */
import type { Ref } from "preact";

export function Launcher({
  label,
  expanded,
  onClick,
  buttonRef,
}: {
  label: string;
  expanded: boolean;
  onClick: () => void;
  buttonRef: Ref<HTMLButtonElement>;
}) {
  return (
    <button type="button" class="launcher" ref={buttonRef} aria-label={label} aria-expanded={expanded} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      </svg>
    </button>
  );
}
