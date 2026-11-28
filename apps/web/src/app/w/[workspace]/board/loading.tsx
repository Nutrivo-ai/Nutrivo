import { BoardLoading } from "@/components/board/Board";
import { Screen } from "@/components/shell";

// S-MTX-009 while the board's products and markets are read: the grid's outline and "Loading the board…".
export default function Loading() {
  return (
    <Screen route="/w/[workspace]/board" crumb="Board" title="Products and markets">
      <BoardLoading />
    </Screen>
  );
}
