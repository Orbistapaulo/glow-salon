import { test } from "node:test";
import assert from "node:assert/strict";
import { html, raw, toHtml } from "../admin/js/ui.js";

test("html escapes interpolated values", () => {
  const name = '<img src=x onerror="alert(1)">';
  assert.equal(toHtml(html`<p>${name}</p>`), "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
});

test("html leaves nested templates and raw markup alone", () => {
  const items = ["a&b", "c"].map((x) => html`<li>${x}</li>`);
  assert.equal(toHtml(html`<ul>${items}</ul>`), "<ul><li>a&amp;b</li><li>c</li></ul>");
  assert.equal(toHtml(html`<div>${raw("<b>ok</b>")}</div>`), "<div><b>ok</b></div>");
});

test("html drops null, undefined and false", () => {
  assert.equal(toHtml(html`<p>${null}${undefined}${false}${0}</p>`), "<p>0</p>");
});
