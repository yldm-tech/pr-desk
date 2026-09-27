import { ArrowRight, FolderGit2, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RepositorySkeleton } from "./LoadingSkeleton";
import type { RepositorySummary } from "./pr-model";
import { paths, prViewPath } from "./routes";
import type { Tone } from "./tone";
import { Button, buttonClass, cx, LinkButton, SearchField, Select, SegmentedControl, TextLink } from "./ui-controls";
import { EmptyState, ErrorState, PageHeader, StaleNotice, StateGlyph, Toolbar } from "./ui-display";
import { ItemRow, itemTracks } from "./ui-list";

type Scope = "all" | "attention" | "conflicts";
type Sort = "attention" | "open" | "name";

const numberTone: Record<Tone | "plain", string> = { plain: "text-fg", blocked: "text-tone-blocked", action: "text-tone-action", waiting: "text-tone-waiting", ready: "text-tone-ready", neutral: "text-tone-neutral" };

// One count of a repository row. Below `table` the row is a card and the count reads as a phrase ("4 open PRs"); from `table` up it sits in its own column under a visual header, so only the number is painted and the phrase stays for assistive technology, which never sees the header. A zero is left out of the card, where its absence already says it, and printed as a quiet 0 in the table. A nonzero count that has a list behind it is a link to that list, underlined so it is not told apart by colour alone.
function Count({ value, phrase, tone, to, title, repo }: { value: number; phrase: string; tone: Tone | "plain"; to?: string; title?: string; repo: string }) {
  const { i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.resolvedLanguage).format(value);
  const content = (
    <>
      <span aria-hidden="true" className="hidden @table/dashboard:inline">
        {number}
      </span>
      <span className="@table/dashboard:sr-only">{phrase}</span>
    </>
  );
  const place = "min-w-0 tabular-nums @table/dashboard:justify-self-end @table/dashboard:text-right";
  if (value === 0) return <span className={cx(place, "hidden text-fg-subtle @table/dashboard:block")}>{content}</span>;
  if (!to) return <span className={cx(place, numberTone[tone])}>{content}</span>;
  return (
    // Text-sized, so a card's counts read as one compact line of stats rather than a column of tall buttons; on a touch screen the invisible ::before takes the target to 44px without taking the space.
    <Link
      to={to}
      title={title}
      className={cx(
        place,
        numberTone[tone],
        "relative inline-flex items-center rounded-sm leading-snug font-medium underline decoration-current/35 decoration-1 underline-offset-2 hover:decoration-current pointer-coarse:before:absolute pointer-coarse:before:-inset-x-1 pointer-coarse:before:-inset-y-3 pointer-coarse:before:content-[''] @table/dashboard:justify-end",
      )}
    >
      {content}
      <span className="sr-only"> · {repo}</span>
    </Link>
  );
}

function RepositoryRow({ repo }: { repo: RepositorySummary }) {
  const { t } = useTranslation();
  const [owner, ...rest] = repo.repo.split("/");
  const name = rest.join("/");
  const prs = paths.prs + "?" + new URLSearchParams({ repo: repo.repo });
  // Attention, Conflicts and Failing all land on the Blocked view: the attention predicate is conflicts OR changes requested OR failing checks (apps/api/main.go), so Blocked is a superset of the other two and the only list that holds exactly the attention set.
  const blocked = prViewPath("blocked") + "?" + new URLSearchParams({ repo: repo.repo });
  const glyph = repo.conflicts > 0 || repo.checks_failing > 0 ? <StateGlyph tone="blocked" kind="blocked" /> : repo.needs_attention > 0 ? <StateGlyph tone="action" kind="action" /> : <StateGlyph tone="neutral" kind="ready" />;
  return (
    <ItemRow
      as="li"
      tracks="repo"
      glyph={glyph}
      title={
        <TextLink href={`https://github.com/${repo.repo}`} tone="muted" external newTabLabel={t("repos.newTab")} title={repo.repo}>
          <span className="font-normal">{owner}</span>
          <span className="px-0.5 font-normal text-fg-subtle">/</span>
          <span className="text-fg">{name}</span>
        </TextLink>
      }
    >
      {/* Below `row` the counts are a run of inline text balanced across its lines, so four of them break two and two rather than three and a lone "1 failing PR"; from `row` they are a flex line beside the name, and from `table` each is its own column. */}
      <div className="col-start-1 col-end-3 row-start-2 block min-w-0 pl-7 text-caption leading-7 text-balance *:mr-3 @row/dashboard:col-start-2 @row/dashboard:col-end-3 @row/dashboard:row-start-1 @row/dashboard:flex @row/dashboard:flex-wrap @row/dashboard:items-center @row/dashboard:gap-x-3 @row/dashboard:gap-y-2 @row/dashboard:self-center @row/dashboard:pl-0 @row/dashboard:leading-normal @row/dashboard:*:mr-0 @table/dashboard:contents @table/dashboard:text-body">
        <Count value={repo.open} phrase={t("repos.openCount", { count: repo.open })} tone="plain" to={prs} repo={repo.repo} />
        <Count value={repo.needs_attention} phrase={t("repos.attentionCount", { count: repo.needs_attention })} tone="action" to={blocked} title={t("repos.blockedSuperset")} repo={repo.repo} />
        <Count value={repo.conflicts} phrase={t("repos.conflictsCount", { count: repo.conflicts })} tone="blocked" to={blocked} title={t("repos.blockedSuperset")} repo={repo.repo} />
        <Count value={repo.checks_failing} phrase={t("repos.failingCount", { count: repo.checks_failing })} tone="blocked" to={blocked} title={t("repos.blockedSuperset")} repo={repo.repo} />
      </div>
      <div className="col-start-2 col-end-3 row-start-1 justify-self-end @row/dashboard:col-start-3 @row/dashboard:col-end-4 @table/dashboard:col-start-6 @table/dashboard:col-end-7">
        {/* The negative margin takes the button back to the title's line height (28px and 44px down to 20px), so its label sits on the name's baseline rather than below it. */}
        <LinkButton to={prs} variant="ghost" size="sm" className="-my-1 whitespace-nowrap pointer-coarse:-my-3">
          {t("viewRepositoryPRs")}
          <span className="sr-only"> · {repo.repo}</span>
          <ArrowRight size={12} aria-hidden="true" className="shrink-0" />
        </LinkButton>
      </div>
    </ItemRow>
  );
}

// The authored repositories with open pull requests, narrowed and sorted locally. Every control writes the address with replace, so the list is shareable without every keystroke becoming a history entry.
// `error` is the query's error, null while the last request succeeded.
export function Repositories({ repositories, loading, error, retry }: { repositories: RepositorySummary[] | undefined; loading: boolean; error: unknown; retry: () => void }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const search = params.get("q") || "";
  const owner = params.get("owner") || "";
  const scope: Scope = params.get("scope") === "attention" || params.get("scope") === "conflicts" ? (params.get("scope") as Scope) : "all";
  const sort: Sort = params.get("sort") === "name" || params.get("sort") === "open" ? (params.get("sort") as Sort) : "attention";
  const all = repositories ?? [];
  const owners = [...new Set(all.map((repo) => repo.repo.split("/")[0]))].sort((a, b) => a.localeCompare(b));
  const counts: Record<Scope, number> = { all: all.length, attention: all.filter((repo) => repo.needs_attention > 0).length, conflicts: all.filter((repo) => repo.conflicts > 0).length };
  const change = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete("page");
        return next;
      },
      { replace: true },
    );
  const needle = search.trim().toLowerCase();
  const shown = all
    .filter((repo) => (!owner || repo.repo.split("/")[0] === owner) && repo.repo.toLowerCase().includes(needle) && (scope === "attention" ? repo.needs_attention > 0 : scope === "conflicts" ? repo.conflicts > 0 : true))
    .sort((a, b) => (sort === "name" ? 0 : sort === "open" ? b.open - a.open : b.needs_attention - a.needs_attention || b.conflicts - a.conflicts) || a.repo.localeCompare(b.repo));
  const filtered = !!search || !!owner || scope !== "all";
  const clear = () =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const key of ["q", "owner", "scope", "page"]) next.delete(key);
      return next;
    });
  const known = !loading && !!repositories;
  // Nothing to show at all: every placeholder that stands for a number (the scope counts, the result line) goes with the list, so the error is the only thing the page says.
  const failed = error != null && !repositories;
  const ownerOptions = [{ value: "", label: t("allOwners") }, ...(owner && !owners.includes(owner) ? [{ value: owner, label: owner }] : []), ...owners.map((name) => ({ value: name, label: name }))];

  let body;
  if (loading) body = <RepositorySkeleton />;
  else if (failed) body = <ErrorState title={t("unableRepositories")} error={error} onRetry={retry} />;
  else if (!shown.length)
    body = (
      <EmptyState
        icon={FolderGit2}
        title={t("emptyResultsTitle")}
        description={t(filtered ? "emptyResultsDescription" : "noRepos")}
        action={
          filtered && (
            <Button onClick={clear} icon={X}>
              {t("clearFilters")}
            </Button>
          )
        }
      />
    );
  else
    body = (
      <>
        {/* A visual header for the table band only. Each count also carries its own phrase for assistive technology, so the header is hidden from it rather than left half-attached to a list that is not a table. */}
        <div aria-hidden="true" className={cx("hidden gap-x-3 border-b border-line px-3 py-2 text-small font-medium text-fg-muted @table/dashboard:grid", itemTracks.repo)}>
          <span className="truncate pl-7">{t("repository")}</span>
          <span className="truncate text-right">{t("repos.colOpen")}</span>
          <span className="truncate text-right">{t("repos.colAttention")}</span>
          <span className="truncate text-right">{t("conflicts")}</span>
          <span className="truncate text-right">{t("checksFailing")}</span>
          {/* The last track is `auto`, which each row sizes to its own View PRs link; an invisible copy of that link gives the header's track the same width, so the count columns line up under their labels. */}
          <span className={cx(buttonClass("ghost", "sm"), "invisible whitespace-nowrap")}>
            {t("viewRepositoryPRs")}
            <ArrowRight size={12} className="shrink-0" />
          </span>
        </div>
        <ul aria-label={t("navRepositories")} className="m-0 min-w-0 list-none border-t border-line p-0 @table/dashboard:border-t-0">
          {shown.map((repo) => (
            <RepositoryRow key={repo.repo} repo={repo} />
          ))}
        </ul>
      </>
    );

  return (
    <section id="repositories" className="grid min-w-0 gap-4">
      <PageHeader
        title={t("navRepositories")}
        count={known ? all.length : undefined}
        summary={
          <SegmentedControl<Scope>
            className="justify-self-start"
            label={t("repositoryScope")}
            value={scope}
            onChange={(value) => change("scope", value === "all" ? "" : value)}
            items={(["all", "attention", "conflicts"] as const).map((value) => ({ value, label: t(value === "all" ? "repos.scopeAll" : value === "attention" ? "attentionRepositories" : "conflictRepositories"), count: known ? counts[value] : failed ? undefined : "—" }))}
          />
        }
      />
      {/* Below `pair`: the search on its own full-width line, the owner and the sort side by side under it. */}
      <Toolbar className="@max-pair/dashboard:grid @max-pair/dashboard:grid-cols-2">
        <SearchField
          id="pr-search"
          className="w-full max-w-sm min-w-0 flex-[1_1_14rem] @max-pair/dashboard:col-span-2 @max-pair/dashboard:max-w-none"
          label={t("searchRepositories")}
          value={search}
          onChange={(value) => change("q", value)}
          mode="live"
          placeholder={t("repositorySearchPlaceholder")}
          maxLength={120}
          kbdHint
        />
        <Select label={t("repositoryOwner")} hideLabel="below-pair" value={owner} onChange={(event) => change("owner", event.target.value)} options={ownerOptions} className="@max-pair/dashboard:[&>select]:flex-1" />
        <Select
          label={t("repositorySort")}
          hideLabel="below-pair"
          className="@max-pair/dashboard:[&>select]:flex-1"
          value={sort}
          onChange={(event) => change("sort", event.target.value)}
          options={[
            { value: "attention", label: t("sortAttention") },
            { value: "open", label: t("sortOpen") },
            { value: "name", label: t("sortName") },
          ]}
        />
      </Toolbar>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p aria-live="polite" className="text-small text-fg-muted tabular-nums">
          {known ? t("repos.results", { count: shown.length }) : failed ? "" : "—"}
        </p>
        {filtered && (
          <Button variant="ghost" size="sm" icon={X} onClick={clear}>
            {t("clearFilters")}
          </Button>
        )}
      </div>
      {error != null && repositories && <StaleNotice onRetry={retry} />}
      <div className="min-w-0">{body}</div>
    </section>
  );
}
