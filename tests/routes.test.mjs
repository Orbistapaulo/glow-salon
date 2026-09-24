import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, buildHash, allowedRoute } from "../admin/js/router.js";

test("parseRoute reads the screen, id and query", () => {
  assert.deepEqual(parseRoute("#/customers/abc-1?from=search"), { name: "customers", id: "abc-1", params: { from: "search" } });
  assert.deepEqual(parseRoute("#/schedule?date=2026-10-01"), { name: "schedule", id: null, params: { date: "2026-10-01" } });
  assert.deepEqual(parseRoute(""), { name: "schedule", id: null, params: {} });
});

test("parseRoute ignores Supabase login tokens in the hash", () => {
  assert.equal(parseRoute("#access_token=abc&type=recovery").name, "schedule");
});

test("buildHash is the reverse of parseRoute", () => {
  assert.equal(buildHash("customers", "abc 1"), "#/customers/abc%201");
  assert.equal(buildHash("schedule", null, { date: "2026-10-01" }), "#/schedule?date=2026-10-01");
  assert.equal(buildHash("new"), "#/new");
});

test("allowedRoute keeps staff out of owner screens", () => {
  assert.equal(allowedRoute({ name: "services" }, "staff"), "schedule");
  assert.equal(allowedRoute({ name: "hours" }, "staff"), "schedule");
  assert.equal(allowedRoute({ name: "staff" }, "staff"), "schedule");
  assert.equal(allowedRoute({ name: "customers" }, "staff"), "customers");
  assert.equal(allowedRoute({ name: "services" }, "owner"), "services");
  assert.equal(allowedRoute({ name: "nonsense" }, "owner"), "schedule");
});
