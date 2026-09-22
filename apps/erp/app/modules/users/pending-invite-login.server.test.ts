import { describe, expect, it, vi } from "vitest";
import { acceptPendingEmployeeInviteForLogin } from "./pending-invite-login.server";

type QueryResult<T> =
  | { data: T; error: null }
  | { data: null; error: { message: string } };

function query<T>(result: QueryResult<T>) {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    ilike: vi.fn(() => q),
    is: vi.fn(() => q),
    single: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
    then: (
      resolve: (value: QueryResult<T>) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject)
  };
  return q;
}

function makeClient(results: Record<string, QueryResult<unknown>>) {
  return {
    from: vi.fn((table: string) => {
      const result = results[table];
      if (!result) throw new Error(`Unexpected table ${table}`);
      return query(result);
    })
  };
}

describe("acceptPendingEmployeeInviteForLogin", () => {
  it("accepts exactly one pending employee invite before company selection", async () => {
    const client = makeClient({
      user: {
        data: { id: "user-1", email: "newperson@carbon.local" },
        error: null
      },
      invite: {
        data: [
          {
            code: "invite-code",
            email: "newperson@carbon.local",
            companyId: "target-company",
            role: "employee"
          }
        ],
        error: null
      },
      userToCompany: { data: null, error: null }
    });
    const acceptInvite = vi.fn(async () => ({
      data: { companyId: "target-company" },
      error: null
    }));

    const result = await acceptPendingEmployeeInviteForLogin(
      client as never,
      "user-1",
      acceptInvite
    );

    expect(result).toEqual({
      data: { companyId: "target-company" },
      error: null
    });
    expect(acceptInvite).toHaveBeenCalledWith(
      client,
      "invite-code",
      "newperson@carbon.local"
    );
  });

  it("does not auto-accept when more than one employee invite is pending", async () => {
    const client = makeClient({
      user: {
        data: { id: "user-1", email: "newperson@carbon.local" },
        error: null
      },
      invite: {
        data: [
          {
            code: "one",
            email: "newperson@carbon.local",
            companyId: "company-a",
            role: "employee"
          },
          {
            code: "two",
            email: "newperson@carbon.local",
            companyId: "company-b",
            role: "employee"
          }
        ],
        error: null
      }
    });
    const acceptInvite = vi.fn();

    const result = await acceptPendingEmployeeInviteForLogin(
      client as never,
      "user-1",
      acceptInvite
    );

    expect(result).toEqual({ data: null, error: null });
    expect(acceptInvite).not.toHaveBeenCalled();
  });
});
