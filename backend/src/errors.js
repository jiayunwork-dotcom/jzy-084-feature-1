/**
 * Structured errors. Every error carries:
 *  - code:    machine readable error code
 *  - status:  HTTP status
 *  - toJSON(): structured body { error: { code, message, details? } }
 *
 * The global error handler renders anything with `status` + `toJSON()`
 * directly, so new error kinds need no special-casing there.
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

/** 400 for a well-formed request whose body violates resource semantics. */
export class BadRequestError extends Error {
  constructor(message, code = 'BAD_REQUEST', details = []) {
    super(message);
    this.name = 'BadRequestError';
    this.code = code;
    this.details = details;
    this.status = 400;
  }

  toJSON() {
    return {
      error: { code: this.code, message: this.message, details: this.details },
    };
  }
}

/** 404 returned by a resource collection when an item id does not exist. */
export class ResourceNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResourceNotFoundError';
    this.code = 'RESOURCE_NOT_FOUND';
    this.status = 404;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message } };
  }
}
