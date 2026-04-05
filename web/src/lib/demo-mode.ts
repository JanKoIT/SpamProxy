export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).has("demo") ||
    document.cookie.includes("spamproxy_demo=true") ||
    localStorage.getItem("spamproxy_demo") === "true"
  );
}

export function enableDemo() {
  localStorage.setItem("spamproxy_demo", "true");
  document.cookie = "spamproxy_demo=true; path=/";
}

export function disableDemo() {
  localStorage.removeItem("spamproxy_demo");
  document.cookie = "spamproxy_demo=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
}
