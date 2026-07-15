export default {
  fetch(): Response {
    return new Response("Runtime topology probe teardown in progress", {
      status: 410,
      headers: { "cache-control": "no-store" },
    });
  },
} satisfies ExportedHandler<Record<string, never>>;
