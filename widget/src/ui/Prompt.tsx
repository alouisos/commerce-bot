/** @jsxImportSource preact */

/** A suggestion next to the launcher. Never takes focus; announced once, politely. */
export function Prompt({
  text,
  dismissLabel,
  onTap,
  onDismiss,
}: {
  text: string;
  dismissLabel: string;
  onTap: () => void;
  onDismiss: () => void;
}) {
  return (
    <div class="teaser-wrap" role="status">
      <button type="button" class="teaser" onClick={onTap}>
        <span>{text}</span>
      </button>
      <button type="button" class="teaser-close" aria-label={dismissLabel} onClick={onDismiss}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
