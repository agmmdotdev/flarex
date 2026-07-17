export function isH05HttpsOriginUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === ""
  );
}
