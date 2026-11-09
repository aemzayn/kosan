import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 ignores promises returned by route handlers, so a rejected query
 * becomes an unhandled rejection that crashes Node. This forwards it to the
 * error middleware instead. (Express 5 does this natively.)
 */
export function asyncRoute(
  handler: (req: Request, res: Response) => Promise<unknown>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}
