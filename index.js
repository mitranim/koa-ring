'use strict'

const {testBy, drop, isFunction, isString, isList, isFinite, isObject,
  validate} = require('fpx')

/**
 * Public
 */

exports.toKoaMiddleware = toKoaMiddleware
function toKoaMiddleware(handler) {
  validate(handler, isFunction)
  return async function koaRingMiddleware(ctx, next) {
    const request = toPlainRequest(ctx)
    request.koaNext = next
    const response = await handler(request)
    if (isAwaitingResponse(ctx)) updateKoaContext(ctx, response)
  }
}

exports.match = match
function match(pattern, handler) {
  validate(handler, isFunction)
  return function matchingHandler(request) {
    return testBy(request, pattern) ? handler(request) : undefined
  }
}

exports.mount = mount
function mount(path, handler) {
  const segments = isList(path) ? path : splitPath(path)

  return function mountedHandler(request) {
    if (!isString(request.url)) {
      throw Error(`Expected request URL to be a string, got: ${request.url}`)
    }
    const urlSegments = splitPath(request.url)

    return testBy(urlSegments, segments)
      ? handler(patch(request, {url: drop(urlSegments, segments.length).join('/')}))
      : undefined
  }
}

exports.patch = patch
function patch(left, right) {
  return Object.assign({}, left, right)
}

// TODO document
exports.runKoaNext = runKoaNext
async function runKoaNext(request) {
  const {ctx, koaNext} = request || {}
  if (ctx && koaNext) {
    await koaNext()
    return toPlainResponse(ctx)
  }
  return undefined
}

exports.toPlainRequest = toPlainRequest
function toPlainRequest(ctx) {
  return {
    url: ctx.request.url,
    method: ctx.request.method,
    headers: ctx.request.headers,
    body: ctx.request.body,
    ctx,
    inspect: inspectPlainRequest,
  }
}

function inspectPlainRequest() {
  const {url, method, headers, body, ctx} = this  // eslint-disable-line no-invalid-this
  return {url, method, headers, body, ctx: ctx && '<koa context>'}
}

exports.toPlainResponse = toPlainResponse
function toPlainResponse(ctx) {
  if (isAwaitingResponse(ctx)) return undefined
  const {response: {status, headers, body}} = ctx
  return {status, headers, body}
}

exports.updateKoaContext = updateKoaContext
function updateKoaContext(ctx, response) {
  if (!response) return
  const {response: res} = ctx
  const {status, headers, body} = response
  if (isFinite(status)) res.status = status
  if (isObject(headers)) for (const key in headers) res.set(key, headers[key])
  if (body != null) res.body = body
}

exports.isAwaitingResponse = isAwaitingResponse
function isAwaitingResponse(ctx) {
  return ctx.status === 404 && ctx.body == null
}

/**
 * Utils
 */

function splitPath(path) {
  validate(path, isString)
  return path.split('/').filter(Boolean)
}
