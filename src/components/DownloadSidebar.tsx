import {
  ActionIcon,
  Box,
  Button,
  Group,
  Progress,
  ScrollArea,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconFolderOpen,
  IconLoader2,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";

import { formatBytes } from "../lib/tree";

export interface DlItem {
  key: string;
  /** Relative destination path — used as the display name and for retry. */
  relPath: string;
  /** Destination folder chosen for this download (retry + reveal context). */
  destDir: string;
  done: number;
  total: number;
  status: "running" | "ok" | "error";
  error?: string;
  /** Final saved path, once done — used by "show in folder". */
  path?: string;
}

interface Props {
  items: DlItem[];
  onClose: () => void;
  onClearDone: () => void;
  onReveal: (path: string) => void;
  onRetry: (key: string) => void;
}

function StatusIcon({ status }: { status: DlItem["status"] }) {
  if (status === "ok")
    return (
      <ThemeIcon color="green" variant="light" size="sm" radius="xl">
        <IconCircleCheck size={14} />
      </ThemeIcon>
    );
  if (status === "error")
    return (
      <ThemeIcon color="red" variant="light" size="sm" radius="xl">
        <IconAlertTriangle size={14} />
      </ThemeIcon>
    );
  return (
    <ThemeIcon color="gray" variant="light" size="sm" radius="xl">
      <IconLoader2 size={14} className="spin" />
    </ThemeIcon>
  );
}

/** App-bar style download queue docked on the right, full window height. */
export function DownloadSidebar({
  items,
  onClose,
  onClearDone,
  onReveal,
  onRetry,
}: Props) {
  const running = items.filter((i) => i.status === "running").length;
  const doneCount = items.filter((i) => i.status !== "running").length;

  return (
    <aside className="dl-sidebar">
      <Group className="dl-sidebar-head" justify="space-between" wrap="nowrap">
        <Text fw={600} size="sm">
          Downloads{running > 0 ? ` · ${running} running` : ""}
        </Text>
        <Tooltip label="Close" withArrow>
          <ActionIcon variant="subtle" color="gray" onClick={onClose}>
            <IconX size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <ScrollArea className="dl-sidebar-body" type="auto">
        {items.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" mt="xl">
            No downloads yet.
          </Text>
        ) : (
          items.map((it) => {
            const pct =
              it.total > 0
                ? Math.min(100, (it.done / it.total) * 100)
                : it.status === "ok"
                  ? 100
                  : 0;
            const name = it.relPath.split("/").pop() || it.relPath;
            return (
              <Box key={it.key} className="dl-item">
                <Group gap={8} wrap="nowrap" justify="space-between">
                  <Group gap={8} wrap="nowrap" miw={0}>
                    <StatusIcon status={it.status} />
                    <Tooltip label={it.relPath} withArrow openDelay={400}>
                      <Text size="sm" truncate>
                        {name}
                      </Text>
                    </Tooltip>
                  </Group>
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                    {it.status === "error" ? "failed" : formatBytes(it.done)}
                  </Text>
                </Group>

                <Progress
                  value={pct}
                  color={
                    it.status === "error"
                      ? "red"
                      : it.status === "ok"
                        ? "green"
                        : "primary"
                  }
                  size="sm"
                  mt={6}
                  animated={it.status === "running"}
                />

                {it.status === "error" && it.error && (
                  <Text size="xs" c="red" mt={4} lineClamp={2}>
                    {it.error}
                  </Text>
                )}

                {it.status === "ok" && it.path && (
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    mt={6}
                    leftSection={<IconFolderOpen size={14} />}
                    onClick={() => onReveal(it.path!)}
                  >
                    Show in folder
                  </Button>
                )}
                {it.status === "error" && (
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    mt={6}
                    leftSection={<IconRefresh size={14} />}
                    onClick={() => onRetry(it.key)}
                  >
                    Retry
                  </Button>
                )}
              </Box>
            );
          })
        )}
      </ScrollArea>

      {doneCount > 0 && running === 0 && (
        <Group className="dl-sidebar-foot" justify="flex-end">
          <Button variant="default" size="xs" onClick={onClearDone}>
            Clear finished
          </Button>
        </Group>
      )}
    </aside>
  );
}
