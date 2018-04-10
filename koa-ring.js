'use strict'

const f = require('fpx')
const u = require('./utils')

exports.toKoaMiddleware = toKoaMiddleware
function toKoaMiddleware(handler) {
  f.validate(handler, f.isFunction)
  return async function koaRingMiddleware(ctx, next) {
    const request = u.toPlainRequest(ctx)
    request.koaNext = next
    const response = await handler(request)
    if (u.isAwaitingResponse(ctx)) u.assignResponseToContext(ctx, response)
  }
}

// Undocumented
exports.runKoaNext = runKoaNext
async function runKoaNext(request) {
  const {ctx, koaNext} = request || {}
  if (ctx && koaNext) {
    await koaNext()
    return u.toPlainResponse(ctx)
  }
  return undefined
}
