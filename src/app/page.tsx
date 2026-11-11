import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { PRODUCT_NAME, SIGNUP_EMAIL, signupMailto } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} · a chatbot that reads the room`,
  description:
    "A website chatbot that learns your site, notices what each visitor is doing, and offers help at the right moment. Invite-only.",
};

/** An illustrative visit: the pages one visitor moved through, lit in order as the bot follows along. */
const VISIT = [
  { page: "/products", note: "browsing · 18s" },
  { page: "/products/hair-therapy-butter", note: "lingering · 42s" },
  { page: "/cart", note: "added to cart" },
];

const DOES = [
  ["Learns your site", "Paste one snippet. It reads your pages, and any documents you add, with no tagging."],
  ["Reads the room", "Infers what each visitor is there to do from how they browse: where they scroll, linger and add to cart."],
  ["Offers, then backs off", "One well-timed suggestion, dismissed in a click. When unsure, it stays quiet."],
  ["Answers in their language", "Replies in the language the visitor writes in, from what your site and files say."],
  ["Captures emails, with permission", "Visitors it can't help can leave their email, with consent recorded."],
  ["Shows you everything", "Every conversation, the questions it couldn't answer, daily insights, and sales that followed a chat."],
] as const;

export default function Home() {
  return (
    <div className="cx landing">
      <header className="landing-bar">
        <Link href="/" className="brand-mark" aria-label={`${PRODUCT_NAME} home`}>
          {PRODUCT_NAME.toUpperCase()}
        </Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          <Link href="/sign-in" className="btn btn-ghost">
            Sign in
          </Link>
          <a href={signupMailto} className="btn btn-primary">
            Sign up
          </a>
        </nav>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="flex flex-col gap-6">
            <h1 id="hero-title" className="landing-title">
              A concierge for <span className="text-neon-lit">your website</span>
            </h1>
            <p className="landing-lead">
              {PRODUCT_NAME} learns your site, notices what each visitor is trying to do, and offers help at the right
              moment. Then it gets out of the way.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a href={signupMailto} className="btn btn-primary btn-lg">
                Sign up <ArrowRightIcon />
              </a>
              <Link href="/sign-in" className="btn btn-lg">
                Sign in
              </Link>
            </div>
            <p className="text-sm text-ink-muted">
              Invite-only for now. To sign up, email <a href={signupMailto}>{SIGNUP_EMAIL}</a>.
            </p>
          </div>

          <figure className="panel demo" aria-labelledby="demo-title">
            <figcaption id="demo-title" className="panel-head">
              What the bot noticed
              <span className="badge">Example</span>
            </figcaption>
            <div className="panel-body flex flex-col gap-4">
              <ol className="flex flex-col gap-2" aria-label="Pages in this visit">
                {VISIT.map((v, i) => (
                  <li key={v.page} className="demo-sign" style={{ "--i": i } as React.CSSProperties}>
                    <span className="cell-mono truncate">{v.page}</span>
                    <span className="demo-note">{v.note}</span>
                  </li>
                ))}
              </ol>
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <span className="lamp lamp-live" aria-hidden="true" />
                Intent: <span className="text-ink">ready to buy</span>
              </p>
              <div className="demo-prompt">
                <span className="msg-who">Suggestion</span>
                <p>Want to know which shampoo pairs with the butter?</p>
              </div>
            </div>
          </figure>
        </section>

        <section className="landing-section" aria-labelledby="does-title">
          <div className="panel">
            <h2 id="does-title" className="panel-head">
              What it does
            </h2>
            <dl className="does">
              {DOES.map(([term, text]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="landing-section landing-close" aria-labelledby="close-title">
          <h2 id="close-title" className="text-4xl">
            Want it on your site?
          </h2>
          <p className="text-ink-muted">
            Email <a href={signupMailto}>{SIGNUP_EMAIL}</a> and we&apos;ll set up your account. Works on any site,
            WordPress included.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a href={signupMailto} className="btn btn-primary btn-lg">
              Sign up
            </a>
            <Link href="/sign-in" className="btn btn-lg">
              Sign in
            </Link>
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <span>
          {PRODUCT_NAME} · <a href={`mailto:${SIGNUP_EMAIL}`}>{SIGNUP_EMAIL}</a>
        </span>
        <Link href="/bot">About our crawler, ConciergeBot</Link>
      </footer>
    </div>
  );
}
