import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, FolderGit2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RepositorySummary } from "./pr-model";
import { selectContent, selectOption } from "./select-styles";

export function RepositorySelect({ repositories, value, onChange, loading }: { repositories: RepositorySummary[]; value: string; onChange: (value: string) => void; loading: boolean }) {
  const { t } = useTranslation();
  const eligible = repositories.filter((repo) => repo.needs_attention > 0).sort((a, b) => a.repo.localeCompare(b.repo));
  const groups = [...new Set(eligible.map((repo) => repo.repo.split("/")[0]))].map((owner) => [owner, eligible.filter((repo) => repo.repo.split("/")[0] === owner)] as const);
  return (
    <Select.Root value={value || "all"} onValueChange={(next) => onChange(next === "all" ? "" : next)}>
      <Select.Trigger className="inline-flex h-10 w-[280px] max-w-full items-center gap-[9px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] text-[var(--foreground)] [&>span:first-of-type]:flex-1 [&>span:first-of-type]:overflow-hidden [&>span:first-of-type]:text-left [&>span:first-of-type]:text-ellipsis [&>span:first-of-type]:whitespace-nowrap" aria-label={t("filterRepository")} disabled={loading}>
        <FolderGit2 size={16} aria-hidden="true" />
        <Select.Value>{loading ? t("loading") : value || t("allRepositories")}</Select.Value>
        <Select.Icon>
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className={`${selectContent} min-w-[180px] w-[max(var(--radix-select-trigger-width),300px)] max-w-[calc(100vw-24px)] [&_[data-radix-select-viewport]]:max-h-[min(400px,var(--radix-select-content-available-height))]`} position="popper" align="start" sideOffset={6} collisionPadding={12}>
          <Select.Viewport>
            <Select.Item value="all" className={`${selectOption} gap-3 [overflow-wrap:anywhere] whitespace-normal`}>
              <Select.ItemText>{t("allRepositories")}</Select.ItemText>
              <Select.ItemIndicator>
                <Check size={15} />
              </Select.ItemIndicator>
            </Select.Item>
            {Array.from(groups, ([owner, repos]) => (
              <Select.Group key={owner}>
                <Select.Label className="px-3 pb-1 pt-3 text-xs font-medium text-[var(--muted)]">{owner}</Select.Label>
                {repos.map((repo) => (
                  <Select.Item key={repo.repo} value={repo.repo} className={`${selectOption} gap-3 [overflow-wrap:anywhere] whitespace-normal`}>
                    <Select.ItemText>{repo.repo}</Select.ItemText>
                    <span className="ml-auto text-xs tabular-nums text-[var(--muted)]">{repo.needs_attention}</span>
                    <Select.ItemIndicator>
                      <Check size={15} />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Group>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
