/** An error we throw on purpose; the error handler turns it into a clean JSON response. */
export class AppError extends Error {
  constructor(message, status = 400, details, code) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
    this.appCode = code;
  }
}

export default AppError;
