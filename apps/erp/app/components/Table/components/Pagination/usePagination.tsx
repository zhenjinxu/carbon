import { parseNumberFromUrlParam } from "@carbon/auth";
import type { RowSelectionState } from "@tanstack/react-table";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useSearchParams } from "react-router";

export function usePagination(
  count: number,
  setRowSelections: Dispatch<SetStateAction<RowSelectionState>>
) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const pageSize = parseNumberFromUrlParam(searchParams, "limit", 100);
  const offset = parseNumberFromUrlParam(searchParams, "offset", 0);

  const pageIndex = Math.floor(offset / pageSize) + 1;
  const pageCount = Math.ceil(count / pageSize);
  const canPreviousPage = pageIndex > 1;
  const canNextPage = pageIndex < Math.ceil(count / pageSize);

  const gotoPage = useCallback(
    (page: number) => {
      const newParams = new URLSearchParams(searchParams);
      newParams.set("offset", String((page - 1) * pageSize));
      newParams.set("limit", String(pageSize));
      flushSync(() => {
        setRowSelections({});
      });
      navigate(`?${newParams.toString()}`);
      window?.scrollTo({ top: 0, behavior: "smooth" });
    },
    [searchParams, pageSize, navigate, setRowSelections]
  );

  const previousPage = useCallback(() => {
    gotoPage(pageIndex - 1);
  }, [gotoPage, pageIndex]);

  const nextPage = useCallback(() => {
    gotoPage(pageIndex + 1);
  }, [gotoPage, pageIndex]);

  const setPageSize = useCallback(
    (pageSize: number) => {
      const newParams = new URLSearchParams(searchParams);
      newParams.set("offset", "0");
      newParams.set("limit", String(pageSize));
      navigate(`?${newParams.toString()}`);
    },
    [searchParams, navigate]
  );

  return {
    count,
    offset,
    pageIndex,
    pageCount,
    pageSize,
    canPreviousPage,
    canNextPage,
    gotoPage,
    nextPage,
    previousPage,
    setPageSize
  };
}
