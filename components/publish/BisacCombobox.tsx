"use client";

import * as React from "react";
import useSWR from "swr";
import { Combobox } from "@base-ui/react/combobox";

import { cn } from "@/lib/utils";
import type { BisacEntry } from "@/lib/publish/bisac-types";
import { bisacFilter } from "@/lib/publish/bisac-filter";

const BISAC_URL = "/bisac-codes.json";
const RENDER_CAP = 200;

type Props = {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
};

const fetchBisac = async (url: string): Promise<BisacEntry[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as BisacEntry[];
};

function formatLabel(entry: BisacEntry): string {
  return `${entry.c} — ${entry.l}`;
}

function findEntry(
  entries: BisacEntry[] | undefined,
  code: string,
): BisacEntry | undefined {
  if (!entries) return undefined;
  return entries.find((e) => e.c === code);
}

export function BisacCombobox({ value, onChange, disabled }: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const { data, error } = useSWR<BisacEntry[]>(
    open || value ? BISAC_URL : null,
    fetchBisac,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      shouldRetryOnError: false,
    },
  );

  const matched = findEntry(data, value);

  const filtered = React.useMemo(() => {
    if (!data) return [];
    return bisacFilter(data, query);
  }, [data, query]);

  const visible = filtered.slice(0, RENDER_CAP);
  const overflow = filtered.length - visible.length;

  const triggerText = (() => {
    if (!value) return "Select BISAC category…";
    if (!data) return value;
    if (matched) return formatLabel(matched);
    return value;
  })();

  const triggerHint =
    value && data && !matched ? "not in current BISAC list" : null;

  return (
    <Combobox.Root
      items={visible}
      open={open}
      onOpenChange={setOpen}
      inputValue={query}
      onInputValueChange={(v) => setQuery(v)}
      value={matched ?? null}
      onValueChange={(item) => {
        if (item && typeof item === "object" && "c" in item) {
          onChange((item as BisacEntry).c);
          setOpen(false);
          setQuery("");
        }
      }}
      itemToStringLabel={(item) =>
        (item as BisacEntry | null) ? formatLabel(item as BisacEntry) : ""
      }
      itemToStringValue={(item) =>
        (item as BisacEntry | null) ? (item as BisacEntry).c : ""
      }
      isItemEqualToValue={(a, b) =>
        Boolean(a && b && (a as BisacEntry).c === (b as BisacEntry).c)
      }
    >
      <Combobox.Trigger
        data-testid="bisac-combobox-trigger"
        disabled={disabled}
        className={cn(
          "flex h-8 w-full items-center justify-between rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-left transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
          !value && "text-muted-foreground",
        )}
      >
        <span className="flex-1 truncate">{triggerText}</span>
        {triggerHint && (
          <span
            className="ml-2 shrink-0 text-xs text-muted-foreground"
            data-testid="bisac-combobox-trigger-hint"
          >
            {triggerHint}
          </span>
        )}
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="isolate z-50">
          <Combobox.Popup className="w-[var(--anchor-width)] min-w-[24rem] max-h-[min(60vh,var(--available-height))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md outline-none flex flex-col">
            <div className="border-b border-border p-1.5">
              <Combobox.Input
                data-testid="bisac-combobox-input"
                placeholder="Search by code or label…"
                autoFocus
                className="h-8 w-full rounded-md bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Combobox.List className="flex-1 overflow-y-auto p-1">
              {error ? (
                <div
                  data-testid="bisac-combobox-error"
                  className="px-2 py-2 text-sm text-destructive"
                >
                  Failed to load BISAC list — try reopening.
                </div>
              ) : !data ? (
                <div className="px-2 py-2 text-sm text-muted-foreground">
                  Loading BISAC list…
                </div>
              ) : filtered.length === 0 ? (
                <div
                  data-testid="bisac-combobox-empty"
                  className="px-2 py-2 text-sm text-muted-foreground"
                >
                  No BISAC codes match — try a different term.
                </div>
              ) : (
                <>
                  {visible.map((item) => (
                    <Combobox.Item
                      key={item.c}
                      value={item}
                      data-testid={`bisac-combobox-option-${item.c}`}
                      className="cursor-default rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                    >
                      {formatLabel(item)}
                    </Combobox.Item>
                  ))}
                  {overflow > 0 && (
                    <div
                      data-testid="bisac-combobox-more"
                      className="px-2 py-1.5 text-xs text-muted-foreground"
                    >
                      {RENDER_CAP}+ more — keep typing to narrow.
                    </div>
                  )}
                </>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
