"use client";

import { useTransition } from "react";
import Link from "next/link";
import { ChevronsUpDown, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchProject } from "@/lib/projects/actions";

type Props = {
  projects: { id: string; name: string }[];
  activeProjectId: string;
};

export function ProjectSwitcher({ projects, activeProjectId }: Props) {
  const [pending, startTransition] = useTransition();
  const active = projects.find((p) => p.id === activeProjectId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-56 justify-between gap-2" data-testid="project-switcher">
          <span className="truncate">{active?.name ?? "Select project"}</span>
          {pending ? <Loader2 className="animate-spin" /> : <ChevronsUpDown className="opacity-60" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={activeProjectId}
          onValueChange={(id) => startTransition(() => switchProject(id))}
        >
          {projects.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id}>
              <span className="truncate">{p.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/projects/new">
            <Plus />
            New project
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
