import type { Param } from './json-value.js';
export enum WebnatErrorCode {
  UNKNOWN = -1,
  CANCELLED = -999,
  TIMEOUT = -1001,
  CLOSED = -1004,
  UNIMPLEMENTED = -1010,
  DESERIALIZATION_FAILED = -1011,
  SERIALIZATION_FAILED = -1012,
}

export class WebnatError extends Error {
  public readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = 'WebnatError';
  }

  static from(error: unknown): WebnatError | null {
    if (error === null || error === undefined) return null;
    if (error instanceof WebnatError) return error;
    if (typeof error === 'object' && !Array.isArray(error)) {
      const object = error as Record<string, unknown>;
      const first = (keys: readonly string[]): unknown => {
        for (const key of keys) if (key in object) return object[key];
        return undefined;
      };
      const rawCode = first(['code','errcode','errCode','errorcode','errorCode']);
      let code = WebnatErrorCode.UNKNOWN;
      const number = typeof rawCode === 'number' ? rawCode :
        typeof rawCode === 'string' && rawCode.trim() === rawCode && /^[+-]?[0-9]+$/.test(rawCode) ? Number(rawCode) : NaN;
      if (Number.isInteger(number) && number >= -2147483648 && number <= 2147483647) code = number;
      const rawMessage = first(['message','msg','errmsg','errMsg','errormsg','errorMsg','errormessage','errorMessage']);
      const message = typeof rawMessage === 'string' ? rawMessage :
        typeof rawMessage === 'boolean' || (typeof rawMessage === 'number' && Number.isFinite(rawMessage))
          ? String(rawMessage) : 'Unknown Error';
      return new WebnatError(code, message);
    }
    return new WebnatError(WebnatErrorCode.UNKNOWN, String(error));
  }

  static timeout(): WebnatError {
    return new WebnatError(WebnatErrorCode.TIMEOUT, 'Operation Timeout');
  }

  static cancelled(): WebnatError {
    return new WebnatError(WebnatErrorCode.CANCELLED, 'Operation Cancelled');
  }

  static closed(): WebnatError {
    return new WebnatError(WebnatErrorCode.CLOSED, 'Connection Closed');
  }

  static unimplemented(obj?: unknown): WebnatError {
    const message = obj ? `Unimplemented Method: ${obj}` : 'Unimplemented Method';
    return new WebnatError(WebnatErrorCode.UNIMPLEMENTED, message);
  }

  static deserializationFailed(obj?: unknown): WebnatError {
    const message = obj ? `Message Deserialization Failed: ${obj}` : 'Message Deserialization Failed';
    return new WebnatError(WebnatErrorCode.DESERIALIZATION_FAILED, message);
  }

  static serializationFailed(obj?: unknown): WebnatError {
    const message = obj ? `Message Serialization Failed: ${obj}` : 'Message Serialization Failed';
    return new WebnatError(WebnatErrorCode.SERIALIZATION_FAILED, message);
  }

  toJson(): Record<string, Param> {
    return {
      'code': this.code,
      'message': this.message,
    };
  }
}
