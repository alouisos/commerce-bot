/** @jsxImportSource preact */
import type { Ref } from "preact";

export function Launcher({
  label,
  expanded,
  onClick,
  buttonRef,
  iconUrl,
}: {
  label: string;
  expanded: boolean;
  onClick: () => void;
  buttonRef: Ref<HTMLButtonElement>;
  iconUrl: string | null;
}) {
  return (
    <button type="button" class="launcher" ref={buttonRef} aria-label={label} aria-expanded={expanded} onClick={onClick}>
      {/* The icon turns into a close mark while the panel is open (both drawn, crossfaded in CSS). */}
      <span class="launcher-icon">
        {iconUrl ? (
          <img src={iconUrl} alt="" />
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
          </svg>
        )}
      </span>
      <span class="launcher-x" aria-hidden="true" />
    </button>
  );
}
