export class AppError extends Error {
  constructor(code, message, status = 400, extra) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export const E = {
  badRequest: (m = '请求参数有误') => new AppError('BAD_REQUEST', m, 400),
  unauthorized: (m = '请先登录') => new AppError('UNAUTHORIZED', m, 401),
  forbidden: (m = '没有权限执行此操作') => new AppError('FORBIDDEN', m, 403),
  notFound: (m = '资源不存在') => new AppError('NOT_FOUND', m, 404),
  conflict: (m = '资源冲突') => new AppError('CONFLICT', m, 409),
  rateLimited: (m = '操作过于频繁，请稍后再试') => new AppError('RATE_LIMITED', m, 429),
  /** 需求核心：无可用算力时的统一出口 */
  insufficientCompute: (m = '算力不足，请自行接入第三方工具 API。') =>
    new AppError('INSUFFICIENT_COMPUTE', m, 402),
  providerFailed: (m, detail) => new AppError('PROVIDER_FAILED', m, 502, { detail }),
};
