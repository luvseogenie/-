"use client";

import * as React from "react";
import { ChevronRight, FolderTree, Loader2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CategoryTreeNode } from "@/lib/types";

type CheckState = boolean | "indeterminate";

/** 노드와 그 하위 전체 id를 모은다(무한 depth). */
function collectIds(node: CategoryTreeNode, out: number[] = []): number[] {
  out.push(node.id);
  for (const child of node.children) collectIds(child, out);
  return out;
}

/** 선택 상태로부터 체크박스 표시 상태를 만든다. */
function checkStateOf(node: CategoryTreeNode, selected: Set<number>): CheckState {
  const ids = collectIds(node);
  const hit = ids.filter((id) => selected.has(id)).length;
  if (hit === 0) return false;
  if (hit === ids.length) return true;
  return "indeterminate";
}

function matchesKeyword(node: CategoryTreeNode, keyword: string): boolean {
  if (!keyword) return true;
  if (node.category_name.toLowerCase().includes(keyword)) return true;
  return node.children.some((child) => matchesKeyword(child, keyword));
}

type NodeProps = {
  node: CategoryTreeNode;
  selected: Set<number>;
  expanded: Set<number>;
  keyword: string;
  onToggleExpand: (id: number) => void;
  onToggleSelect: (node: CategoryTreeNode) => void;
};

function TreeNode({
  node,
  selected,
  expanded,
  keyword,
  onToggleExpand,
  onToggleSelect,
}: NodeProps) {
  const hasChildren = node.children.length > 0;
  // 검색 중에는 매칭된 가지를 자동으로 펼친다.
  const isOpen = keyword ? true : expanded.has(node.id);
  const state = checkStateOf(node, selected);

  if (!matchesKeyword(node, keyword)) return null;

  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-1.5 rounded px-1 py-1 hover:bg-accent/50",
          state === true && "bg-primary/10",
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={isOpen ? "접기" : "펼치기"}
            onClick={() => onToggleExpand(node.id)}
            className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")} />
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}

        <Checkbox
          checked={state}
          onCheckedChange={() => onToggleSelect(node)}
          id={`cat-${node.id}`}
          aria-label={node.category_name}
        />
        <label
          htmlFor={`cat-${node.id}`}
          className="flex-1 cursor-pointer truncate text-xs leading-5"
          title={`${node.category_name} (${node.category_code})`}
        >
          {node.category_name}
          {node.is_leaf && (
            <span className="ml-1 text-[10px] text-muted-foreground">최하위</span>
          )}
        </label>
      </div>

      {hasChildren && isOpen && (
        <ul className="ml-4 border-l border-border/60 pl-1">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selected={selected}
              expanded={expanded}
              keyword={keyword}
              onToggleExpand={onToggleExpand}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export type CategoryTreeProps = {
  tree: CategoryTreeNode[];
  loading: boolean;
  error: string | null;
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
};

export function CategoryTree({ tree, loading, error, selected, onChange }: CategoryTreeProps) {
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());
  const [keyword, setKeyword] = React.useState("");

  const byId = React.useMemo(() => {
    const map = new Map<number, CategoryTreeNode>();
    const walk = (nodes: CategoryTreeNode[]) => {
      for (const n of nodes) {
        map.set(n.id, n);
        walk(n.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** 부모를 체크하면 하위 전체가 함께 선택된다. */
  const toggleSelect = (node: CategoryTreeNode) => {
    const ids = collectIds(node);
    const next = new Set(selected);
    const allSelected = ids.every((id) => next.has(id));
    for (const id of ids) {
      if (allSelected) next.delete(id);
      else next.add(id);
    }
    onChange(next);
  };

  const removeOne = (id: number) => {
    const next = new Set(selected);
    next.delete(id);
    onChange(next);
  };

  const selectedNodes = [...selected]
    .map((id) => byId.get(id))
    .filter((n): n is CategoryTreeNode => Boolean(n))
    .sort((a, b) => a.depth - b.depth || a.category_name.localeCompare(b.category_name, "ko"));

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <FolderTree className="h-3.5 w-3.5 text-primary" />
          카테고리
        </div>
        {selected.size > 0 && (
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => onChange(new Set())}>
            전체 해제
          </Button>
        )}
      </div>

      <Input
        placeholder="카테고리 검색"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        className="h-7 text-xs"
      />

      <div className="h-64 shrink-0 overflow-y-auto rounded-md border border-border bg-background/40 p-1">
        {loading && (
          <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 불러오는 중...
          </div>
        )}
        {error && <p className="p-3 text-xs text-destructive">{error}</p>}
        {!loading && !error && tree.length === 0 && (
          <p className="p-3 text-xs leading-relaxed text-muted-foreground">
            카테고리가 아직 없습니다.
            <br />
            크롬 확장 아이콘 → <b>[쿠팡 카테고리 전체 가져오기]</b>를 누르면 쿠팡 메뉴에서 전체 트리를
            읽어옵니다. 그 다음 위의 [새로고침]을 누르세요.
          </p>
        )}
        <ul>
          {tree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              selected={selected}
              expanded={expanded}
              keyword={keyword.trim().toLowerCase()}
              onToggleExpand={toggleExpand}
              onToggleSelect={toggleSelect}
            />
          ))}
        </ul>
      </div>

      {/* 선택된 카테고리는 아래에 태그로 표시 */}
      <div className="flex flex-wrap gap-1">
        {selectedNodes.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">선택된 카테고리 없음</span>
        ) : (
          selectedNodes.map((node) => (
            <Badge key={node.id} variant="secondary" className="gap-1 pr-1">
              <span className="max-w-32 truncate">{node.category_name}</span>
              <button
                type="button"
                onClick={() => removeOne(node.id)}
                aria-label={`${node.category_name} 선택 해제`}
                className="rounded-sm p-0.5 hover:bg-destructive/20 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}
