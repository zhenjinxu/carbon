import type {
  CreateEmailOptions,
  CreateEmailRequestOptions,
  CreateEmailResponse
} from "resend";
import { Resend } from "resend";

// Use a dummy key if not configured (Resend constructor requires a non-empty string)
export const resend = new Resend(process.env.RESEND_API_KEY || "re_dummy_local");

export const sendEmail = async (
  payload: CreateEmailOptions,
  options?: CreateEmailRequestOptions
): Promise<CreateEmailResponse> => {
  if (process.env.DISABLE_RESEND) {
    console.log(payload, options);
    return {
      error: null,
      data: null
    };
  }
  return resend.emails.send(payload, options);
};
