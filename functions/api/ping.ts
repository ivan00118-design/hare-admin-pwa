// functions/api/ping.ts
export const onRequestGet = () =>
  new Response("pong", { headers: { "content-type": "text/plain" } });

export const onRequestPost = () =>
  new Response("pong-post", { headers: { "content-type": "text/plain" } });

// 可選：這一行讓任意方法都能通（避免 405）
export const onRequest = onRequestPost;
