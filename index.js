'use strict'

const {testBy, slice, isFunction, isString, isList, isFinite, isObject,
  validate, validateEach} = require('fpx')

exports.compose = compose
function compose(middlewares) {
  validateEach(isFunction, middlewares)
  return function composedMiddleware(next) {
    validate(isFunction, next)
    return middlewares.reduceRight(toHandler, next)
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
    const request = Object.create(ctx.request, {nextKoaMiddleware: {value: next}})
    const response = await handler(request)
    if (response) updateKoaResponse(ctx.response, response)
  }
}

async function runNextKoaMiddleware(request) {
  if (isObject(request) && request.nextKoaMiddleware) {
    const {ctx, nextKoaMiddleware: next} = request
    await next()
    return toPlainResponse(ctx.response)
  }
  return null
}

exports.toPlainResponse = toPlainResponse
function toPlainResponse(response) {
  if (!isResponseDefined(response)) return null
  const {status, headers, body} = response
  return {status, headers, body}
}

function isResponseDefined({status, body}) {
  return (isFinite(status) && status !== 404) || Boolean(body)
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
      const urlSegments = splitPath(request.url)

      return testBy(segmentsTest, urlSegments)
        ? handler(Object.create(request, {url: {value: drop(segmentsTest.length, urlSegments).join('/')}}))
        : next(request)
    }
  }
}

function splitPath(path) {
  validate(isString, path)
  return path.split('/').filter(Boolean)
}

function drop(count, value) {
  return isList(value) ? slice(value, count) : []
}
