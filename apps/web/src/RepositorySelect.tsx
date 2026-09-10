import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, FolderGit2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RepositorySummary } from "./pr-model";

export function RepositorySelect({ repositories, value, onChange, loading }: { repositories: RepositorySummary[]; value: string; onChange: (value: string) => void; loading: boolean }) {
  const { t } = useTranslation();
  const eligible = repositories.filter((repo) => repo.needs_attention > 0).sort((a, b) => a.repo.localeCompare(b.repo));
  const groups = [...new Set(eligible.map((repo) => repo.repo.split("/")[0]))].map((owner) => [owner, eligible.filter((repo) => repo.repo.split("/")[0] === owner)] as const);
  return (
    <Select.Root value={value || "all"} onValueChange={(next) => onChange(next === "all" ? "" : next)}>
      <Select.Trigger className="repository-select" aria-label={t("filterRepository")} disabled={loading}>
        <FolderGit2 size={16} aria-hidden="true" />
        <Select.Value>{loading ? t("loading") : value || t("allRepositories")}</Select.Value>
        <Select.Icon>
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="language-menu repository-select-menu" position="popper" align="start" sideOffset={6} collisionPadding={12}>
          <Select.Viewport>
            <Select.Item value="all" className="language-option">
              <Select.ItemText>{t("allRepositories")}</Select.ItemText>
              <Select.ItemIndicator>
                <Check size={15} />
              </Select.ItemIndicator>
            </Select.Item>
            {Array.from(groups, ([owner, repos]) => (
              <Select.Group key={owner}>
                <Select.Label className="px-3 pb-1 pt-3 text-xs font-medium text-[var(--muted)]">{owner}</Select.Label>
                {repos.map((repo) => (
                  <Select.Item key={repo.repo} value={repo.repo} className="language-option">
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
