import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { feedbackForm } from "@/lib/buyers/feedback";
import { emailCopyFor, fillSite } from "@/lib/copy/defaults";
import { FeedbackForm } from "./feedback-form";

export const metadata: Metadata = { robots: { index: false } };

// Opening the link only shows the form; nothing is stored until the visitor submits it.
export default async function FeedbackPage({ params }: PageProps<"/e/f/[token]">) {
  const { token } = await params;
  const form = await feedbackForm(token);
  if (!form) notFound();
  const { language, copy } = emailCopyFor(form.language);
  return (
    <main lang={language} className="mx-auto flex max-w-md flex-col gap-4 p-8">
      <h1 className="text-xl font-semibold">{copy.feedbackTitle}</h1>
      {form.products.length > 0 && (
        <div>
          <p>{fillSite(copy.feedbackProducts, form.siteName)}</p>
          <ul className="list-disc pl-5">
            {form.products.map((p, i) => (
              <li key={i}>{p.name}</li>
            ))}
          </ul>
        </div>
      )}
      <FeedbackForm
        token={token}
        rating={form.rating}
        comment={form.comment}
        copy={{
          rating: copy.feedbackRating,
          stars: copy.feedbackStars,
          comment: copy.feedbackComment,
          submit: copy.feedbackSubmit,
          thanks: copy.feedbackThanks,
          edit: copy.feedbackEdit,
        }}
      />
    </main>
  );
}
