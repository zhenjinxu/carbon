import { assertIsPost } from "@carbon/auth";
import { clearAuthCookies, destroyAuthSession } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  return destroyAuthSession(request);
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Clear cookies on GET as well so visiting /logout directly works
  const headers = await clearAuthCookies(request);
  throw redirect(path.to.root, { headers });
}
