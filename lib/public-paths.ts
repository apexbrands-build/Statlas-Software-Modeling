/** Pages merchants and Shopify reviewers open without an Apex account: no sidebar, no client loading. */
export function isBarePage(path: string): boolean {
  return ["/shopify", "/privacy", "/support"].includes(path) || path.startsWith("/shopify/");
}
