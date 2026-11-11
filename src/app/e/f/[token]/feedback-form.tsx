"use client";

import { useActionState } from "react";
import { feedbackAction, type FeedbackState } from "./actions";

type Props = {
  token: string;
  rating: number | null;
  comment: string;
  copy: { rating: string; stars: string; comment: string; submit: string; thanks: string; edit: string };
};

export function FeedbackForm({ token, rating, comment, copy }: Props) {
  const [state, action, pending] = useActionState<FeedbackState, FormData>(feedbackAction.bind(null, token), {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1">{copy.rating}</legend>
        <div className="flex flex-wrap gap-4">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="flex items-center gap-1">
              <input type="radio" name="rating" value={n} required defaultChecked={rating === n} />
              <span>
                {n}
                <span className="sr-only"> ({copy.stars.replace("{n}", String(n))})</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        {copy.comment}
        <textarea name="comment" rows={4} maxLength={2000} defaultValue={comment} className="border p-2" />
      </label>
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      {state.done && (
        <p role="status">
          {copy.thanks} {copy.edit}
        </p>
      )}
      <button type="submit" disabled={pending} className="w-fit border p-2">
        {copy.submit}
      </button>
    </form>
  );
}
