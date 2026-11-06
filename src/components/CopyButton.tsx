"use client";

import { useRef, useState } from "react";

/** Shows the text in a readonly textarea with a copy button; falls back to selecting the text. */
export function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      area.current?.focus();
      area.current?.select();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={area}
        readOnly
        value={text}
        rows={3}
        aria-label="Embed snippet"
        className="w-full border p-2 font-mono text-sm"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" onClick={copy} className="self-start border px-3 py-1">
        {copied ? "Copied" : "Copy"}
      </button>
      <span role="status" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}
