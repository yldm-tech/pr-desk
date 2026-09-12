import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { HTTPError } from "ky";
import { addErrorMessage, draftErrors } from "./FollowUpSettings";

const email = { kind: "email", name: "Inbox", token: "", chat_id: "", url: "", secret: "", host: "smtp.example.com", port: "587", username: "", password: "", from: "desk@example.com", to: "ops@example.com" };
const rejected = (body) => {
  const error = new HTTPError(new Response(null, { status: 400 }), new Request("https://desk.test/api/v1/notification-destinations"), {});
  error.data = body;
  return error;
};

test("an SMTP host carrying a port is reported on the field the server refuses", () => {
  assert.equal(draftErrors({ ...email, host: "smtp.example.com:587" }, false).host, "followup.invalidHost");
  assert.equal(draftErrors({ ...email, host: "smtp example com" }, false).host, "followup.invalidHost");
  assert.equal(draftErrors({ ...email, host: "https://smtp.example.com" }, false).host, "followup.invalidHost");
  assert.equal(draftErrors(email, false).host, undefined);
});

test("a rejected destination reports the reason the server gave", () => {
  assert.equal(addErrorMessage(rejected({ error: "The sender address is not a valid email address" })), "The sender address is not a valid email address");
  assert.equal(addErrorMessage(rejected({})), "");
  assert.equal(addErrorMessage(rejected("not json")), "");
  assert.equal(addErrorMessage(new Error("offline")), "");
});
