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

  static from(error: any): WebnatError | null {
    if (error === null || error === undefined) {
      return null;
    }
    if (typeof error === 'object') {
      const code = (() => {
        const obj = error as Record<string, any>;
        const v: any = obj['code'] ?? obj['errcode'] ?? obj['errCode'] ?? obj['errorcode'] ?? obj['errorCode'];
        if (!v) {
          return WebnatErrorCode.UNKNOWN;
        }
        if (typeof v === 'number') {
          const num = v as number;
          if (Number.isSafeInteger(num)) {
            return num;
          }
        }
        if (typeof v === 'string') {
          const c = parseInt(v as string);
          if (Number.isSafeInteger(c)) {
            return c;
          }
          return WebnatErrorCode.UNKNOWN;
        }
        return WebnatErrorCode.UNKNOWN;
      })();
      const message = (() => {
        const obj = error as Record<string, any>;
        const v: any = obj['message'] ?? obj['msg'] ?? obj['errmsg'] ?? obj['errMsg'] ?? obj['errormsg'] ?? obj['errorMsg'] ?? obj['errormessage'] ?? obj['errorMessage'];
        if (!v) {
          return 'Unknown Error';
        }
        if (typeof v === 'string') {
          return v;
        }
        return `${v}`;
      })();
      return new WebnatError(code, message);
    }
    return new WebnatError(WebnatErrorCode.UNKNOWN, `${error}`);
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

  static unimplemented(obj?: any): WebnatError {
    const message = obj ? `Unimplemented Method: ${obj}` : 'Unimplemented Method';
    return new WebnatError(WebnatErrorCode.UNIMPLEMENTED, message);
  }

  static deserializationFailed(obj?: any): WebnatError {
    const message = obj ? `Message Deserialization Failed: ${obj}` : 'Message Deserialization Failed';
    return new WebnatError(WebnatErrorCode.DESERIALIZATION_FAILED, message);
  }

  static serializationFailed(obj?: any): WebnatError {
    const message = obj ? `Message Serialization Failed: ${obj}` : 'Message Serialization Failed';
    return new WebnatError(WebnatErrorCode.SERIALIZATION_FAILED, message);
  }

  toJson(): Record<string, any> {
    return {
      'code': this.code,
      'message': this.message,
    };
  }
}
