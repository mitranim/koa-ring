'use strict'

const {isObject, isFunction, validate} = require('fpx')
const {Future, isFuture} = require('posterus')
const {routine} = require('posterus/routine')
const {toHandler, toPlainResponse, updateKoaResponse, quietExtend} = require('./index')

exports.toKoaMiddleware = toKoaMiddleware
function toKoaMiddleware(middleware) {
  const handler = toHandler(runNextKoaMiddleware, middleware)
  return async function koaMiddleware(ctx, next) {
    const request = quietExtend(ctx.request, {nextKoaMiddleware: next})
    const response = await tieToContextLifetime(ctx, toFuture(handler(request)))
    if (response) updateKoaResponse(ctx.response, response)
  }
}

function* runNextKoaMiddleware(request) {
  if (isObject(request) && request.nextKoaMiddleware) {
    const {ctx, nextKoaMiddleware: next} = request
    yield promiseToFuture(next())
    return toPlainResponse(ctx.response)
  }
  return null
}

function promiseToFuture(promise) {
  return Future.init(future => {
    promise.then(
      result => future.settle(null, result),
      error => future.settle(error)
    )
  })
}

function toFuture(value) {
  return isIterator(value) ? routine(value) : Future.fromResult(value)
}

function isIterator(value) {
  return (
    isObject(value) &&
    isFunction(value.next) &&
    isFunction(value.return) &&
    isFunction(value.throw)
  )
}

function tieToContextLifetime(ctx, future) {
  validate(isFuture, future)

  function deinit() {
    clear()
    tied.deinit()
  }

  function clear() {
    ctx.req.removeListener('close', deinit)
  }

  ctx.req.once('close', deinit)

  const tied = future.map((error, result) => {
    clear()
    if (error) throw error
    return result
  })

  return tied
}
