/**
 * @file notFoundMiddleware.ts
 *
 * @description Terminal middleware for requests that matched no route. It keeps
 * unmatched responses consistent with the API's error envelope instead of
 * letting Express fall back to its default HTML 404.
 */

import { ApiMessages, HttpStatus } from "@/config/constants/index.js";
import type { Request, Response } from "express";

export const notFoundMiddleware = (_req: Request, res: Response) => {
  res.status(HttpStatus.NOT_FOUND).json({
    success: false,
    message: ApiMessages.CLIENT_ERROR.NOT_FOUND,
    code: "NOT_FOUND",
  });
};
