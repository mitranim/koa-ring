'use strict'

const {testBy, slice, mapDict, isFunction, isString, isList, isFinite, isObject,
  validate} = require('fpx')

/**
 * Public
 */

exports.toKoaMiddleware = toKoaMiddleware
function toKoaMiddleware(handler) {
  validate(isFunction, handler)
  return async function koaMiddleware(ctx, next) {
    const request = quietExtend(ctx.request, {koaNext: next})
    const response = await handler(request)
    if (!isContextSettled(ctx)) updateKoaContext(ctx, response)
  }
}

exports.match = match
function match(pattern, handler) {
  validate(isFunction, handler)
  return function matchHandler(request) {
    return testBy(pattern, request) ? handler(request) : undefined
  }
}

exports.mount = mount
function mount(path, handler) {
  const segmentsTest = isList(path) ? path : splitPath(path)

  return function mountedHandler(request) {
    if (!isString(request.url)) {
      throw Error(`Expected request URL to be a string, got: ${request.url}`)
    }
    const urlSegments = splitPath(request.url)

    return testBy(segmentsTest, urlSegments)
      ? handler(extend(request, {url: drop(segmentsTest.length, urlSegments).join('/')}))
      : undefined
  }
}

exports.extend = extend
function extend(proto, values) {
  return Object.create(proto, mapDict(enumerableValueDescriptor, values))
}

exports.quietExtend = quietExtend
function quietExtend(proto, values) {
  return Object.create(proto, mapDict(nonenumerableValueDescriptor, values))
}

exports.koaNext = koaNext
async function koaNext(request) {
  const {ctx, koaNext} = request || {}
  if (ctx && koaNext) {
    await koaNext()
    return toPlainResponse(ctx)
  }
  return undefined
}

exports.toPlainResponse = toPlainResponse
function toPlainResponse(ctx) {
  if (!isContextSettled(ctx)) return undefined
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

exports.isContextSettled = isContextSettled
function isContextSettled(ctx) {
  return !(ctx.status === 404 && ctx.body == null)
}

/**
 * Utils
 */

function splitPath(path) {
  validate(isString, path)
  return path.split('/').filter(Boolean)
}

function drop(count, value) {
  return isList(value) ? slice(value, count) : []
}

function enumerableValueDescriptor(value) {
  return {value, configurable: true, enumerable: true}
}

function nonenumerableValueDescriptor(value) {
  return {value, configurable: true, enumerable: false}
}
