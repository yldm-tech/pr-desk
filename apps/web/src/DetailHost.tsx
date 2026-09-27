import { DetailPane } from "./DetailPane";
import { useDetail } from "./detail-context";

// The one modal detail the shell mounts, opened through useDetail() by a pull-request row, by an Inbox row on a narrow screen, or by anything else that wants to show a PR's activity. Keyed on the PR so switching targets starts a fresh sheet (and a fresh read-on-open) rather than morphing the old one. The Inbox's split view shows the same DetailPane inline instead and never opens this.
export function DetailHost() {
  const { target } = useDetail();
  if (!target) return null;
  return <DetailPane key={target.pr.id} target={target} mode="sheet" />;
}
