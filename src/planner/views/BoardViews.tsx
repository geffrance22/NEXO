import { CalendarView } from "./CalendarView";
import { ListView } from "./ListView";
import { MatrixView } from "./MatrixView";
import type { BoardMode, ViewApi } from "./shared";
import { TableView } from "./TableView";
import { TimelineView } from "./TimelineView";
import "./views.css";

/** Las otras formas de mirar un tablero (las columnas siguen en Boards). */
export function BoardViews({ mode, api }: { mode: BoardMode; api: ViewApi }) {
  switch (mode) {
    case "lista":
      return <ListView api={api} />;
    case "tabla":
      return <TableView api={api} />;
    case "calendario":
      return <CalendarView api={api} />;
    case "linea":
      return <TimelineView api={api} />;
    case "matriz":
      return <MatrixView api={api} />;
    default:
      return null;
  }
}
