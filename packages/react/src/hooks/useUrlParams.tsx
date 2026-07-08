import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";

export function useUrlParams(): [
  URLSearchParams,
  (
    params: Record<string, string | string[] | number | undefined | null>
  ) => void
] {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const setSearchParams = useCallback(
    (params: Record<string, string | string[] | number | undefined | null>) => {
      Object.entries(params).forEach(([name, value]) => {
        if (value) {
          if (Array.isArray(value)) {
            if (value.length === 0) {
              searchParams.delete(name);
            } else {
              value.forEach((v, i) => {
                if (i === 0) {
                  searchParams.set(name, v.toString());
                } else {
                  searchParams.append(name, v.toString());
                }
              });
            }
          } else {
            searchParams.set(name, value.toString());
          }
        } else {
          searchParams.delete(name);
        }
      });

      navigate(`?${searchParams.toString()}`);
    },
    [navigate, searchParams]
  );

  return [searchParams, setSearchParams];
}
