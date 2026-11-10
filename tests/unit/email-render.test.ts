import { describe, expect, it } from "vitest";
import { applyTestEnv } from "../test-env";

applyTestEnv();

import { renderEmail } from "@/lib/email/render";

const base = {
  links: ["https://milianjo.com/product/shampoo/"],
  messageId: "m1",
  siteName: "Milian Jo",
  unsubscribeUrl: "http://localhost:3000/e/u/tok123",
  imageUrl: (id: string) => (id === "img1" ? "http://localhost:3000/api/widget/image/img1?key=pk" : null),
  language: "en",
};

describe("renderEmail", () => {
  it("escapes HTML in the body", () => {
    const { html, text } = renderEmail({ ...base, body: "<script>alert(1)</script> & <b>bold</b>" });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt;");
    expect(html).not.toContain("<script>");
    expect(text).toContain("<script>alert(1)</script>");
  });

  it("turns a stored link into a tracked redirect", () => {
    const { html, text } = renderEmail({ ...base, body: "See [Shop](https://milianjo.com/product/shampoo/) now." });
    expect(html).toContain('<a href="http://localhost:3000/e/c/m1/0">Shop</a>');
    expect(html).not.toContain("milianjo.com/product");
    expect(text).toContain("Shop (http://localhost:3000/e/c/m1/0)");
  });

  it("drops links that aren't stored, including javascript: ones", () => {
    const { html } = renderEmail({ ...base, body: "[x](https://evil.com) and [y](javascript:alert(1))" });
    expect(html).not.toContain("href=\"https://evil.com");
    expect(html).not.toContain("javascript:");
    expect(html).toMatch(/x and y/);
    expect((html.match(/<a /g) ?? []).length).toBe(1); // only the unsubscribe link
  });

  it("keeps only images the site can serve", () => {
    const { html, text } = renderEmail({ ...base, body: "Look:\n\n[[image:img1]]\n\n[[image:abc]]" });
    expect(html).toContain('<img src="http://localhost:3000/api/widget/image/img1?key=pk" alt=""');
    expect(html).not.toContain("abc");
    expect(text).not.toContain("[[image:");
  });

  it("splits paragraphs on blank lines and keeps single line breaks", () => {
    const { html } = renderEmail({ ...base, body: "Hello Maria,\nthanks!\n\nSecond paragraph." });
    expect(html).toContain("<p>Hello Maria,<br>thanks!</p>");
    expect(html).toContain("<p>Second paragraph.</p>");
  });

  it("ends with the unsubscribe footer, in Greek for el", () => {
    const en = renderEmail({ ...base, body: "Hi" });
    expect(en.html).toContain("You&#39;re getting this because you asked Milian Jo for recommendations.");
    expect(en.html).toContain('href="http://localhost:3000/e/u/tok123"');
    expect(en.text).toContain("Unsubscribe: http://localhost:3000/e/u/tok123");
    const el = renderEmail({ ...base, body: "Γεια", language: "el" });
    expect(el.html).toContain("Λαμβάνετε αυτό το email επειδή ζητήσατε προτάσεις από το Milian Jo.");
    expect(el.text).toContain("Διαγραφή: http://localhost:3000/e/u/tok123");
  });

  it("escapes the site name in the footer", () => {
    const { html } = renderEmail({ ...base, siteName: "<Shop>", body: "Hi" });
    expect(html).toContain("&lt;Shop&gt;");
  });
});
