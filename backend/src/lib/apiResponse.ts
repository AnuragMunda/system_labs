/**
 * @file apiResponse.ts
 *
 * @description Provides the standard success-response envelope used by all
 * controllers. Every response is shaped as `{ success: true, message, data? }`
 * with a matching HTTP status code.
 */

import type { Response } from "express";
import { ApiMessages, HttpStatus } from "@/config/constants/index.js";

class ApiResponse {
  static success(
    res: Response,
    statusCode: number = HttpStatus.OK,
    data: null | unknown = null,
    message: string = "Success",
  ) {
    const response = {
      success: true,
      message,
      ...(data !== null && { data }),
    };

    return res.status(statusCode).json(response);
  }

  /**
   * Send a successful response with data
   * @param {Response} res - Express response object
   * @param {*} data - Response data
   * @param {String} message - Response message
   */
  static ok(
    res: Response,
    data: null | unknown = null,
    message: string = ApiMessages.SUCCESS.OK,
  ) {
    return this.success(res, HttpStatus.OK, data, message);
  }

  /**
   * Send a created response (201)
   * @param {Response} res - Express response object
   * @param {*} data - Response data
   * @param {String} message - Response message
   */
  static created(
    res: Response,
    data: null | unknown = null,
    message: string = ApiMessages.SUCCESS.CREATED,
  ) {
    return this.success(res, HttpStatus.CREATED, data, message);
  }

  /**
   * Send an accepted response (202) for work scheduled to complete later.
   * @param {Response} res - Express response object
   * @param {*} data - Response data
   * @param {String} message - Response message
   */
  static accepted(
    res: Response,
    data: null | unknown = null,
    message: string = ApiMessages.SUCCESS.OK,
  ) {
    return this.success(res, HttpStatus.ACCEPTED, data, message);
  }
}

export { ApiResponse };
