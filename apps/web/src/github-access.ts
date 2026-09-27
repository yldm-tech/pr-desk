import type React from "react";

// Opens the GitHub App installation in a centred popup rather than a tab, so finishing it returns the reader to the page that asked. A modifier click is left to the browser, which is how "open in a new tab" and "new window" keep working; a blocked popup falls back to the link's own target. `opener` is cleared before navigating so github.com never holds a handle on this window.
export function openInstallPopup(event: React.MouseEvent<HTMLAnchorElement>, href: string): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const width = Math.min(760, window.screen.availWidth);
  const height = Math.min(820, window.screen.availHeight);
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  const popup = window.open("about:blank", "_blank", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
  if (!popup) return;
  event.preventDefault();
  popup.opener = null;
  popup.location.href = href;
  popup.focus();
}
