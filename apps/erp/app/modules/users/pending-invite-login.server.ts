import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

type PendingEmployeeInvite = {
  code: string;
  email: string;
  companyId: string;
  role: "employee";
};

type SupabaseErrorLike = { message: string };

type PendingInviteResult = {
  data: PendingEmployeeInvite | null;
  error: SupabaseErrorLike | null;
};

type AcceptedInviteResult = {
  data: { companyId: string } | null;
  error: SupabaseErrorLike | null;
};

export type AcceptInviteForLogin = (
  client: SupabaseClient<Database>,
  code: string,
  email: string
) => Promise<AcceptedInviteResult>;

export async function getSinglePendingEmployeeInviteForLogin(
  client: SupabaseClient<Database>,
  userId: string
): Promise<PendingInviteResult> {
  const user = await client
    .from("user")
    .select("id,email")
    .eq("id", userId)
    .eq("active", true)
    .single();

  if (user.error) {
    return { data: null, error: user.error };
  }

  const email = user.data?.email?.toLowerCase();
  if (!email) {
    return {
      data: null,
      error: { message: `Active user ${userId} has no email` }
    };
  }

  const invites = await client
    .from("invite")
    .select("code,email,companyId,role")
    .ilike("email", email)
    .eq("role", "employee")
    .is("acceptedAt", null)
    .is("revokedAt", null);

  if (invites.error) {
    return { data: null, error: invites.error };
  }

  const pendingInvites = (invites.data ?? []) as PendingEmployeeInvite[];
  if (pendingInvites.length !== 1) {
    return { data: null, error: null };
  }

  return { data: pendingInvites[0], error: null };
}

export async function acceptPendingEmployeeInviteForLogin(
  client: SupabaseClient<Database>,
  userId: string,
  acceptInvite: AcceptInviteForLogin
): Promise<AcceptedInviteResult> {
  const pendingInvite = await getSinglePendingEmployeeInviteForLogin(
    client,
    userId
  );

  if (pendingInvite.error || !pendingInvite.data) {
    return { data: null, error: pendingInvite.error };
  }

  const existingMembership = await client
    .from("userToCompany")
    .select("userId")
    .eq("userId", userId)
    .eq("companyId", pendingInvite.data.companyId)
    .maybeSingle();

  if (existingMembership.error) {
    return { data: null, error: existingMembership.error };
  }

  if (existingMembership.data) {
    return {
      data: { companyId: pendingInvite.data.companyId },
      error: null
    };
  }

  const acceptedInvite = await acceptInvite(
    client,
    pendingInvite.data.code,
    pendingInvite.data.email
  );

  if (acceptedInvite.error) {
    return { data: null, error: acceptedInvite.error };
  }

  return {
    data: {
      companyId: acceptedInvite.data?.companyId ?? pendingInvite.data.companyId
    },
    error: null
  };
}
