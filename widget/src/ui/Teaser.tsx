/** @jsxImportSource preact */
import { useEffect } from "preact/hooks";

/** Shows the greeting. Never takes focus. Dismisses on the first scroll, pointerdown or keydown anywhere. */
export function Teaser({
  message,
  imageUrl,
  closeLabel,
  onOpen,
  onDismiss,
}: {
  message: string;
  imageUrl: string | null;
  closeLabel: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const types = ["scroll", "pointerdown", "keydown"] as const;
    const handler = () => onDismiss();
    for (const t of types) window.addEventListener(t, handler, { passive: true, once: true });
    return () => {
      for (const t of types) window.removeEventListener(t, handler);
    };
  }, [onDismiss]);

  return (
    <div class="teaser-wrap">
      <button type="button" class="teaser" onClick={onOpen}>
        {imageUrl && <img src={imageUrl} alt="" />}
        <span>{message}</span>
      </button>
      <button type="button" class="teaser-close" aria-label={closeLabel} onClick={onDismiss}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
