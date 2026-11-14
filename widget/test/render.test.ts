import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../src/render";

function html(text: string, images: Parameters<typeof renderMessage>[2] = [], apiBase = "http://app.test") {
  const div = document.createElement("div");
  div.append(renderMessage(document, text, images, apiBase));
  return div;
}

describe("renderMessage", () => {
  it("renders hostile input as inert text", () => {
    const div = html("<script>alert(1)</script> **hi** [x](javascript:alert(1)) [ok](https://a.test)");
    expect(div.querySelector("script")).toBeNull();
    expect(div.textContent).toContain("<script>alert(1)</script>");
    expect(div.querySelectorAll("a").length).toBe(1);
    expect(div.querySelector("a")!.getAttribute("href")).toBe("https://a.test");
    expect(div.querySelector("a")!.getAttribute("target")).toBe("_blank");
    expect(div.querySelector("a")!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(div.querySelector("strong")!.textContent).toBe("hi");
  });

  it("does not create elements from <img onerror>", () => {
    const div = html('<img src=x onerror="alert(1)">');
    expect(div.querySelector("img")).toBeNull();
    expect(div.textContent).toContain("<img");
  });

  it("splits paragraphs and turns single newlines into br", () => {
    const div = html("one\ntwo\n\nthree");
    expect(div.querySelectorAll("p").length).toBe(2);
    expect(div.querySelectorAll("p")[0].querySelectorAll("br").length).toBe(1);
  });

  it("renders unordered and ordered lists", () => {
    const div = html("- a\n* b\n\n1. c\n2. d");
    expect(div.querySelectorAll("ul > li").length).toBe(2);
    expect(div.querySelectorAll("ol > li").length).toBe(2);
    expect(div.querySelector("ol li")!.textContent).toBe("c");
  });

  it("leaves unclosed bold literal and does not autolink", () => {
    const div = html("**oops and https://a.test");
    expect(div.querySelector("strong")).toBeNull();
    expect(div.querySelector("a")).toBeNull();
    expect(div.textContent).toBe("**oops and https://a.test");
  });

  it("renders only images from the api base, after the text", () => {
    const div = html(
      "text",
      [
        { id: "1", url: "http://app.test/api/widget/image/1?key=k", caption: "cap" },
        { id: "2", url: "http://evil.test/x.png", caption: "bad" },
        { id: "3", url: "http://app.test.evil.test/x.png", caption: "bad2" },
      ],
    );
    const imgs = div.querySelectorAll("img");
    expect(imgs.length).toBe(1);
    expect(imgs[0].getAttribute("alt")).toBe("cap");
    expect(imgs[0].getAttribute("loading")).toBe("lazy");
    expect(div.lastElementChild!.contains(imgs[0])).toBe(true);
  });
});

describe("links to the shop's own site", () => {
  beforeEach(() => {
    (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL("https://shop.test/products/butter");
  });

  it("open in the same tab and are marked for the chat to follow", () => {
    const a = html("[ritual](https://shop.test/ritual?x=1#top)").querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://shop.test/ritual?x=1#top");
    expect(a.getAttribute("target")).toBeNull();
    expect(a.hasAttribute("data-cc-nav")).toBe(true);
  });

  it("treat www and the bare domain as the same site and keep the current origin", () => {
    const a = html("[cart](https://www.shop.test/cart)").querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://shop.test/cart");
    expect(a.getAttribute("target")).toBeNull();
    expect(a.hasAttribute("data-cc-nav")).toBe(true);
  });

  it("other sites still open in a new tab", () => {
    const a = html("[other](https://other.test/page)").querySelector("a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.hasAttribute("data-cc-nav")).toBe(false);
  });
});
