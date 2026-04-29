"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

const NAV_LINKS = [
  { label: "Library", href: "/" },
  { label: "Bundles", href: "/bundles" },
  { label: "Settings", href: "/settings" },
] as const;

export function TopBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-11 max-w-5xl items-center justify-between px-6">
        {/* Wordmark */}
        <Link
          href="/"
          className="font-mono text-sm font-medium tracking-widest text-foreground transition-opacity hover:opacity-70"
          aria-label="scriptr — home"
        >
          scriptr
        </Link>

        {/* Nav + tools */}
        <div className="flex items-center gap-4">
          <nav aria-label="Primary navigation">
            <ul className="flex items-center gap-6" role="list">
              {NAV_LINKS.map(({ label, href }) => {
                const isActive =
                  href === "/" ? pathname === "/" : pathname.startsWith(href);

                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className={cn(
                        "relative text-sm transition-colors",
                        "after:absolute after:-bottom-[1px] after:left-0 after:h-px after:w-full",
                        "after:origin-left after:scale-x-0 after:bg-foreground after:transition-transform after:duration-200",
                        isActive
                          ? "text-foreground after:scale-x-100"
                          : "text-muted-foreground hover:text-foreground hover:after:scale-x-100",
                      )}
                      aria-current={isActive ? "page" : undefined}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
