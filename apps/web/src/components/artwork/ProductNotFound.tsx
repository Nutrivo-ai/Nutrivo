import { EmptyState } from "@/components/kit";

/** A product or artwork id that RLS does not return: one that does not exist and one in another workspace read the same. */
export function ProductNotFound({ workspaceId, what = "product" }: { workspaceId: string; what?: "product" | "artwork" }) {
  return (
    <div className="max-w-[640px]">
      <EmptyState
        where="NOT FOUND"
        title={`This ${what} is not in this workspace`}
        body={`The link may be from another workspace, or the ${what} may never have existed. Products are never deleted, so a product you added is still on the board.`}
        action={{ label: "Open the board", href: `/w/${workspaceId}/board` }}
      />
    </div>
  );
}
