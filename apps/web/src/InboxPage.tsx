import { FollowUpSummary, FollowUpWorkspace } from "./FollowUps";

// The home route: the follow-up summary that used to open the landing page, directly above the workspace it links into, so the counts and the rows they count are one scroll apart.
export function InboxPage() {
  return (
    <>
      <FollowUpSummary />
      <FollowUpWorkspace />
    </>
  );
}
