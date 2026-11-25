import { corsHeaders, userFromRequest } from "./request-auth";

export function json(req: Request, data: unknown, status = 200) {
  return Response.json(data, { status, headers: corsHeaders(req) });
}

/** Wrap an extension endpoint: CORS + pairing-token auth + error handling. */
export function extensionHandler(fn: (req: Request, userId: string) => Promise<Response>) {
  return async (req: Request) => {
    try {
      const userId = await userFromRequest(req);
      if (!userId) return json(req, { error: "Not paired. Create a pairing token in Upvance → Settings and paste it into the extension options." }, 401);
      return await fn(req, userId);
    } catch (e) {
      return json(req, { error: (e as Error).message }, 400);
    }
  };
}

export function options(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
