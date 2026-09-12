import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { autoSyncNote } from "./status-styles";
import {
  accessSkeleton,
  listHeading,
  muted,
  prListSkeletonRow,
  prStatus,
  prTitle,
  rowActivity,
  skeletonControls,
  skeletonFilters,
  skeletonFlex,
  skeletonSearch,
  skeletonLegend,
  skeletonRows,
  skeletonScore,
  skeletonSyncNote,
  skeletonYears,
  stat,
  statIcon,
  stats,
  tableHead,
  tableRow,
  tableSurface,
  toolbar,
} from "./app-styles";
import { achievementBottom, achievementOutcomes, achievementPanel, achievementScore, achievementTop, authorizedAccounts, outcomesContent, scoreSecondary } from "./overview-styles";
import { activityComment, activitySection, activityThread } from "./activity-styles";
import { repositoryAction, repositoryControls, repositoryIdentity, repositoryListCaption, repositoryListPanel, repositoryNumber, repositoryRow, repositoryRows, repositorySummary, repositorySummaryItem } from "./repository-styles";
import { accountTrigger, profileBio, profileIdentity, profileMetadata, profileStats } from "./profile-styles";
import "react-loading-skeleton/dist/skeleton.css";
import { useTranslation } from "react-i18next";

export function OverviewSkeleton({ controls = false }: { controls?: boolean }) {
  const { t } = useTranslation();
  return (
    <SkeletonTheme baseColor="var(--skeleton-base)" highlightColor="var(--skeleton-highlight)">
      <div className="overview-skeleton @container/overview" role="status" aria-label={t("loading")} aria-busy="true">
        <div aria-hidden="true">
          {controls && (
            <div className={skeletonControls}>
              <Skeleton width={220} height={38} />
              <Skeleton width={170} height={12} />
              <div className={skeletonYears}>
                {Array.from({ length: 12 }, (_, i) => (
                  <Skeleton key={i} width={42} height={18} />
                ))}
              </div>
            </div>
          )}
          <div className={`${achievementTop} grid grid-cols-1 @row/overview:grid-cols-2`}>
            <article className={`${achievementScore} pt-7`}>
              <SkeletonTheme baseColor="var(--skeleton-hero-base)" highlightColor="var(--skeleton-hero-highlight)">
                <Skeleton width="36%" height={15} />
                <div className={skeletonScore}>
                  <Skeleton width="65%" height={66} />
                </div>
                <Skeleton width="32%" height={14} />
                <div className={scoreSecondary}>
                  <Skeleton height={20} />
                  <Skeleton height={20} />
                </div>
              </SkeletonTheme>
            </article>
            <article className={achievementOutcomes}>
              <Skeleton width="35%" height={17} />
              <div className={outcomesContent}>
                <Skeleton circle width={150} height={150} />
                <div className={skeletonLegend}>
                  <Skeleton count={3} height={18} />
                </div>
              </div>
            </article>
          </div>
          <div className={`${achievementBottom} grid grid-cols-1 @row/overview:grid-cols-2`}>
            <article className={achievementPanel}>
              <Skeleton width="30%" height={17} />
              <div className="mt-3">
                <Skeleton width="55%" height={12} />
                <Skeleton height={40} />
              </div>
              <div className={skeletonScore}>
                <Skeleton width="25%" height={32} />
              </div>
              <Skeleton height={280} />
            </article>
            <article className={achievementPanel}>
              <Skeleton width="35%" height={17} />
              <div className={outcomesContent}>
                <Skeleton circle width={130} height={130} />
                <div className={skeletonLegend}>
                  <Skeleton count={4} height={14} />
                </div>
              </div>
              <div className={skeletonRows}>
                <Skeleton count={5} height={22} />
              </div>
            </article>
          </div>
        </div>
      </div>
    </SkeletonTheme>
  );
}

// Keep placeholders on the same grids as their loaded components.
function LoadingFrame({ children, className = "" }: { children: import("react").ReactNode; className?: string }) {
  const { t } = useTranslation();
  return (
    <SkeletonTheme baseColor="var(--skeleton-base)" highlightColor="var(--skeleton-highlight)">
      <div className={className} role="status" aria-label={t("loading")} aria-busy="true">
        <div aria-hidden="true">{children}</div>
      </div>
    </SkeletonTheme>
  );
}

export function PRListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <LoadingFrame className={prListSkeletonRow}>
      <div className={`${tableSurface} table w-full`}>
        <div className={tableHead}>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} width={i === 0 ? 100 : 48} height={11} />
          ))}
        </div>
        {/* Cell order and explicit placement mirror the loaded row exactly: DOM order is the card's reading order (title, activity, repository, status, updated) and the table order is restored by column placement, so the placeholder and the real row never disagree about which cell sits where. */}
        {Array.from({ length: count }, (_, i) => (
          <div className={tableRow} key={i}>
            <div className={prTitle}>
              <Skeleton width={17} height={17} />
              <div className={skeletonFlex}>
                <Skeleton width={i % 2 ? "92%" : "78%"} height={15} />
                <Skeleton width="55%" height={15} />
                <div className="mt-1">
                  <Skeleton width={44} height={11} />
                </div>
              </div>
            </div>
            <div className={rowActivity}>
              <Skeleton width={38} height={30} />
            </div>
            <div className="col-start-1 row-start-2 min-w-0 @row/dashboard:col-start-2 @row/dashboard:row-start-1">
              <Skeleton width="85%" height={12} />
            </div>
            <div className={prStatus}>
              <Skeleton width={70} height={23} />
              {/* The CI-check placeholder takes a full line of its own because the real check cell is `block w-full` inside this wrapping flex row; a fixed-width bar here would make the placeholder a line shorter than the row it stands in for. */}
              <Skeleton width="100%" height={11} containerClassName="block w-full" />
            </div>
            {/* The loaded cell right-aligns itself with `justify-self-end`, which sizes a grid item to its content. That is right for a timestamp and wrong for a percentage-width placeholder, which would collapse to nothing, so the placeholder stays stretched and right-aligns its contents instead. */}
            <span className={`${muted} col-start-2 row-start-2 text-right @row/dashboard:col-start-4 @row/dashboard:row-start-1 @row/dashboard:text-left`}>
              <Skeleton width="85%" height={12} />
            </span>
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}

export function RepositorySkeleton({ count = 6 }: { count?: number }) {
  return (
    <LoadingFrame className="repository-skeleton">
      <div className={repositoryRows}>
        {Array.from({ length: count }, (_, i) => (
          <div className={repositoryRow} key={i}>
            <div className={repositoryIdentity}>
              <Skeleton width={36} height={36} />
              <div className={skeletonFlex}>
                <Skeleton width="45%" height={11} />
                <Skeleton width="75%" height={16} />
              </div>
            </div>
            {/* Four number cells, not three: the loaded row puts the open-count link in the first 88px track and the three counters after it, so a skeleton with one fewer child would drop the action block into an 88px track instead of the 116px one and the list would jump sideways when the data lands. */}
            {[0, 1, 2, 3].map((key) => (
              <div className={repositoryNumber} key={key}>
                <Skeleton width={24} height={18} />
              </div>
            ))}
            <div className={repositoryAction}>
              <Skeleton width={70} height={15} />
            </div>
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}

export function ProfileSkeleton() {
  return (
    <LoadingFrame className="profile-skeleton">
      <div className={profileIdentity}>
        <Skeleton circle width={48} height={48} />
        <div className={skeletonFlex}>
          <Skeleton width="75%" height={16} />
          <Skeleton width="55%" height={12} />
        </div>
      </div>
      <div className={profileBio}>
        <Skeleton count={2} height={12} />
      </div>
      <div className={`${profileMetadata} leading-[1.9]`}>
        <Skeleton width="65%" height={12} />
        <Skeleton width="80%" height={12} />
        <Skeleton width="75%" height={12} />
      </div>
      <div className={`${profileStats} [&>div]:text-center`}>
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <Skeleton width={36} height={20} />
            <Skeleton width="80%" height={11} />
          </div>
        ))}
      </div>
      <div className="mt-4">
        <Skeleton height={39} />
      </div>
    </LoadingFrame>
  );
}

export function ActivitySkeleton() {
  const { t } = useTranslation();
  return (
    <LoadingFrame className="activity-skeleton">
      <section className={activitySection}>
        <h3>{t("comments")}</h3>
        {[0, 1].map((i) => (
          <article className={activityComment} key={i}>
            <Skeleton width="35%" height={14} />
            <Skeleton width="55%" height={11} />
            <div className="mt-3">
              <Skeleton count={2} height={13} />
              <Skeleton width="70%" height={13} />
            </div>
            <Skeleton width={100} height={12} />
          </article>
        ))}
      </section>
      <section className={activitySection}>
        <h3>{t("reviewDiscussions")}</h3>
        <Skeleton height={36} />
      </section>
      <section className={activitySection}>
        <h3>{t("ciChecks")}</h3>
        {[0, 1, 2].map((i) => (
          <div className={activityThread} key={i}>
            <Skeleton width={150} height={13} />
            <Skeleton width={45} height={13} />
          </div>
        ))}
      </section>
    </LoadingFrame>
  );
}

export function AccessSkeleton() {
  return (
    <LoadingFrame className={accessSkeleton}>
      <div className={`${authorizedAccounts} mb-0`}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width={160} height={30} />
        ))}
      </div>
    </LoadingFrame>
  );
}

export function AccountSkeleton() {
  return (
    <LoadingFrame className="account-skeleton">
      <div className={`${accountTrigger} min-h-10`}>
        <Skeleton circle width={30} height={30} />
        <Skeleton width={64} height={12} />
      </div>
    </LoadingFrame>
  );
}

export function StatsSkeleton() {
  return (
    <LoadingFrame className="stats-skeleton">
      {/* These are the exported constants, not the bare words "stats"/"stat": no stylesheet in this app defines those class names, so spelling them as strings left the loading state with no grid and no card at any width. */}
      <section className={stats}>
        {[0, 1, 2, 3].map((i) => (
          <div className={stat} key={i}>
            <div className={statIcon}>
              <Skeleton width={18} height={18} />
            </div>
            <div className={skeletonFlex}>
              <Skeleton width="70%" height={12} />
              <Skeleton width={54} height={26} />
            </div>
          </div>
        ))}
      </section>
    </LoadingFrame>
  );
}

export function PageSkeleton({ page }: { page: string }) {
  if (page === "Overview") return <OverviewSkeleton controls />;
  if (page === "Repositories")
    return (
      <div className="grid gap-[22px]">
        <LoadingFrame>
          <div className={repositorySummary}>
            {[0, 1, 2].map((key) => (
              <div className={repositorySummaryItem} key={key}>
                <Skeleton width={80} height={13} />
                <Skeleton width={30} height={27} />
              </div>
            ))}
          </div>
        </LoadingFrame>
        <div className={repositoryListPanel}>
          <LoadingFrame>
            <div className={repositoryControls}>
              <Skeleton height={40} containerClassName="flex-1" />
              <Skeleton width={100} height={40} />
              <Skeleton width={100} height={40} />
            </div>
            <div className={repositoryListCaption}>
              <Skeleton width={140} height={12} />
            </div>
          </LoadingFrame>
          <RepositorySkeleton />
        </div>
      </div>
    );
  return (
    <div className="page-skeleton">
      <StatsSkeleton />
      <LoadingFrame>
        <div className={listHeading}>
          <Skeleton width={130} height={20} />
        </div>
        <div className={toolbar}>
          <Skeleton width="100%" height={40} containerClassName={skeletonSearch} />
          {page !== "Repositories" && <Skeleton width="100%" height={38} containerClassName={skeletonFilters} />}
        </div>
      </LoadingFrame>
      {page === "Repositories" ? <RepositorySkeleton /> : <PRListSkeleton />}
    </div>
  );
}

export function SyncStatusSkeleton() {
  return (
    <LoadingFrame className={autoSyncNote}>
      <Skeleton width="100%" height={12} containerClassName={skeletonSyncNote} />
    </LoadingFrame>
  );
}
