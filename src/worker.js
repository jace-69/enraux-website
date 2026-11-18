import { onRequestPost, onRequestOptions } from "../functions/api/contact.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/contact") {
      if (request.method === "OPTIONS") {
        return onRequestOptions({ request, env, ctx });
      }
      if (request.method === "POST") {
        return onRequestPost({ request, env, ctx });
      }
      return new Response("Method Not Allowed", { status: 405 });
    }
    return env.ASSETS.fetch(request);
  },
};
