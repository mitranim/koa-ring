'use strict'

const {testBy, slice, mapDict, isFunction, isString, isList, isFinite, isObject,
  validate, validateEach} = require('fpx')

/**
 * Public
 */

exports.compose = compose
function compose(middlewares) {
  validateEach(isFunction, middlewares)
  return function composedMiddleware(next) {
    validate(isFunction, next)
    return middlewares.reduceRight(toHandler, next)
  }
}

exports.pipeline = pipeline
function pipeline(funs) {
  validateEach(isFunction, funs)
  return async function asyncPipeline(value) {
    for (const fun of funs) value = await fun(value)
    return value
  }
}

// Special-cased for nicer error messages.
exports.toHandler = toHandler
function toHandler(nextHandler, middleware) {
  validate(isFunction, nextHandler)
  validate(isFunction, middleware)
  const handler = middleware(nextHandler)
  if (!isFunction(handler)) {
    throw Error(`Expected middleware to return handler function, got ${handler}`)
  }
  return handler
}

exports.toKoaMiddleware = toKoaMiddleware
function toKoaMiddleware(middleware) {
  const handler = toHandler(runNextKoaMiddleware, middleware)
  return async function koaMiddleware(ctx, next) {
    const request = quietExtend(ctx.request, {nextKoaMiddleware: next})
    const response = await handler(request)
    if (response) updateKoaResponse(ctx.response, response)
  }
}

exports.toPlainResponse = toPlainResponse
function toPlainResponse(response) {
  if (!isResponseSettled(response)) return null
  const {status, headers, body} = response
  return {status, headers, body}
}

exports.updateKoaResponse = updateKoaResponse
function updateKoaResponse(koaResponse, {status, headers, body}) {
  if (isFinite(status)) koaResponse.status = status
  if (isObject(headers)) for (const key in headers) koaResponse.set(key, headers[key])
  koaResponse.body = body
}

exports.match = match
function match(pattern, middleware) {
  validate(isFunction, middleware)

  return function matchMiddleware(next) {
    const handler = toHandler(next, middleware)

    return function matchHandler(request) {
      return testBy(pattern, request) ? handler(request) : next(request)
    }
  }
}

exports.mount = mount
function mount(path, middleware) {
  const segmentsTest = isList(path) ? path : splitPath(path)

  return function mountedMiddleware(next) {
    const handler = toHandler(next, middleware)

    return function mountedHandler(request) {
      if (!isString(request.url)) {
        throw Error(`Expected request URL to be a string, got: ${request.url}`)
      }
      const urlSegments = splitPath(request.url)

      return testBy(segmentsTest, urlSegments)
        ? handler(extend(request, {url: drop(segmentsTest.length, urlSegments).join('/')}))
        : next(request)
    }
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

/**
 * Utils
 */

async function runNextKoaMiddleware(request) {
  if (isObject(request) && request.nextKoaMiddleware) {
    const {ctx, nextKoaMiddleware: next} = request
    await next()
    return toPlainResponse(ctx.response)
  }
  return null
}

function isResponseSettled({status, body}) {
  return (isFinite(status) && status !== 404) || Boolean(body)
}

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
