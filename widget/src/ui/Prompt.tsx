/** @jsxImportSource preact */

/** A suggestion next to the launcher. Never takes focus; announced once, politely. */
export function Prompt({
  text,
  dismissLabel,
  onTap,
  onDismiss,
  leaving = false,
}: {
  text: string;
  dismissLabel: string;
  onTap: () => void;
  onDismiss: () => void;
  /** Gone and playing its exit animation. */
  leaving?: boolean;
}) {
  return (
    <div class={leaving ? "teaser-wrap leaving" : "teaser-wrap"} role="status" aria-hidden={leaving ? "true" : undefined} inert={leaving}>
      <button type="button" class="teaser" onClick={onTap}>
        <span>{text}</span>
      </button>
      <button type="button" class="teaser-close" aria-label={dismissLabel} onClick={onDismiss}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
