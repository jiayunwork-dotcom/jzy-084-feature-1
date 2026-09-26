/**
 * Structured validation error.
 * code: machine readable error code
 * message: human readable summary
 * details: array of { path, message } pinpointing the offending field(s)
 */
export class ValidationError extends Error {
  constructor(message, details = [], code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.details = details;
    this.status = 422;
  }

  toJSON() {
    return {
      error: { code: this.code, message: this.message, details: this.details },
    };
  }
}

export class NotFoundError extends Error {
  constructor(message = 'not found') {
    super(message);
    this.name = 'NotFoundError';
    this.code = 'NOT_FOUND';
    this.status = 404;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message } };
  }
}
