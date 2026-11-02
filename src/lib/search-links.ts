/** Client-safe links for search results (the palette imports this; the search service re-exports it). */

/** Where a draft opens: the inbox tab its status lives in (published drafts sit with approved). */
export function draftHref(d: { id: string; status: string }) {
  const tab = d.status === "published" ? "approved" : ["pending", "approved", "rejected"].includes(d.status) ? d.status : "pending";
  return `/inbox?d=${d.id}&tab=${tab}`;
}
